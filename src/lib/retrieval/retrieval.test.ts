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
const { dedupeNearDuplicateHits, searchDocs, selectRelevantHits } = (await import(
  new URL('index.ts', import.meta.url).href
)) as typeof import('./index');

function scoredHits(scores: number[]) {
  return scores.map((score, index) => ({ id: String(index), score }));
}

function docsHit(overrides: Partial<import('./bm25').Hit>): import('./bm25').Hit {
  return {
    id: crypto.randomUUID(),
    docId: crypto.randomUUID(),
    title: 'اتصال به PostgreSQL',
    section: 'اتصال به PostgreSQL',
    text: 'برای اتصال به دیتابیس PostgreSQL از متغیر محیطی و connection pooling استفاده کنید.',
    url: 'https://docs.liara.ir/dbaas/postgresql/connect/',
    score: 1,
    ...overrides,
  };
}

test('adaptive cutoff keeps only a dominant documentation result', () => {
  const selected = selectRelevantHits(scoredHits([100, 33, 32, 17, 17]), {
    maxResults: 5,
  });
  assert.deepEqual(selected.map(({ score }) => score), [100]);
});

test('adaptive cutoff keeps the useful cluster before the score elbow', () => {
  const selected = selectRelevantHits(scoredHits([80, 70, 50, 23, 12]), {
    maxResults: 5,
  });
  assert.deepEqual(selected.map(({ score }) => score), [80, 70, 50]);
});

test('flat rankings use the cap instead of an arbitrary early cutoff', () => {
  const selected = selectRelevantHits(scoredHits([100, 80, 60, 40, 20, 10]), {
    maxResults: 6,
  });
  assert.deepEqual(selected.map(({ score }) => score), [100, 80, 60, 40]);
});

test('adaptive cutoff always keeps a winner for unusable score scales', () => {
  assert.deepEqual(selectRelevantHits(scoredHits([0, 0, 0])).map(({ id }) => id), ['0']);
  assert.deepEqual(selectRelevantHits(scoredHits([Number.NaN, 10])).map(({ id }) => id), ['0']);
  assert.ok(selectRelevantHits(scoredHits([10, 9]), { maxResults: Number.NaN }).length > 0);
});

test('canonical duplicate replacement preserves the strongest ranking score', () => {
  const wrongUrl = docsHit({
    id: 'wrong-url',
    url: 'https://docs.liara.ir/dbaas/elastic-search/connect/',
    score: 100,
  });
  const distinct = docsHit({
    id: 'distinct',
    title: 'راه‌اندازی PostgreSQL',
    section: 'راه‌اندازی PostgreSQL',
    text: 'یک دیتابیس تازه بسازید و سپس وضعیت آماده بودن آن را در پنل بررسی کنید.',
    url: 'https://docs.liara.ir/dbaas/postgresql/quick-setup/',
    score: 90,
  });
  const canonical = docsHit({ id: 'canonical', score: 40 });

  const selected = dedupeNearDuplicateHits([wrongUrl, distinct, canonical]);
  assert.equal(selected[0].id, 'canonical');
  assert.equal(selected[0].score, 100);
  assert.ok(selected[0].score >= selected[1].score, 'dedupe must not break rank order');
});

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

test('copied snapshot pages do not surface under a mismatched product URL', async () => {
  const result = await searchDocs('دیتابیس PostgreSQL', { limit: 6 });
  assert.ok(result.hits.length > 0);
  assert.ok(
    result.hits.every((hit) => !hit.url.includes('/elastic-search/')),
    `mismatched sources: ${result.hits.map((hit) => hit.url).join(', ')}`,
  );
});

test('semantic search stays off unless explicitly enabled', async () => {
  delete process.env.ENABLE_SEMANTIC_RAG;
  const res = await searchDocs('چطور اپ را ری‌استارت کنم');
  assert.equal(res.strategy, 'bm25');
  assert.ok(res.hits.length > 0);
  assert.ok(res.hits.every((h) => h.url.startsWith('https://docs.liara.ir/')));
});

test('weak lexical overlap returns no evidence instead of forcing a winner', async () => {
  // «مریخ» is a real Liara plan name, but that isolated collision must not
  // ground an unrelated four-concept question.
  const res = await searchDocs('کوانتوم موز بنفش در مریخ', { limit: 6 });
  assert.equal(res.strategy, 'bm25');
  assert.deepEqual(res.hits, []);
});

test('the weak-evidence gate preserves broad and synonym-backed docs questions', async () => {
  for (const query of ['لیارا چیست؟', 'چرا باید از Object Storage استفاده کنم؟', 'دیپلوی اپ']) {
    const res = await searchDocs(query, { limit: 6 });
    assert.ok(res.hits.length > 0, `«${query}» lost its documentation evidence`);
  }
});

test('mixed English/Persian health-check intent selects the official health-check page first', async () => {
  const result = await searchDocs(
    'تنظیمات Health Check برنامه Next.js روی Liara مسیر پورت interval timeout',
    { limit: 6 },
  );
  assert.ok(result.hits.length > 0);
  assert.match(result.hits[0].url, /\/paas\/details\/health-check\/?$/);
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
