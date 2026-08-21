import assert from 'node:assert/strict';
import test from 'node:test';

import type { UsageCollector } from '@/lib/ai/provider';

const telemetry = (await import(
  new URL('telemetry.ts', import.meta.url).href
)) as typeof import('./telemetry');

test('request ids accept only short log-safe upstream values', () => {
  const accepted = new Request('https://copilot.example/api/chat', {
    headers: { 'x-request-id': 'edge_123.ok' },
  });
  const rejected = new Request('https://copilot.example/api/chat', {
    headers: { 'x-request-id': 'not safe with spaces' },
  });

  assert.equal(telemetry.requestIdFor(accepted), 'edge_123.ok');
  assert.match(telemetry.requestIdFor(rejected), /^[0-9a-f-]{36}$/);
});

test('account labels are stable and do not reveal their inputs', () => {
  const first = telemetry.accountHash('very-secret-token-value', 'team-one');
  const again = telemetry.accountHash('very-secret-token-value', 'team-one');
  const other = telemetry.accountHash('very-secret-token-value', 'team-two');

  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.equal(first.includes('secret'), false);
  assert.equal(first.length, 16);
});

test('collector telemetry contains operational numbers but no raw request data', () => {
  const collector: UsageCollector = {
    calls: [{
      model: 'provider/model',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        total_cost_toman: 9,
      },
      latencyMs: 80,
      ok: true,
      status: 200,
    }],
    pending: [],
    attemptedCalls: 1,
    summary: { tier: 'answer', escalation: 2, toolCalls: 3 },
  };

  assert.deepEqual(telemetry.summarizeCollectorForTelemetry(collector), {
    tier: 'answer',
    escalation: 2,
    modelCalls: 1,
    attemptedModelCalls: 1,
    models: ['provider/model'],
    toolCalls: 3,
    promptTokens: 12,
    completionTokens: 4,
    costToman: 9,
    providerLatencyMs: 80,
    failedCalls: 0,
    fallbackUsed: false,
    callBudgetExceeded: false,
  });
});
