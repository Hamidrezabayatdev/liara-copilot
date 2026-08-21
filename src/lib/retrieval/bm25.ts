/**
 * Keyword search over the docs snapshot. This is the default retrieval path:
 * embeddings cost money on every query, BM25 costs nothing, and for reference
 * documentation the user's words usually *are* the doc's words.
 *
 * MiniSearch is configured with `prefix: true` because Persian is agglutinative
 * — `خطا` must reach `خطای`, `اپ` must reach `اپلیکیشن` — and with a small fuzzy
 * budget for typos. Both are set at query time, not index time.
 */
import MiniSearch, { type SearchResult as MiniHit } from 'minisearch';
import { expandQuery, keepTerm, normalizeFa, tokenizeFa } from './normalize';
import { loadCorpus, type Chunk } from './corpus';

export type Hit = {
  id: string;
  docId: string;
  title: string;
  url: string;
  section: string;
  text: string;
  /** MiniSearch's BM25-ish score. Unbounded; only meaningful as a ranking. */
  score: number;
};

let indexPromise: Promise<MiniSearch<Chunk>> | null = null;

export function getIndex(): Promise<MiniSearch<Chunk>> {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const chunks = await loadCorpus();
    const mini = new MiniSearch<Chunk>({
      idField: 'id',
      fields: ['title', 'section', 'text'],
      storeFields: ['docId', 'title', 'url', 'section', 'text'],
      tokenize: tokenizeFa,
      // MiniSearch calls this per term at index and query time. Returning a
      // falsy value drops the term, which is how stopwords are removed.
      processTerm: (term) => {
        const t = normalizeFa(term);
        return keepTerm(t) ? t : null;
      },
    });
    await mini.addAllAsync(chunks, { chunkSize: 500 });
    return mini;
  })();

  return indexPromise;
}

const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: 0.15,
  // A term in the heading is far stronger evidence than one buried in prose.
  boost: { title: 3, section: 2 },
  combineWith: 'OR' as const,
};

function toHit(r: MiniHit): Hit {
  return {
    id: String(r.id),
    docId: String(r.docId ?? ''),
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    section: String(r.section ?? ''),
    text: String(r.text ?? ''),
    score: r.score,
  };
}

/**
 * Keeps at most `maxPerDoc` chunks from any one document.
 *
 * Without this the top of the list collapses: a page like the PostgreSQL
 * quick-start has four consecutive sections that all mention PostgreSQL, so all
 * four outrank every other page and the user is shown one source three times.
 * Ranking is preserved, duplicates are just skipped.
 */
function diversify(hits: Hit[], maxPerDoc: number): Hit[] {
  const seen = new Map<string, number>();
  const out: Hit[] = [];
  for (const h of hits) {
    const n = seen.get(h.docId) ?? 0;
    if (n >= maxPerDoc) continue;
    seen.set(h.docId, n + 1);
    out.push(h);
  }
  return out;
}

export async function bm25Search(
  query: string,
  limit = 8,
  opts?: { maxPerDoc?: number },
): Promise<Hit[]> {
  const terms = expandQuery(query).filter(keepTerm);
  if (terms.length === 0) return [];
  const mini = await getIndex();
  // Over-fetch so diversification has alternatives to promote.
  const raw = mini
    .search(terms.join(' '), SEARCH_OPTIONS)
    .slice(0, limit * 5)
    .map(toHit);
  return diversify(raw, opts?.maxPerDoc ?? 1).slice(0, limit);
}

/**
 * How much to trust the keyword result, 0..1. Two signals, multiplied:
 *
 *   1. Separation — how far the top hit stands above the runner-up. When the
 *      first two scores are nearly equal, BM25 found several documents that all
 *      share the query's words and has no basis for preferring one; that is the
 *      ambiguity semantic search is good at breaking.
 *   2. Absolute strength — a top score near zero means the query barely matched
 *      anything, however cleanly it "won".
 *
 * Both are monotone and bounded, and neither can rescue the other, which is the
 * property the caller depends on: it escalates only when the cheap path is
 * genuinely weak, not merely when it is unusual.
 *
 * The absolute scale is calibrated against this corpus, where a confident single
 * hit scores in the tens. It is a heuristic gate on spending money, not a
 * probability.
 */
export function keywordConfidence(hits: Hit[]): number {
  if (hits.length === 0) return 0;
  const top = hits[0].score;
  if (top <= 0) return 0;

  const strength = Math.min(1, top / 25);
  if (hits.length === 1) return strength;

  const separation = Math.min(1, (top - hits[1].score) / top / 0.35);
  return strength * Math.max(0.15, separation);
}
