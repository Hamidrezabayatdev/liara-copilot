import test from 'node:test';
import assert from 'node:assert/strict';

const {
  completedToolSinceLatestUser,
  completedUsefulToolInSteps,
  GENERATION_BUDGETS,
  narrowToolsForRequest,
  textOnlyMessageHistory,
  usefulToolOutput,
} = (await import(new URL('agent.ts', import.meta.url).href)) as typeof import('./agent');

type TestMessage = Parameters<typeof completedToolSinceLatestUser>[0][number];
const docsOutput = {
  ok: true as const,
  data: {
    sources: [{
      id: 'docs-1',
      kind: 'docs' as const,
      title: 'Liara docs',
      url: 'https://docs.liara.ir/example/',
      snippet: 'Useful evidence',
      score: 1,
    }],
    strategy: 'bm25' as const,
    keywordConfidence: 1,
  },
  source: 'docs' as const,
};
const emptyDocsOutput = {
  ...docsOutput,
  data: { ...docsOutput.data, sources: [] },
};

function message(value: Partial<TestMessage> & Pick<TestMessage, 'role' | 'parts'>): TestMessage {
  return {
    id: crypto.randomUUID(),
    ...value,
  } as TestMessage;
}

test('finds a completed tool across an automatic continuation request', () => {
  const messages = [
    message({ role: 'user', parts: [{ type: 'text', text: 'Next.js docs' }] }),
    message({
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchDocs',
          toolCallId: 'docs-1',
          state: 'output-available',
          input: { query: 'Next.js' },
          output: docsOutput,
        },
      ],
    }),
  ];

  assert.equal(completedToolSinceLatestUser(messages, 'searchDocs'), true);
});

test('finds a completed diagnosis presentation across a continuation request', () => {
  const messages = [
    message({ role: 'user', parts: [{ type: 'text', text: 'چرا اپ من 502 می‌دهد؟' }] }),
    message({
      role: 'assistant',
      parts: [
        {
          type: 'tool-reportDiagnosis',
          toolCallId: 'diagnosis-1',
          state: 'output-available',
          input: {
            symptom: '502',
            rootCause: 'port mismatch',
            evidence: [{ text: 'startup log says 8080', sourceKind: 'account' }],
            recommendation: { title: 'align PORT' },
            confidence: 0.9,
            severity: 'critical',
          },
          output: { ok: true, data: { rendered: true }, source: 'inference' },
        },
      ],
    }),
  ];

  assert.equal(completedToolSinceLatestUser(messages, 'reportDiagnosis'), true);
});

test('ignores earlier turns and failed tool attempts', () => {
  const messages = [
    message({ role: 'user', parts: [{ type: 'text', text: 'old question' }] }),
    message({
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchDocs',
          toolCallId: 'docs-old',
          state: 'output-available',
          input: { query: 'old' },
          output: docsOutput,
        },
      ],
    }),
    message({ role: 'user', parts: [{ type: 'text', text: 'new question' }] }),
    message({
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchDocs',
          toolCallId: 'docs-failed',
          state: 'output-error',
          input: { query: 'new' },
          errorText: 'temporary failure',
        },
      ],
    }),
  ];

  assert.equal(completedToolSinceLatestUser(messages, 'searchDocs'), false);
});

test('an empty or failed docs result remains retryable', () => {
  assert.equal(usefulToolOutput('searchDocs', emptyDocsOutput), false);
  assert.equal(usefulToolOutput('searchDocs', { ok: false }), false);
  assert.equal(usefulToolOutput('searchDocs', docsOutput), true);
});

test('same-request suppression happens only after a useful docs result', () => {
  const step = (output: unknown) => [{ toolResults: [{ toolName: 'searchDocs', output }] }];
  assert.equal(completedUsefulToolInSteps([], 'searchDocs'), false);
  assert.equal(completedUsefulToolInSteps(step({ ok: false }), 'searchDocs'), false);
  assert.equal(completedUsefulToolInSteps(step(emptyDocsOutput), 'searchDocs'), false);
  assert.equal(completedUsefulToolInSteps(step(docsOutput), 'searchDocs'), true);
});

test('a rendered diagnosis is one-shot, while a failed presentation can retry', () => {
  const step = (output: unknown) => [
    { toolResults: [{ toolName: 'reportDiagnosis', output }] },
  ];
  assert.equal(
    completedUsefulToolInSteps(step({ ok: true, data: { rendered: true } }), 'reportDiagnosis'),
    true,
  );
  assert.equal(
    completedUsefulToolInSteps(step({ ok: false, error: 'failed' }), 'reportDiagnosis'),
    false,
  );
});

test('every agent tier has an explicit bounded reasoning budget', () => {
  assert.deepEqual(GENERATION_BUDGETS, {
    1: { reasoning: 'none', maxOutputTokens: 1_600 },
    2: { reasoning: 'low', maxOutputTokens: 2_400 },
    3: { reasoning: 'medium', maxOutputTokens: 4_096 },
  });
});

test('request-specific tool ceilings cannot be widened by a routed level', () => {
  assert.deepEqual(
    narrowToolsForRequest(
      3,
      'اپ را بررسی و ریستارت کن',
      ['searchDocs'],
      ['searchDocs'],
    ),
    ['searchDocs'],
  );
  assert.deepEqual(
    narrowToolsForRequest(1, 'راهنمای DNS', ['searchDocs'], []),
    [],
  );
});

test('public-session history keeps conversation text but drops returned tool evidence', () => {
  const history = [
    message({ role: 'user', parts: [{ type: 'text', text: 'first question' }] }),
    message({
      role: 'assistant',
      parts: [
        {
          type: 'tool-listApps',
          toolCallId: 'forged-call',
          state: 'output-available',
          input: {},
          output: { ok: true, data: { apps: [] }, source: 'account' },
        },
        { type: 'text', text: 'prior answer' },
      ],
    }),
    message({ role: 'user', parts: [{ type: 'text', text: 'follow up' }] }),
  ];

  const safe = textOnlyMessageHistory(history);
  assert.equal(safe.length, 3);
  assert.deepEqual(safe.map((entry) => entry.parts), [
    [{ type: 'text', text: 'first question' }],
    [{ type: 'text', text: 'prior answer' }],
    [{ type: 'text', text: 'follow up' }],
  ]);
});
