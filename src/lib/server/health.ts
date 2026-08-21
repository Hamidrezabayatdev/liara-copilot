import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_MODELS } from '../ai/provider';
import { loadCorpus } from '../retrieval/index';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const MIN_SECRET_BYTES = 32;
const MIN_DOCUMENTS = 100;
const MIN_CHUNKS = 500;

type VectorStoreShape = {
  model?: unknown;
  dim?: unknown;
  chunks?: unknown;
};

type VectorStoreCacheEntry = {
  signature: string;
  result: Promise<boolean>;
};

/**
 * Readiness is polled frequently, while the production vector JSON is large.
 * Cache a completed validation until the immutable deploy artifact changes;
 * `stat` is cheap and also lets a missing/mounted file recover without restart.
 */
const vectorStoreChecks = new Map<string, VectorStoreCacheEntry>();

async function inspectSemanticIndex(
  env: RuntimeEnvironment,
  expectedChunkIds: ReadonlySet<string>,
): Promise<boolean> {
  if (env.ENABLE_SEMANTIC_RAG !== 'true') return true;

  // Mirror MODELS.embed()/vectorStorePath() exactly: readiness must never
  // accept a path or model spelling that the retrieval runtime would reject.
  const expectedModel = env.MODEL_EMBED ?? DEFAULT_MODELS.embed;
  const target = path.resolve(
    /* turbopackIgnore: true */
    env.DOCS_VECTORS_PATH ?? 'data/docs-vectors.json',
  );

  let file: Awaited<ReturnType<typeof stat>>;
  try {
    file = await stat(/* turbopackIgnore: true */ target);
  } catch {
    return false;
  }
  if (!file.isFile() || file.size === 0) return false;

  const cacheKey = `${target}\0${expectedModel}\0${expectedChunkIds.size}`;
  const signature = `${file.size}:${file.mtimeMs}`;
  const cached = vectorStoreChecks.get(cacheKey);
  if (cached?.signature === signature) return cached.result;

  const result = (async () => {
    try {
      const parsed = JSON.parse(
        await readFile(/* turbopackIgnore: true */ target, 'utf8'),
      ) as VectorStoreShape;
      if (
        parsed.model !== expectedModel ||
        !Number.isInteger(parsed.dim) ||
        (parsed.dim as number) <= 0 ||
        !Array.isArray(parsed.chunks) ||
        parsed.chunks.length !== expectedChunkIds.size
      ) {
        return false;
      }

      const dim = parsed.dim as number;
      const seen = new Set<string>();
      for (const candidate of parsed.chunks) {
        if (!candidate || typeof candidate !== 'object') return false;
        const chunk = candidate as { id?: unknown; vector?: unknown };
        if (
          typeof chunk.id !== 'string' ||
          seen.has(chunk.id) ||
          !expectedChunkIds.has(chunk.id) ||
          !Array.isArray(chunk.vector) ||
          chunk.vector.length !== dim ||
          !chunk.vector.every(Number.isFinite)
        ) {
          return false;
        }
        seen.add(chunk.id);
      }
      return seen.size === expectedChunkIds.size;
    } catch {
      return false;
    }
  })();

  vectorStoreChecks.set(cacheKey, { signature, result });
  return result;
}

function isStrongSecret(value: string | undefined): boolean {
  return Boolean(
    value?.trim() && Buffer.byteLength(value.trim(), 'utf8') >= MIN_SECRET_BYTES,
  );
}

function isUsableAiBase(value: string | undefined, production: boolean): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (production) return url.protocol === 'https:';
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Validate production-critical settings without returning any secret value. */
export function inspectRuntimeConfiguration(
  env: RuntimeEnvironment = process.env,
) {
  const production = env.NODE_ENV === 'production';
  const failoverBase = Boolean(env.FAILOVER_AI_BASE_URL?.trim());
  const failoverKey = Boolean(env.FAILOVER_AI_KEY?.trim());
  const checks = {
    aiGateway:
      isUsableAiBase(env.LIARA_AI_BASE_URL, production) &&
      Boolean(env.LIARA_AI_KEY?.trim()),
    sessionEncryption: isStrongSecret(env.TOKEN_COOKIE_SECRET),
    toolApprovals: isStrongSecret(env.TOOL_APPROVAL_SECRET),
    failoverPair: failoverBase === failoverKey,
    noSharedProductionAccount:
      !production || env.ALLOW_SHARED_LIARA_TOKEN !== 'true',
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}

/** Local readiness only: this never calls Liara, an AI model, or another host. */
export async function inspectRuntimeHealth(
  env: RuntimeEnvironment = process.env,
) {
  const configuration = inspectRuntimeConfiguration(env);
  try {
    const chunks = await loadCorpus();
    const documents = new Set(chunks.map((chunk) => chunk.docId)).size;
    const corpusReady = documents >= MIN_DOCUMENTS && chunks.length >= MIN_CHUNKS;
    const semanticIndex = await inspectSemanticIndex(
      env,
      new Set(chunks.map((chunk) => chunk.id)),
    );
    return {
      ready: configuration.ready && corpusReady && semanticIndex,
      checks: {
        configuration: configuration.ready,
        corpus: corpusReady,
        semanticIndex,
      },
      corpus: { documents, chunks: chunks.length },
    };
  } catch {
    return {
      ready: false,
      checks: { configuration: configuration.ready, corpus: false, semanticIndex: false },
      corpus: { documents: 0, chunks: 0 },
    };
  }
}
