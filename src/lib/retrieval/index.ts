/**
 * The retrieval entry point. Callers import from here and nothing else.
 *
 * Keyword search always runs; semantic search runs only when it is both enabled
 * and needed. "Needed" is decided by `keywordConfidence`, so an unambiguous
 * question like «خطای 502» costs nothing extra while a vague one can escalate.
 * That adaptive step is the retrieval half of the product's cost story, and the
 * `strategy` field is what the UI reports.
 */
import { bm25Search, keywordConfidence, type Hit } from './bm25';
import { semanticEnabled, semanticSearch } from './semantic';
import type { UsageCollector } from '../ai/provider';

export type { Hit } from './bm25';
export type { Chunk } from './corpus';
export { loadCorpus } from './corpus';
export { bm25Search, keywordConfidence, getIndex } from './bm25';
export { semanticEnabled, semanticSearch } from './semantic';
export { normalizeFa, tokenizeFa, expandQuery } from './normalize';

export type SearchStrategy = 'bm25' | 'hybrid';

export type SearchResult = {
  hits: Hit[];
  /** Which path actually ran. Surfaced in the cost panel. */
  strategy: SearchStrategy;
  /** 0..1 confidence in the keyword pass, before any fusion. */
  keywordConfidence: number;
};

/**
 * Below this, the keyword pass is considered too weak to answer on its own.
 * Tuned against the bundled corpus: a well-matched query scores 0.4–1.0, and a
 * query whose vocabulary is absent from the docs lands under 0.2.
 */
const ESCALATE_BELOW = 0.35;

/**
 * Reciprocal Rank Fusion. Combines rankings without needing the two scoring
 * scales to be comparable — BM25 scores run into the hundreds while cosine
 * similarity is bounded by 1, so nothing useful comes from adding them. RRF only
 * reads positions.
 *
 * k=60 is the value from the original TREC work; it flattens the top of each
 * list so a chunk ranked well by *both* retrievers beats one ranked first by
 * only one of them.
 */
const RRF_K = 60;

function fuse(lists: Hit[][], limit: number): Hit[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, Hit>();

  for (const list of lists) {
    list.forEach((hit, i) => {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (RRF_K + i + 1));
      if (!byId.has(hit.id)) byId.set(hit.id, hit);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...byId.get(id)!, score }));
}

export async function searchDocs(
  query: string,
  opts?: { limit?: number; forceSemantic?: boolean; collector?: UsageCollector },
): Promise<SearchResult> {
  const limit = opts?.limit ?? 6;

  // Over-fetch the keyword pass: fusion needs depth to reorder within.
  const keyword = await bm25Search(query, Math.max(limit, 8));
  const confidence = keywordConfidence(keyword);

  const wantSemantic =
    opts?.forceSemantic === true || (semanticEnabled() && confidence < ESCALATE_BELOW);

  if (!wantSemantic) {
    return { hits: keyword.slice(0, limit), strategy: 'bm25', keywordConfidence: confidence };
  }

  const semantic = await semanticSearch(query, Math.max(limit, 8), opts?.collector);
  if (semantic.length === 0) {
    // Enabled but unavailable (no vector file, or the call failed). Report the
    // path that actually ran rather than the one that was requested.
    return { hits: keyword.slice(0, limit), strategy: 'bm25', keywordConfidence: confidence };
  }

  return {
    hits: fuse([keyword, semantic], limit),
    strategy: 'hybrid',
    keywordConfidence: confidence,
  };
}
