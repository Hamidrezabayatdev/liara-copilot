/**
 *   node --import ./scripts/register-ts.mjs --test src/lib/retrieval/normalize.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { normalizeFa, tokenizeFa, expandQuery, keepTerm, FA_STOPWORDS } = (await import(
  new URL('normalize.ts', import.meta.url).href
)) as typeof import('./normalize');

test('ZWNJ spellings collapse onto one token', () => {
  assert.equal(normalizeFa('می‌شود'), normalizeFa('میشود'));
  assert.deepEqual(tokenizeFa('می‌شود'), tokenizeFa('میشود'));
});

test('Arabic yeh and kaf fold to Persian', () => {
  assert.equal(normalizeFa('کيفيت'), normalizeFa('کیفیت'));
  assert.equal(normalizeFa('كارت'), normalizeFa('کارت'));
});

test('both digit ranges fold to ASCII', () => {
  assert.equal(normalizeFa('۱۲۳'), '123');
  assert.equal(normalizeFa('١٢٣'), '123');
});

test('diacritics are dropped', () => {
  assert.equal(normalizeFa('مُحَمَّد'), normalizeFa('محمد'));
});

test('function words are stopped but technical words are not', () => {
  assert.equal(keepTerm('از'), false);
  assert.equal(keepTerm('چطور'), false, 'interrogatives are retrieval noise');
  assert.equal(keepTerm('اپ'), true);
  assert.equal(keepTerm('خطا'), true);
  assert.equal(keepTerm('دیپلوی'), true);
  assert.equal(keepTerm('a'), false, 'single characters carry no signal');
});

test('stopwords are stored normalized, so lookups actually hit', () => {
  for (const w of FA_STOPWORDS) assert.equal(w, normalizeFa(w));
});

test('compound identifiers keep the whole and gain the parts', () => {
  const t = tokenizeFa('digishop-api');
  assert.ok(t.includes('digishop-api'));
  assert.ok(t.includes('digishop'));
  assert.ok(t.includes('api'));

  // The docs write "NodeJS"; users write "Node.js". Both must produce `nodejs`.
  assert.ok(tokenizeFa('Node.js').includes('nodejs'));
  assert.ok(tokenizeFa('DATABASE_URL').includes('database'));
});

test('query expansion bridges vocabulary the docs never use', () => {
  // «دیپلوی» appears in zero of the 1125 bundled docs; they all say «استقرار».
  const expanded = expandQuery('چطور اپ را دیپلوی کنم');
  assert.ok(expanded.includes('استقرار'), 'دیپلوی must reach استقرار');
  assert.ok(expanded.includes('برنامه'), 'اپ must reach برنامه');
  assert.ok(expanded.includes('دیپلوی'), 'the original term is kept too');
});

test('English health-check wording reaches the Persian documentation title', () => {
  const expanded = expandQuery('Health Check');
  assert.ok(expanded.includes('سلامت'), 'health must reach سلامت');
  assert.ok(expanded.includes('بررسی'), 'check must reach بررسی');
});
