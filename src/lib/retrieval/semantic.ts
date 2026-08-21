/**
 * Embedding search over the docs snapshot. Off by default.
 *
 * Two deliberate constraints:
 *
 * 1. Vectors are never computed at request time. Embedding 3,650 chunks costs
 *    real money and tens of seconds; doing it lazily would make the first user
 *    of a cold instance pay for everyone. `scripts/build-docs-index.mjs` writes
 *    `data/docs-vectors.json` ahead of deployment, and if that file is missing
 *    this module returns nothing rather than silently spending.
 *
 * 2. `intfloat/multilingual-e5-large` is an asymmetric model: it REQUIRES the
 *    literal prefixes `query: ` and `passage: `. Omitting them does not error —
 *    it quietly returns worse neighbours, which is the hardest kind of bug to
 *    notice. The prefixes are applied in exactly two places, here and in the
 *    build script, and must stay in sync.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cosineSimilarity, embed } from 'ai';
import { createLiara, createUsageCollector, MODELS, type UsageCollector } from '../ai/provider';
import { loadCorpus } from './corpus';
import type { Hit } from './bm25';

/** Prefix required by the e5 family. Do not "clean this up". */
export const QUERY_PREFIX = 'query: ';
export const PASSAGE_PREFIX = 'passage: ';

export type VectorStore = {
  model: string;
  dim: number;
  chunks: Array<{ id: string; vector: number[] }>;
};

export function semanticEnabled(): boolean {
  return process.env.ENABLE_SEMANTIC_RAG === 'true';
}

export function vectorStorePath(): string {
  return process.env.DOCS_VECTORS_PATH ?? path.join('data', 'docs-vectors.json');
}

let storePromise: Promise<VectorStore | null> | null = null;
let storeKey: string | null = null;
let warned = false;

function loadStore(): Promise<VectorStore | null> {
  const key = `${vectorStorePath()}\0${MODELS.embed()}`;
  if (storePromise && storeKey === key) return storePromise;
  storeKey = key;
  warned = false;
  storePromise = (async () => {
    try {
      const raw = await readFile(
        /* turbopackIgnore: true */ vectorStorePath(),
        'utf8',
      );
      const parsed = JSON.parse(raw) as VectorStore;
      if (parsed.model !== MODELS.embed() && !warned) {
        warned = true;
        console.warn(
          `[retrieval] ${vectorStorePath()} was built with "${parsed.model}" but MODEL_EMBED is ` +
            `"${MODELS.embed()}". Vectors from different models are not comparable; rebuild the index.`,
        );
        return null;
      }
      if (
        !Number.isInteger(parsed.dim) ||
        parsed.dim <= 0 ||
        !Array.isArray(parsed.chunks) ||
        parsed.chunks.length === 0 ||
        parsed.chunks.some((chunk) =>
          !chunk ||
          typeof chunk.id !== 'string' ||
          !Array.isArray(chunk.vector) ||
          chunk.vector.length !== parsed.dim ||
          !chunk.vector.every(Number.isFinite)
        )
      ) {
        if (!warned) {
          warned = true;
          console.warn('[retrieval] semantic vector index is invalid; keyword results only.');
        }
        return null;
      }
      return parsed;
    } catch {
      if (!warned) {
        warned = true;
        console.warn(
          `[retrieval] semantic search is enabled but ${vectorStorePath()} is missing. ` +
            'Run `node scripts/build-docs-index.mjs` to build it. Falling back to keyword search.',
        );
      }
      return null;
    }
  })();
  return storePromise;
}

/**
 * Nearest chunks by cosine similarity. Returns `[]` — never throws — when the
 * feature is off, the vector file is absent, or the embedding call fails, so a
 * caller can always treat this as a bonus on top of keyword search.
 */
export async function semanticSearch(
  query: string,
  limit = 8,
  collector: UsageCollector = createUsageCollector(),
): Promise<Hit[]> {
  if (!semanticEnabled()) return [];

  const store = await loadStore();
  if (!store) return [];

  let vector: number[];
  try {
    const res = await embed({
      model: createLiara(collector).textEmbeddingModel(MODELS.embed()),
      value: `${QUERY_PREFIX}${query}`,
    });
    vector = res.embedding as number[];
  } catch {
    console.warn('[retrieval] embedding the query failed; keyword results only.');
    return [];
  }

  if (
    !Array.isArray(vector) ||
    vector.length !== store.dim ||
    !vector.every(Number.isFinite)
  ) {
    console.warn('[retrieval] query embedding is incompatible with the vector index; keyword results only.');
    return [];
  }

  let scored: Array<{ id: string; score: number }>;
  try {
    scored = store.chunks
      .map((c) => ({ id: c.id, score: cosineSimilarity(vector, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (scored.some(({ score }) => !Number.isFinite(score))) {
      console.warn('[retrieval] semantic scoring was invalid; keyword results only.');
      return [];
    }
  } catch {
    console.warn('[retrieval] semantic scoring failed; keyword results only.');
    return [];
  }

  const byId = new Map((await loadCorpus()).map((c) => [c.id, c]));
  return scored.flatMap(({ id, score }) => {
    const chunk = byId.get(id);
    // A stale vector file can reference chunks the current corpus no longer has.
    return chunk ? [{ ...chunk, score }] : [];
  });
}
