import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const health = (await import(
  new URL('health.ts', import.meta.url).href
)) as typeof import('./health');
const { loadCorpus } = (await import(
  new URL('../retrieval/corpus.ts', import.meta.url).href
)) as typeof import('../retrieval/corpus');

const validEnvironment = {
  NODE_ENV: 'production',
  LIARA_AI_BASE_URL: 'https://ai.liara.ir/api/workspace/v1',
  LIARA_AI_KEY: 'key-present',
  TOKEN_COOKIE_SECRET: 's'.repeat(32),
  TOOL_APPROVAL_SECRET: 'a'.repeat(32),
  ALLOW_SHARED_LIARA_TOKEN: 'false',
};

test('runtime configuration accepts a complete public production setup', () => {
  assert.deepEqual(health.inspectRuntimeConfiguration(validEnvironment), {
    ready: true,
    checks: {
      aiGateway: true,
      sessionEncryption: true,
      toolApprovals: true,
      failoverPair: true,
      noSharedProductionAccount: true,
    },
  });
});

test('runtime configuration rejects weak secrets and a shared production account', () => {
  const result = health.inspectRuntimeConfiguration({
    ...validEnvironment,
    TOKEN_COOKIE_SECRET: 'too-short',
    ALLOW_SHARED_LIARA_TOKEN: 'true',
  });

  assert.equal(result.ready, false);
  assert.equal(result.checks.sessionEncryption, false);
  assert.equal(result.checks.noSharedProductionAccount, false);
});

test('failover must be configured as a complete key/base-url pair', () => {
  const result = health.inspectRuntimeConfiguration({
    ...validEnvironment,
    FAILOVER_AI_BASE_URL: 'https://backup.example/v1',
  });

  assert.equal(result.ready, false);
  assert.equal(result.checks.failoverPair, false);
});

test('bundled documentation corpus passes the local readiness check', async () => {
  const result = await health.inspectRuntimeHealth({
    ...validEnvironment,
    NODE_ENV: 'test',
  });

  assert.equal(result.ready, true);
  assert.equal(result.checks.corpus, true);
  assert.equal(result.checks.semanticIndex, true);
  assert.ok(result.corpus.documents >= 100);
  assert.ok(result.corpus.chunks >= 500);
});

test('semantic readiness fails closed when the enabled vector store is missing', async () => {
  const result = await health.inspectRuntimeHealth({
    ...validEnvironment,
    NODE_ENV: 'test',
    ENABLE_SEMANTIC_RAG: 'true',
    DOCS_VECTORS_PATH: path.join(tmpdir(), `missing-vectors-${crypto.randomUUID()}.json`),
  });

  assert.equal(result.ready, false);
  assert.equal(result.checks.corpus, true);
  assert.equal(result.checks.semanticIndex, false);
});

test('semantic readiness verifies model, coverage, dimensions, and finite vectors', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'liara-vector-health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vectorPath = path.join(dir, 'docs-vectors.json');
  const chunks = await loadCorpus();
  const model = 'intfloat/multilingual-e5-large';
  const env = {
    ...validEnvironment,
    NODE_ENV: 'test',
    ENABLE_SEMANTIC_RAG: 'true',
    DOCS_VECTORS_PATH: vectorPath,
    MODEL_EMBED: model,
  };

  await writeFile(vectorPath, JSON.stringify({
    model,
    dim: 2,
    chunks: chunks.map((chunk) => ({ id: chunk.id, vector: [0.25, 0.75] })),
  }));
  const valid = await health.inspectRuntimeHealth(env);
  assert.equal(valid.ready, true);
  assert.equal(valid.checks.semanticIndex, true);

  await writeFile(vectorPath, JSON.stringify({
    model: 'different/model',
    dim: 2,
    chunks: chunks.map((chunk) => ({ id: chunk.id, vector: [0.25, 0.75] })),
  }));
  const incompatible = await health.inspectRuntimeHealth(env);
  assert.equal(incompatible.ready, false);
  assert.equal(incompatible.checks.semanticIndex, false);
});
