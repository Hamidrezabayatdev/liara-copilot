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
import { expandQuery, keepTerm, tokenizeFa } from './normalize';
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
 * The model rarely benefits from more than a few documentation excerpts. More
 * importantly, a fixed result count makes a single excellent match travel with
 * four weak ones. This cap is intentionally below the search over-fetch depth:
 * we still inspect the next result to find the score elbow, but do not pay to
 * send it to the model or render it in the UI.
 */
const MAX_RELEVANT_HITS = 4;
const MIN_RELATIVE_SCORE = 0.2;
// Twenty percentage points is large enough to be a visible relevance boundary,
// not ordinary ranking noise (for example 100 → 85 should remain a cluster).
const MIN_SCORE_GAP = 0.2;

/**
 * Words that identify the documentation collection, not the user's subject.
 * A hit matching only «لیارا» does not ground a question about an unrelated
 * concept, while a genuinely broad query such as «لیارا چیست؟» is still valid.
 */
const GENERIC_DOC_TERMS = new Set([
  'لیارا', 'liara', 'پلتفرم', 'platform', 'سرویس', 'service', 'محصول',
  'راهنما', 'مستندات', 'docs', 'داکیومنت',
]);

export type RelevanceOptions = {
  /** Caller-requested ceiling; the global context cap still applies. */
  maxResults?: number;
  /** Smallest score relative to the winner that can survive. */
  minRelativeScore?: number;
  /** Smallest top-normalised adjacent drop considered a real elbow. */
  minScoreGap?: number;
};

function contentFingerprint(hit: Hit): string {
  // The beginning of a documentation section carries its identity. Tokenizing
  // makes the fingerprint insensitive to punctuation/ZWNJ and catches snapshot
  // pages copied under a second, incorrect URL without expensive embeddings.
  return tokenizeFa(`${hit.section} ${hit.text}`).slice(0, 96).join(' ');
}

function canonicalAffinity(hit: Hit): number {
  const urlTokens = new Set(tokenizeFa(hit.url));
  let matches = 0;
  for (const token of new Set(tokenizeFa(`${hit.title} ${hit.section}`))) {
    if (token.length >= 4 && urlTokens.has(token)) matches += 1;
  }
  return matches;
}

function termMatchesDocument(term: string, documentTerms: ReadonlySet<string>): boolean {
  for (const documentTerm of documentTerms) {
    if (term === documentTerm) return true;
    // The index deliberately supports prefixes for Persian suffixes. Apply the
    // same conservative rule to this evidence gate so «خطا» matches «خطای».
    if (
      Math.min(term.length, documentTerm.length) >= 3 &&
      (term.startsWith(documentTerm) || documentTerm.startsWith(term))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Reject accidental BM25 winners that only share a generic or isolated word.
 *
 * MiniSearch uses OR matching, so an out-of-domain question can otherwise get
 * a plausible-looking top result merely because one word is also a Liara plan
 * name. We group synonyms per original query concept and require one selected
 * excerpt to cover at least half of the meaningful concepts. This is a cheap,
 * deterministic grounding gate; an intentionally broad Liara query has no
 * discriminating concepts and is allowed through.
 */
export function hasLexicalEvidence(query: string, hits: readonly Hit[]): boolean {
  if (hits.length === 0) return false;

  const concepts = [...new Set(tokenizeFa(query).filter(keepTerm))]
    .filter((term) => !GENERIC_DOC_TERMS.has(term))
    .map((term) => [...new Set(expandQuery(term).filter(keepTerm))]);

  if (concepts.length === 0) return true;
  const requiredMatches = Math.ceil(concepts.length / 2);

  return hits.some((hit) => {
    const documentTerms = new Set(tokenizeFa(`${hit.title} ${hit.section} ${hit.text}`));
    let matchedConcepts = 0;
    for (const alternatives of concepts) {
      if (alternatives.some((term) => termMatchesDocument(term, documentTerms))) {
        matchedConcepts += 1;
        if (matchedConcepts >= requiredMatches) return true;
      }
    }
    return false;
  });
}

function selectKeywordEvidence(query: string, hits: readonly Hit[], limit: number): Hit[] {
  const selected = selectRelevantHits(hits, { maxResults: limit });
  return hasLexicalEvidence(query, selected) ? selected : [];
}

/** Keep one representative for near-identical excerpts, preferring its canonical URL. */
export function dedupeNearDuplicateHits(hits: readonly Hit[]): Hit[] {
  const result: Hit[] = [];
  const byFingerprint = new Map<string, number>();

  for (const hit of hits) {
    const fingerprint = contentFingerprint(hit);
    const existingIndex = byFingerprint.get(fingerprint);
    if (existingIndex === undefined || fingerprint.length === 0) {
      byFingerprint.set(fingerprint, result.length);
      result.push(hit);
      continue;
    }

    if (canonicalAffinity(hit) > canonicalAffinity(result[existingIndex])) {
      const existing = result[existingIndex];
      // The score belongs to the matched content, while the replacement only
      // chooses its better canonical URL. Preserve the strongest score so this
      // still is a descending ranking for confidence and elbow calculations.
      result[existingIndex] = { ...hit, score: Math.max(existing.score, hit.score) };
    }
  }

  return result;
}

/**
 * Select the useful head of an already-ranked result list.
 *
 * Scores are normalised to the top result so this works for BM25, cosine, and
 * RRF despite their different scales. The strongest adjacent drop is the
 * natural cutoff, provided it is meaningful. Equal gaps prefer the later one,
 * which avoids collapsing a smooth ranking to one arbitrary result. A relative
 * floor and hard cap handle rankings with no obvious elbow.
 */
export function selectRelevantHits<T extends { score: number }>(
  hits: readonly T[],
  options: RelevanceOptions = {},
): T[] {
  if (hits.length === 0) return [];

  const requestedValue = options.maxResults ?? MAX_RELEVANT_HITS;
  const requested = Number.isFinite(requestedValue)
    ? Math.max(1, Math.floor(requestedValue))
    : MAX_RELEVANT_HITS;
  const maxResults = Math.min(requested, MAX_RELEVANT_HITS, hits.length);
  const relativeValue = options.minRelativeScore ?? MIN_RELATIVE_SCORE;
  const gapValue = options.minScoreGap ?? MIN_SCORE_GAP;
  const minRelativeScore = Number.isFinite(relativeValue)
    ? Math.min(1, Math.max(0, relativeValue))
    : MIN_RELATIVE_SCORE;
  const minScoreGap = Number.isFinite(gapValue)
    ? Math.min(1, Math.max(0, gapValue))
    : MIN_SCORE_GAP;
  const topScore = hits[0].score;

  // A non-positive/non-finite ranking carries no useful relative scale. Keep
  // the winner rather than inventing confidence or returning an empty answer.
  if (!Number.isFinite(topScore) || topScore <= 0) return [hits[0]];

  // One look-ahead result lets a drop immediately after the requested result
  // count confirm that all requested results belong to the useful head.
  const inspected = hits.slice(0, Math.min(hits.length, maxResults + 1));
  const ratios = inspected.map((hit) =>
    Number.isFinite(hit.score) ? Math.max(0, Math.min(1, hit.score / topScore)) : 0,
  );

  let floorCount = maxResults;
  for (let index = 1; index < Math.min(ratios.length, maxResults); index += 1) {
    if (ratios[index] < minRelativeScore) {
      floorCount = index;
      break;
    }
  }

  let strongestGap = 0;
  let elbowCount = maxResults;
  for (let index = 0; index < ratios.length - 1; index += 1) {
    const gap = Math.max(0, ratios[index] - ratios[index + 1]);
    // `>=` deliberately chooses the later of equal gaps: equal spacing is not
    // evidence that only the first item is relevant. The epsilon makes decimal
    // score ties behave as ties despite binary floating-point noise.
    if (gap > strongestGap + Number.EPSILON * 16 || Math.abs(gap - strongestGap) <= 1e-9) {
      strongestGap = gap;
      elbowCount = Math.min(index + 1, maxResults);
    }
  }

  const gapCount = strongestGap >= minScoreGap ? elbowCount : maxResults;
  return hits.slice(0, Math.max(1, Math.min(maxResults, floorCount, gapCount)));
}

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
  const keyword = dedupeNearDuplicateHits(await bm25Search(query, Math.max(limit, 8)));
  const confidence = keywordConfidence(keyword);

  const wantSemantic =
    opts?.forceSemantic === true || (semanticEnabled() && confidence < ESCALATE_BELOW);

  if (!wantSemantic) {
    return {
      hits: selectKeywordEvidence(query, keyword, limit),
      strategy: 'bm25',
      keywordConfidence: confidence,
    };
  }

  const semantic = dedupeNearDuplicateHits(
    await semanticSearch(query, Math.max(limit, 8), opts?.collector),
  );
  if (semantic.length === 0) {
    // Enabled but unavailable (no vector file, or the call failed). Report the
    // path that actually ran rather than the one that was requested.
    return {
      hits: selectKeywordEvidence(query, keyword, limit),
      strategy: 'bm25',
      keywordConfidence: confidence,
    };
  }

  const fused = dedupeNearDuplicateHits(fuse([keyword, semantic], Math.max(limit, 8)));
  return {
    hits: selectRelevantHits(fused, { maxResults: limit }),
    strategy: 'hybrid',
    keywordConfidence: confidence,
  };
}
