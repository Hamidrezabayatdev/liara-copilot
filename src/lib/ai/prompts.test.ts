import test from 'node:test';
import assert from 'node:assert/strict';

const { systemPromptFor } = (await import(
  new URL('prompts.ts', import.meta.url).href
)) as typeof import('./prompts');

test('simple turns do not pay for unrelated skill instructions', () => {
  const prompt = systemPromptFor(1, 'لیارا چیست؟');
  assert.doesNotMatch(prompt, /Skill: Diagnose|Skill: Environment|Skill: Architecture/);
});

test('diagnosis turns require one grounded structured verdict', () => {
  const prompt = systemPromptFor(3, 'چرا اپ من خطای 502 می‌دهد؟');
  assert.match(prompt, /reportDiagnosis/);
  assert.match(prompt, /دقیقاً یک‌بار/);
  assert.match(prompt, /شواهدی.*واقعاً/);
  assert.doesNotMatch(prompt, /Skill: Architecture/);
});

test('environment workflow never promises unsupported replacement', () => {
  const prompt = systemPromptFor(3, 'متغیر محیطی PORT را تغییر بده');
  assert.match(prompt, /فقط merge امن/);
  assert.match(prompt, /replace کامل.*Console/);
});

test('architecture workflow is injected only for architecture intent', () => {
  const prompt = systemPromptFor(2, 'برای معماری workload من پیشنهاد بده');
  assert.match(prompt, /Skill: Architecture recommendation/);
  assert.doesNotMatch(prompt, /Skill: Diagnose/);
});
