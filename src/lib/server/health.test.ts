import assert from 'node:assert/strict';
import test from 'node:test';

const health = (await import(
  new URL('health.ts', import.meta.url).href
)) as typeof import('./health');

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
  assert.ok(result.corpus.documents >= 100);
  assert.ok(result.corpus.chunks >= 500);
});
