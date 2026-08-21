/**
 *   node --import ./scripts/register-ts.mjs --test src/lib/retrieval/retrieval.test.ts
 *
 * Runs against the real bundled corpus in `data/docs`, because the thing worth
 * testing is whether Persian questions actually find the right Liara page — a
 * fixture corpus would only test the plumbing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { loadCorpus } = (await import(
  new URL('corpus.ts', import.meta.url).href
)) as typeof import('./corpus');
const { bm25Search, keywordConfidence } = (await import(
  new URL('bm25.ts', import.meta.url).href
)) as typeof import('./bm25');
const { searchDocs } = (await import(
  new URL('index.ts', import.meta.url).href
)) as typeof import('./index');

test('the corpus parses into a usable number of chunks', async () => {
  const chunks = await loadCorpus();
  assert.ok(chunks.length > 2000, `only ${chunks.length} chunks`);
  for (const c of chunks.slice(0, 200)) {
    assert.match(c.url, /^https:\/\/docs\.liara\.ir\//);
    assert.ok(c.title.length > 0);
    assert.ok(c.text.length >= 80);
  }
});

test('chunk ids are unique, so the vector store can key on them', async () => {
  const chunks = await loadCorpus();
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
});

/** [query, a path fragment one of the top 3 urls must contain] */
const EXPECTED: Array<[string, RegExp]> = [
  ['چطور اپ Node.js را دیپلوی کنم', /nodejs|paas/],
  ['متغیرهای محیطی', /envs|environment/],
  ['دیتابیس PostgreSQL', /postgre/],
  ['چطور اپ را ری‌استارت کنم', /restart|paas/],
  ['بکاپ دیتابیس', /backup|dbaas/],
];

for (const [query, expected] of EXPECTED) {
  test(`«${query}» finds a relevant page in the top 3`, async () => {
    const hits = await bm25Search(query, 5);
    assert.ok(hits.length > 0, 'no hits at all');
    const top3 = hits.slice(0, 3).map((h) => h.url);
    assert.ok(
      top3.some((u) => expected.test(u)),
      `none of ${JSON.stringify(top3)} matched ${expected}`,
    );
  });
}

test('«خطای 502» is unambiguous, so confidence is high', async () => {
  const hits = await bm25Search('خطای 502', 5);
  assert.ok(hits.length > 0);
  assert.ok(hits[0].score > 0);
  assert.ok(
    keywordConfidence(hits) > 0.5,
    `a query this specific should not look ambiguous (got ${keywordConfidence(hits)})`,
  );
});

test('confidence is 0 for an empty result and never exceeds 1', async () => {
  assert.equal(keywordConfidence([]), 0);
  for (const q of ['متغیرهای محیطی', 'خطای 502', 'لیارا چیست', 'قیمت دیسک']) {
    const c = keywordConfidence(await bm25Search(q, 8));
    assert.ok(c >= 0 && c <= 1, `${q} → ${c}`);
  }
});

test('one source is never shown three times', async () => {
  const hits = await bm25Search('دیتابیس PostgreSQL', 6);
  const docIds = hits.map((h) => h.docId);
  assert.equal(new Set(docIds).size, docIds.length, `duplicated docs: ${docIds.join(', ')}`);
});

test('semantic search stays off unless explicitly enabled', async () => {
  delete process.env.ENABLE_SEMANTIC_RAG;
  const res = await searchDocs('چطور اپ را ری‌استارت کنم');
  assert.equal(res.strategy, 'bm25');
  assert.ok(res.hits.length > 0);
  assert.ok(res.hits.every((h) => h.url.startsWith('https://docs.liara.ir/')));
});

test('enabling the flag without a vector file degrades to keyword search', async () => {
  process.env.ENABLE_SEMANTIC_RAG = 'true';
  process.env.DOCS_VECTORS_PATH = 'data/does-not-exist.json';
  try {
    const res = await searchDocs('یک سؤال مبهم دربارهٔ سرویس');
    assert.equal(res.strategy, 'bm25', 'must not claim hybrid when no vectors exist');
  } finally {
    delete process.env.ENABLE_SEMANTIC_RAG;
    delete process.env.DOCS_VECTORS_PATH;
  }
});
