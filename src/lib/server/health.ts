import { loadCorpus } from '../retrieval/index';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const MIN_SECRET_BYTES = 32;
const MIN_DOCUMENTS = 100;
const MIN_CHUNKS = 500;

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
    return {
      ready: configuration.ready && corpusReady,
      checks: {
        configuration: configuration.ready,
        corpus: corpusReady,
      },
      corpus: { documents, chunks: chunks.length },
    };
  } catch {
    return {
      ready: false,
      checks: { configuration: configuration.ready, corpus: false },
      corpus: { documents: 0, chunks: 0 },
    };
  }
}
