/**
 * Focused model-tier tests. Run with:
 *   node --import ./scripts/register-ts.mjs --test src/lib/ai/provider.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { DEFAULT_MODELS, MODELS, modelIdFor } = (await import(
  new URL('provider.ts', import.meta.url).href
)) as typeof import('./provider');

test('cost-aware defaults use the verified Liara model ids', () => {
  assert.deepEqual(DEFAULT_MODELS, {
    router: 'deepseek/deepseek-v4-flash',
    answer: 'openai/gpt-5.6-luna',
    reason: 'google/gemini-3.7-flash',
    baseline: 'anthropic/claude-opus-5',
    embed: 'intfloat/multilingual-e5-large',
  });
});

test('tier lookup honors an explicit environment override', () => {
  const previous = process.env.MODEL_ANSWER;
  process.env.MODEL_ANSWER = 'test/provider-model';

  try {
    assert.equal(MODELS.answer(), 'test/provider-model');
    assert.equal(modelIdFor('answer'), 'test/provider-model');
  } finally {
    if (previous === undefined) delete process.env.MODEL_ANSWER;
    else process.env.MODEL_ANSWER = previous;
  }
});
