/**
 * Router tests. Run with:
 *
 *   node --import ./scripts/register-ts.mjs --test src/lib/ai/router.test.ts
 *
 * Two bits of plumbing, both for the same reason — Node 24 strips types but
 * will not resolve an extensionless relative specifier, and tsc rejects a
 * literal `.ts` in a static import. The dynamic `new URL(...)` handles this
 * file's own import; `register-ts.mjs` handles router.ts's imports.
 *
 * Every assertion below must pass with `collector.calls.length === 0`. A model
 * call in this suite means a heuristic regressed into ambiguity — the whole
 * point of the deterministic pass is that routing is free for real questions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { route, ROUTER_GENERATION_BUDGET } = (await import(
  new URL('router.ts', import.meta.url).href
)) as typeof import('./router');

const collector = { calls: [] };

test('fallback model routing has a tiny explicit generation budget', () => {
  assert.deepEqual(ROUTER_GENERATION_BUDGET, {
    reasoning: 'none',
    maxOutputTokens: 256,
    maxRetries: 1,
  });
});

/** [message, expected level, why this case exists] */
const CASES: Array<[string, 1 | 2 | 3, string]> = [
  // ---- Level 1: answerable from docs alone, no account access needed.
  ['لیارا چیست و چه سرویس‌هایی دارد؟', 1, 'general docs question'],
  ['چطور یک برنامه Node.js را روی لیارا دیپلوی کنم؟', 1, 'how-to: «دیپلوی کنم» contains the imperative «دیپلوی کن»'],
  ['تفاوت پلن‌های میرزاخانی و تورینگ چیست؟', 1, 'plan comparison'],
  ['قیمت دیسک چند است؟', 1, 'pricing frame must outrank the bare resource noun «دیسک»'],
  ['میشود دامنه اضافه کرد؟', 1, 'capability question, not a request to add one'],
  ['چطور اپ را ری‌استارت کنم؟', 1, 'how-to with an imperative substring'],

  // ---- Level 2: needs the account's current state, but nothing is broken.
  ['لیست اپ‌های من را نشان بده', 2, 'account read'],
  ['وضعیت دیتابیس‌های من چطور است؟', 2, 'state verb + possessive'],
  ['متغیرهای محیطی digishop-api را بگو', 2, 'weak noun rescued by a resource name'],
  ['مصرف RAM اپم چقدر است؟', 2, 'metrics'],
  ['لاگ‌های digishop-front را ببین', 2, 'weak noun rescued by an activator'],

  // ---- Level 3: something is wrong, or the user wants a write.
  ['اپ digishop-api خطای 502 می‌دهد', 3, 'failure symptom; «خطا» must prefix-match «خطای»'],
  ['چرا دیپلوی من شکست خورد؟', 3, 'diagnosis phrased as a question stays level 3'],
  ['برنامه‌ام بالا نمیاد، بررسی کن', 3, 'down + inspect'],
  ['متغیر DATABASE_URL را برای digishop-api ست کن', 3, 'write intent'],
  ['اپ را ری‌استارت کن', 3, 'bare imperative restart'],
  ['digishop-worker را اسکیل کن به ۲', 3, 'scale write, Persian digit'],
  ['اپم داون است', 3, 'terse failure, no interrogative'],
];

for (const [message, want, note] of CASES) {
  test(`L${want} — ${note}`, async () => {
    const before = collector.calls.length;
    const d = await route(message, { collector });
    assert.equal(d.escalation, want, `«${message}» → L${d.escalation} (${d.routingReason})`);
    assert.equal(collector.calls.length, before, 'routing must not cost a model call');
  });
}

// A bare «بله» carries no signal of its own; it only means anything relative to
// what was just asked, so it must inherit rather than fall back to the default.
for (const previousLevel of [2, 3] as const) {
  test(`a terse «بله» inherits level ${previousLevel}`, async () => {
    const d = await route('بله', { previousLevel, collector });
    assert.equal(d.escalation, previousLevel);
    assert.equal(d.decidedBy, 'continuity');
  });
}

// Without that context the same word is meaningless, and level 2 is the safe
// middle: it can read state to work out what the user meant.
test('a terse «بله» with no history does not inherit', async () => {
  const d = await route('بله', { collector });
  assert.notEqual(d.decidedBy, 'continuity');
});

test('routing was free for the entire suite', () => {
  assert.equal(collector.calls.length, 0, `${collector.calls.length} model call(s) leaked`);
});
