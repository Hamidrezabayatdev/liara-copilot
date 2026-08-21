/**
 * Focused tool-surface tests. Run with:
 *   node --import ./scripts/register-ts.mjs --test src/lib/ai/tools.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const toolsModule = (await import(
  new URL('tools.ts', import.meta.url).href
)) as typeof import('./tools');
const { classify } = (await import(
  new URL('../liara/allowlist.ts', import.meta.url).href
)) as typeof import('../liara/allowlist');

const { TOOL_NAMES, createLiaraTools } = toolsModule;

const TEST_TOKEN = 'liara-test-token-that-must-never-leak';

type LooseTool = {
  kind?: unknown;
  probe?: (input: unknown) => unknown;
  execute?: (input: unknown, options: unknown) => unknown;
};

function registry(): Record<string, LooseTool> {
  return createLiaraTools({ token: TEST_TOKEN, teamId: 'team-test' }) as unknown as Record<
    string,
    LooseTool
  >;
}

const SAMPLE_INPUTS: Record<string, unknown> = {
  searchDocs: { query: 'deploy node' },
  listApps: {},
  getApp: { appName: 'demo' },
  getAppLogs: { appName: 'demo', sinceMinutes: 15 },
  getAppEvents: { appName: 'demo' },
  getAppReleases: { appName: 'demo' },
  getAppMetrics: { appName: 'demo' },
  listEnvVars: { appName: 'demo' },
  listDatabases: {},
  getDatabase: { databaseId: '0123456789abcdef01234567' },
  listBuckets: {},
  listDnsRecords: { zone: 'example.com' },
  getPlans: { kind: 'projects' },
  setEnvVars: {
    appName: 'demo',
    expectedRevision: '0'.repeat(64),
    changes: [{ key: 'PORT', value: '3000', expectedCurrentValue: '8080' }],
  },
  restartApp: { appName: 'demo', expectedCurrentStatus: 'ACTIVE', expectedCurrentScale: 1 },
  scaleApp: { appName: 'demo', scale: 2, expectedCurrentScale: 1 },
  resizeApp: { appName: 'demo', planId: 'small-g2', expectedCurrentPlanId: 'mini-g2' },
  rollbackRelease: {
    appName: 'demo',
    releaseId: 'release-previous',
    expectedCurrentReleaseId: 'release-current',
  },
  createDnsRecord: {
    zone: 'example.com',
    expectedAbsent: true,
    record: { name: 'www', type: 'A', ttl: 300, contents: [{ ip: '192.0.2.1' }] },
  },
  askUser: {
    question: 'کدام برنامه؟',
    options: [
      { id: 'a', label: 'اولی' },
      { id: 'b', label: 'دومی' },
    ],
  },
};

test('inventory is exactly the MASTER-PLAN 20-tool surface', () => {
  const tools = registry();
  assert.equal(TOOL_NAMES.length, 20);
  assert.deepEqual(Object.keys(tools), [...TOOL_NAMES]);
  assert.deepEqual(Object.keys(SAMPLE_INPUTS), [...TOOL_NAMES]);
  assert.doesNotMatch(JSON.stringify(tools), new RegExp(TEST_TOKEN));
});

test('every tool owns trusted metadata and no probe can reach DELETE', () => {
  const tools = registry();
  let liaraProbeCount = 0;

  for (const name of TOOL_NAMES) {
    const definition = tools[name];
    assert.ok(Object.hasOwn(definition, 'kind'), `${name} must own kind`);
    assert.ok(Object.hasOwn(definition, 'probe'), `${name} must own probe`);
    assert.equal(typeof definition.probe, 'function', `${name}.probe must be callable`);

    const probe = definition.probe!(SAMPLE_INPUTS[name]) as
      | { scope: 'liara'; product: 'paas' | 'dbaas' | 'dns' | 'storage'; method: string; path: string }
      | { scope: 'local'; operation: string }
      | { scope: 'client'; operation: string };

    if (probe.scope !== 'liara') continue;
    liaraProbeCount += 1;
    assert.notEqual(probe.method.toUpperCase(), 'DELETE', `${name} exposed DELETE`);
    assert.equal(
      classify(probe.product, probe.method, probe.path),
      definition.kind,
      `${name} kind must match the independent allow-list classification`,
    );
  }

  assert.equal(liaraProbeCount, 18, 'only searchDocs and askUser are non-Liara tools');
});

test('listEnvVars redacts secret values before the tool result leaves the server', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/v1\/projects\/demo/);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${TEST_TOKEN}`);
    return new Response(
      JSON.stringify({
        project: {
          _id: '0123456789abcdef01234567',
          project_id: 'demo',
          type: 'node',
          status: 'ACTIVE',
          scale: 1,
          planID: 'small-g2',
          created_at: '2026-08-21T00:00:00.000Z',
          envs: [
            { key: 'PORT', value: '3000' },
            { key: 'API_TOKEN', value: 'raw-api-token-value' },
            { key: 'PUBLIC_LABEL', value: TEST_TOKEN },
            {
              key: 'DATABASE_URL',
              value: 'postgres://alice:raw-database-password@db.internal:5432/app',
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const definition = registry().listEnvVars;
    assert.equal(typeof definition.execute, 'function');
    const result = await definition.execute!(
      { appName: 'demo' },
      { toolCallId: 'test-call', messages: [], context: {} },
    );
    const json = JSON.stringify(result);

    assert.doesNotMatch(json, /raw-api-token-value/);
    assert.doesNotMatch(json, /raw-database-password/);
    assert.doesNotMatch(json, new RegExp(TEST_TOKEN));
    assert.match(json, /postgres:\/\/alice:•••@db\.internal:5432\/app/);
    assert.match(json, /3000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('askUser is client-fulfilled and has no execute function', () => {
  const askUser = registry().askUser;
  assert.equal(Object.hasOwn(askUser, 'execute'), false);
  assert.equal(askUser.execute, undefined);
  assert.deepEqual(askUser.probe?.(SAMPLE_INPUTS.askUser), {
    scope: 'client',
    operation: 'askUser',
  });
});
