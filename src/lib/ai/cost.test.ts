import test from 'node:test';
import assert from 'node:assert/strict';

import type { UsageCollector } from './provider';

const { currentFx, estimateToman, summarize } = (await import(
  new URL('cost.ts', import.meta.url).href
)) as typeof import('./cost');

test('baseline pricing applies the catalogue cache-read rate', () => {
  const prices = new Map([
    ['baseline', {
      promptUsdPerToken: 5,
      completionUsdPerToken: 25,
      cachedPromptUsdPerToken: 0.5,
    }],
  ]);

  const uncached = estimateToman(prices, 'baseline', 100, 10, 0);
  const halfCached = estimateToman(prices, 'baseline', 100, 10, 50);
  assert.ok(halfCached < uncached);
  assert.equal(uncached - halfCached, 225 * currentFx());
});

test('cached-token input is clamped and falls back to the normal rate when absent', () => {
  const prices = new Map([
    ['without-cache-price', {
      promptUsdPerToken: 2,
      completionUsdPerToken: 3,
    }],
  ]);

  const regular = estimateToman(prices, 'without-cache-price', 10, 2, 0);
  assert.equal(estimateToman(prices, 'without-cache-price', 10, 2, 99), regular);
  assert.equal(estimateToman(prices, 'without-cache-price', 10, 2, -10), regular);
});

function collector(calls: UsageCollector['calls']): UsageCollector {
  return { calls, pending: [] };
}

const summaryOptions = {
  tier: 'answer' as const,
  escalation: 2 as const,
  routingReason: 'test',
  toolCalls: 1,
};

test('summary preserves a real per-model split across router and answer calls', async () => {
  const result = await summarize(
    collector([
      {
        model: 'deepseek/deepseek-v4-flash',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_cost_toman: 2,
        },
        latencyMs: 10,
        ok: true,
        status: 200,
      },
      {
        model: 'openai/gpt-5.6-luna',
        usage: {
          prompt_tokens: 20,
          completion_tokens: 4,
          total_cost_toman: 5,
        },
        latencyMs: 20,
        ok: true,
        status: 200,
      },
    ]),
    summaryOptions,
  );

  assert.equal(result.toman, 7);
  assert.equal(result.costComplete, true);
  assert.deepEqual(result.modelBreakdown, [
    { model: 'deepseek/deepseek-v4-flash', calls: 1, toman: 2 },
    { model: 'openai/gpt-5.6-luna', calls: 1, toman: 5 },
  ]);
});

test('an unpriced successful failover marks cost incomplete and suppresses savings', async () => {
  const result = await summarize(
    collector([
      {
        model: 'openai/gpt-5.6-luna',
        usage: {
          prompt_tokens: 20,
          completion_tokens: 4,
          cost: 0.001,
        },
        latencyMs: 20,
        ok: true,
        status: 200,
        viaFallback: 'failover-gateway',
      },
    ]),
    summaryOptions,
  );

  assert.equal(result.costComplete, false);
  assert.equal(result.toman, 0);
  assert.equal(result.baselineToman, 0);
  assert.equal(result.savedPercent, 0);
  assert.deepEqual(result.modelBreakdown, [
    { model: 'openai/gpt-5.6-luna', calls: 1, toman: 0 },
  ]);
});
