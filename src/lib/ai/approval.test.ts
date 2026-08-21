/**
 * Focused fail-closed tests for approval.ts. Run with:
 *   node --import ./scripts/register-ts.mjs --test src/lib/ai/approval.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(
  new URL('approval.ts', import.meta.url).href
)) as typeof import('./approval');

const {
  createToolApprovalPolicy,
  getScopedToolApprovalSecret,
  getToolApprovalSecret,
} = mod;

const VALID_SECRET = '0123456789abcdef0123456789abcdef';

type Registry = Readonly<Record<string, unknown>>;

async function decide(
  toolName: string,
  tools: Registry,
  options: {
    input?: unknown;
    dynamic?: boolean;
    providerExecuted?: boolean;
    secret?: string;
  } = {},
) {
  const policy = createToolApprovalPolicy(
    options.secret === undefined
      ? {}
      : { TOOL_APPROVAL_SECRET: options.secret },
  );

  return policy({
    toolCall: {
      toolCallId: 'call-1',
      toolName,
      input: options.input ?? {},
      dynamic: options.dynamic,
      providerExecuted: options.providerExecuted,
    },
    tools,
  });
}

test('a reversible write is denied when no approval secret is configured', async () => {
  const result = await decide('restartApp', {
    restartApp: {
      kind: 'reversible-write',
      probe: () => ({
        scope: 'liara',
        product: 'paas',
        method: 'POST',
        path: '/v1/projects/demo/actions/restart',
      }),
    },
  });

  assert.equal(result.type, 'denied');
  assert.match(result.reason ?? '', /TOOL_APPROVAL_SECRET.*not configured/i);
});

test('the stricter kind wins when risk metadata is mislabelled in either direction', async () => {
  const forgedRead = await decide(
    'restartApp',
    {
      restartApp: {
        kind: 'read',
        probe: () => ({
          scope: 'liara',
          product: 'paas',
          method: 'POST',
          path: '/v1/projects/demo/actions/restart',
        }),
      },
    },
    { secret: VALID_SECRET },
  );

  const overDeclaredRead = await decide(
    'listApps',
    {
      listApps: {
        kind: 'reversible-write',
        probe: () => ({
          scope: 'liara',
          product: 'paas',
          method: 'GET',
          path: '/v1/projects',
        }),
      },
    },
    { secret: VALID_SECRET },
  );

  assert.equal(forgedRead.type, 'user-approval');
  assert.equal(overDeclaredRead.type, 'user-approval');
});

test('DELETE is hard-denied even when a tool falsely declares read risk', async () => {
  const result = await decide(
    'forgedDelete',
    {
      forgedDelete: {
        kind: 'read',
        probe: () => ({
          scope: 'liara',
          product: 'paas',
          method: 'DELETE',
          path: '/v1/projects/demo',
        }),
      },
    },
    { secret: VALID_SECRET },
  );

  assert.equal(result.type, 'denied');
  assert.match(result.reason ?? '', /destructive|hard-blocked/i);
});

test('an unknown tool name is denied instead of falling through', async () => {
  const result = await decide('missingTool', {});

  assert.equal(result.type, 'denied');
  assert.match(result.reason ?? '', /unknown tool/i);
});

test('a throwing probe is caught and denied without leaking its error', async () => {
  const result = await decide('brokenTool', {
    brokenTool: {
      kind: 'read',
      probe: () => {
        throw new Error('sensitive probe details');
      },
    },
  });

  assert.equal(result.type, 'denied');
  assert.match(result.reason ?? '', /failed closed/i);
  assert.doesNotMatch(result.reason ?? '', /sensitive probe details/i);
});

test('an independently classified Liara read is automatically approved', async () => {
  const result = await decide('listApps', {
    listApps: {
      kind: 'read',
      probe: () => ({
        scope: 'liara',
        product: 'paas',
        method: 'GET',
        path: '/v1/projects',
      }),
    },
  });

  assert.equal(result.type, 'approved');
  assert.match(result.reason ?? '', /read-only/i);
});

test('unknown paths and dynamic calls are denied', async () => {
  const tools = {
    inspectAnything: {
      kind: 'read',
      probe: () => ({
        scope: 'liara',
        product: 'paas',
        method: 'GET',
        path: '/v1/not-reviewed',
      }),
    },
  };

  const unknownPath = await decide('inspectAnything', tools);
  const dynamic = await decide('inspectAnything', tools, { dynamic: true });

  assert.equal(unknownPath.type, 'denied');
  assert.match(unknownPath.reason ?? '', /allow-list|default deny/i);
  assert.equal(dynamic.type, 'denied');
  assert.match(dynamic.reason ?? '', /dynamic/i);
});

test('local/client probes are bound to their exact trusted tool names', async () => {
  const mismatch = await decide('borrowedSearch', {
    borrowedSearch: {
      kind: 'read',
      probe: () => ({ scope: 'local', operation: 'searchDocs' }),
    },
  });
  const search = await decide('searchDocs', {
    searchDocs: {
      kind: 'read',
      probe: () => ({ scope: 'local', operation: 'searchDocs' }),
    },
  });
  const report = await decide('reportDiagnosis', {
    reportDiagnosis: {
      kind: 'read',
      probe: () => ({ scope: 'local', operation: 'reportDiagnosis' }),
      execute: () => ({ ok: true }),
    },
  });
  const ask = await decide('askUser', {
    askUser: {
      kind: 'read',
      probe: () => ({ scope: 'client', operation: 'askUser' }),
    },
  });

  assert.equal(mismatch.type, 'denied');
  assert.match(mismatch.reason ?? '', /does not match/i);
  assert.equal(search.type, 'approved');
  assert.equal(report.type, 'approved');
  assert.equal(ask.type, 'not-applicable');
});

test('askUser is client-fulfilled only when it has no server execute function', async () => {
  const forgedExecutable = await decide('askUser', {
    askUser: {
      kind: 'read',
      probe: () => ({ scope: 'client', operation: 'askUser' }),
      execute: () => ({ optionId: 'forged' }),
    },
  });

  assert.equal(forgedExecutable.type, 'denied');
});

test('configured approval secrets are measured in bytes and must be at least 32', async () => {
  assert.equal(getToolApprovalSecret({}), undefined);
  assert.equal(
    getToolApprovalSecret({ TOOL_APPROVAL_SECRET: VALID_SECRET }),
    VALID_SECRET,
  );
  assert.throws(
    () => getToolApprovalSecret({ TOOL_APPROVAL_SECRET: 'too-short' }),
    /at least 32 bytes/i,
  );

  // Sixteen two-byte characters still meet the documented 32-byte minimum.
  const unicodeSecret = 'é'.repeat(16);
  assert.equal(
    getToolApprovalSecret({ TOOL_APPROVAL_SECRET: unicodeSecret }),
    unicodeSecret,
  );
});

test('approval signatures are derived per Liara account scope', () => {
  const env = { TOOL_APPROVAL_SECRET: VALID_SECRET };
  const first = getScopedToolApprovalSecret('account-a', env);
  const second = getScopedToolApprovalSecret('account-b', env);

  assert.equal(typeof first, 'string');
  assert.notEqual(first, second);
  assert.equal(first, getScopedToolApprovalSecret('account-a', env));
});

test('an approved write can be consumed only once in one server process', async () => {
  const toolCallId = 'restart-replay-call';
  const approvalId = 'restart-replay-approval';
  const tools = {
    restartApp: {
      kind: 'reversible-write',
      probe: () => ({
        scope: 'liara',
        product: 'paas',
        method: 'POST',
        path: '/v1/projects/demo/actions/restart',
      }),
    },
  };
  const policy = createToolApprovalPolicy(
    { TOOL_APPROVAL_SECRET: VALID_SECRET },
    ['restartApp'],
    'replay-test-account',
  );
  const request = {
    toolCall: { toolCallId, toolName: 'restartApp', input: { appName: 'demo' } },
    tools,
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'tool-approval-request', toolCallId, approvalId },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-approval-response', approvalId, approved: true },
        ],
      },
    ],
  };

  assert.equal((await policy(request)).type, 'user-approval');
  const replay = await policy(request);
  assert.equal(replay.type, 'denied');
  assert.match(replay.reason ?? '', /already consumed|replay/i);
});

test('a historical approval cannot exceed the current turn capability set', async () => {
  const policy = createToolApprovalPolicy(
    { TOOL_APPROVAL_SECRET: VALID_SECRET },
    ['searchDocs', 'askUser'],
  );
  const result = await policy({
    toolCall: {
      toolName: 'restartApp',
      input: { appName: 'demo' },
    },
    tools: {
      restartApp: {
        kind: 'reversible-write',
        probe: () => ({
          scope: 'liara',
          product: 'paas',
          method: 'POST',
          path: '/v1/projects/demo/actions/restart',
        }),
      },
    },
  });

  assert.equal(result.type, 'denied');
  assert.match(result.reason ?? '', /capability set/i);
});
