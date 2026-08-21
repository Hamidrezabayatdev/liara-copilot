#!/usr/bin/env node
/**
 * Builds data/docs-vectors.json, the prebuilt embedding index for semantic
 * search. Operator tooling: it spends money, so it is never invoked by the app.
 *
 *   node scripts/build-docs-index.mjs            # full build
 *   node scripts/build-docs-index.mjs --limit 200  # cheap smoke test
 *
 * Run it before deploying if ENABLE_SEMANTIC_RAG will be true. The 8-hourly docs
 * cron re-runs it after refreshing the snapshot; if it fails, the app keeps
 * working on keyword search alone.
 */
import { registerHooks } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* env may come from the real environment instead */
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && path.extname(specifier) === '') {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through */
      }
    }
    return nextResolve(specifier, context);
  },
});

if (!process.env.LIARA_AI_KEY) {
  console.error('LIARA_AI_KEY is not set. Refusing to run: this script makes paid API calls.');
  process.exit(1);
}

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const { embedMany } = await import('ai');
const { createLiara, createUsageCollector, MODELS } = await import(
  new URL('../src/lib/ai/provider.ts', import.meta.url).href
);
const { loadCorpus } = await import(new URL('../src/lib/retrieval/corpus.ts', import.meta.url).href);
const { PASSAGE_PREFIX, vectorStorePath } = await import(
  new URL('../src/lib/retrieval/semantic.ts', import.meta.url).href
);

const chunks = (await loadCorpus()).slice(0, limit);
console.log(`corpus: ${chunks.length} chunks, model ${MODELS.embed()}`);

/** e5 caps out well before this; 64 keeps a failed batch cheap to retry. */
const BATCH = 64;
/**
 * The corpus splitter normally targets ~1,200 characters, but deliberately
 * preserves an indivisible paragraph. A few generated URL/reference lists are
 * therefore much larger than E5's context window. Bound the embedding input
 * deterministically instead of paying to send tens of thousands of characters
 * that the provider would only truncate.
 */
const MAX_EMBED_CHARS = 1200;

function embeddingInput(chunk) {
  const value = `${PASSAGE_PREFIX}${chunk.section}\n${chunk.text}`;
  if (value.length <= MAX_EMBED_CHARS) return value;

  const prefix = value.slice(0, MAX_EMBED_CHARS);
  const lastBoundary = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf(' '));
  const end = lastBoundary > MAX_EMBED_CHARS * 0.75 ? lastBoundary : prefix.length;
  return prefix.slice(0, end);
}

const out = [];
const capturedCalls = [];
let dim = 0;

for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH);
  const started = Date.now();
  // The application collector has a per-request circuit breaker. Indexing is
  // an offline operator job with 58 bounded batches, so give each batch its own
  // collector rather than weakening the production request ceiling globally.
  const batchCollector = createUsageCollector();
  const model = createLiara(batchCollector).textEmbeddingModel(MODELS.embed());
  const values = batch.map(embeddingInput);
  let res;
  try {
    res = await embedMany({
      model,
      // The `passage: ` prefix is mandatory for e5 and must match the `query: `
      // prefix used at search time (see src/lib/retrieval/semantic.ts).
      values,
    });
  } catch (err) {
    console.error(`batch at ${i} failed: ${err?.message ?? err}. Retrying once in 3s.`);
    await new Promise((r) => setTimeout(r, 3000));
    res = await embedMany({
      model,
      values,
    });
  }

  capturedCalls.push(...batchCollector.calls);
  if (res.embeddings.length !== batch.length) {
    throw new Error(
      `Embedding batch at ${i} returned ${res.embeddings.length} vectors for ${batch.length} chunks.`,
    );
  }

  res.embeddings.forEach((vector, j) => {
    if (
      !Array.isArray(vector) ||
      vector.length === 0 ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Embedding ${i + j} is empty or contains a non-finite value.`);
    }
    dim ||= vector.length;
    if (vector.length !== dim) {
      throw new Error(
        `Embedding ${i + j} has dimension ${vector.length}; expected ${dim}.`,
      );
    }
    out.push({ id: batch[j].id, vector });
  });

  const done = Math.min(i + BATCH, chunks.length);
  const pct = ((done / chunks.length) * 100).toFixed(0);
  console.log(`  ${done}/${chunks.length} (${pct}%) — ${Date.now() - started}ms`);
}

const target = path.resolve(root, vectorStorePath());
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify({ model: MODELS.embed(), dim, chunks: out }));

const toman = capturedCalls.reduce((a, c) => a + (c.usage?.total_cost_toman ?? 0), 0);
const tokens = capturedCalls.reduce((a, c) => a + (c.usage?.prompt_tokens ?? 0), 0);
console.log(
  `\nwrote ${target}\n  ${out.length} vectors, dim ${dim}` +
    `\n  ${capturedCalls.length} API calls, ${tokens} tokens` +
    (toman > 0 ? `, ${toman.toFixed(2)} Toman` : ', cost not reported by the API'),
);
