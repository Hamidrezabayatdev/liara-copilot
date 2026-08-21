/**
 * Focused tests for encrypted Liara account sessions. Run with:
 *   node --import ./scripts/register-ts.mjs --test src/lib/auth/liara-session.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const session = (await import(
  new URL('liara-session.ts', import.meta.url).href
)) as typeof import('./liara-session');

const SECRET = '0123456789abcdef0123456789abcdef';
const OTHER_SECRET = 'abcdef0123456789abcdef0123456789';
const TOKEN = 'liara-test-token-that-is-never-plaintext';
const TEAM_ID = '000000000000000000000001';
const NOW = 1_800_000_000_000;

test('round-trips a context without putting credentials in plaintext', () => {
  const value = session.sealLiaraSession(
    { token: TOKEN, teamId: TEAM_ID },
    { TOKEN_COOKIE_SECRET: SECRET },
    NOW,
  );

  assert.doesNotMatch(value, new RegExp(TOKEN));
  assert.doesNotMatch(value, new RegExp(TEAM_ID));
  assert.deepEqual(
    session.openLiaraSession(value, { TOKEN_COOKIE_SECRET: SECRET }, NOW + 1_000),
    { token: TOKEN, teamId: TEAM_ID },
  );
});

test('fails closed for tampering, the wrong key, expiration and weak secrets', () => {
  const env = { TOKEN_COOKIE_SECRET: SECRET };
  const value = session.sealLiaraSession({ token: TOKEN }, env, NOW);
  const parts = value.split('.');
  const ciphertext = Buffer.from(parts[2], 'base64url');
  ciphertext[0] ^= 1;
  parts[2] = ciphertext.toString('base64url');
  const tampered = parts.join('.');

  assert.equal(session.openLiaraSession(tampered, env, NOW), null);
  assert.equal(
    session.openLiaraSession(value, { TOKEN_COOKIE_SECRET: OTHER_SECRET }, NOW),
    null,
  );
  assert.equal(
    session.openLiaraSession(
      value,
      env,
      NOW + session.LIARA_SESSION_TTL_SECONDS * 1_000,
    ),
    null,
  );
  assert.throws(
    () => session.sealLiaraSession({ token: TOKEN }, { TOKEN_COOKIE_SECRET: 'short' }, NOW),
    session.LiaraSessionConfigurationError,
  );
});

test('uses hardened cookie attributes and reads the cookie among unrelated cookies', () => {
  const env = { TOKEN_COOKIE_SECRET: SECRET, NODE_ENV: 'production' };
  const setCookie = session.createLiaraSessionCookie(
    { token: TOKEN, teamId: TEAM_ID },
    env,
    NOW,
  );
  const value = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
  const cookieHeader = `theme=dark; ${session.LIARA_SESSION_COOKIE}=${value}; locale=fa`;

  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Strict/);
  assert.match(setCookie, /; Secure/);
  assert.deepEqual(session.getLiaraConnection(cookieHeader, env, NOW), {
    ctx: { token: TOKEN, teamId: TEAM_ID },
    source: 'cookie',
  });
  assert.match(session.clearLiaraSessionCookie(env), /Max-Age=0/);
});

test('does not silently use a shared production token without explicit opt-in', () => {
  const base = {
    LIARA_API_TOKEN: TOKEN,
    LIARA_TEAM_ID: TEAM_ID,
    NODE_ENV: 'production',
  };

  assert.deepEqual(session.getLiaraConnection(null, base, NOW), {
    ctx: null,
    source: null,
  });
  assert.deepEqual(
    session.getLiaraConnection(
      null,
      { ...base, ALLOW_SHARED_LIARA_TOKEN: 'true' },
      NOW,
    ),
    {
      ctx: { token: TOKEN, teamId: TEAM_ID },
      source: 'environment',
    },
  );
  assert.equal(
    session.getLiaraConnection(null, { ...base, NODE_ENV: 'development' }, NOW).source,
    'environment',
  );
  assert.equal(
    session.getLiaraConnection(
      null,
      { ...base, NODE_ENV: 'development', ALLOW_SHARED_LIARA_TOKEN: 'false' },
      NOW,
    ).source,
    null,
  );
});

test('rejects malformed credential fields before storage', () => {
  assert.deepEqual(session.normalizeLiaraContext('too-short', TEAM_ID), { error: 'token' });
  assert.deepEqual(session.normalizeLiaraContext(TOKEN, 'not-a-team-id'), {
    error: 'teamId',
  });
  assert.deepEqual(session.normalizeLiaraContext(TOKEN, TEAM_ID.toUpperCase()), {
    ctx: { token: TOKEN, teamId: TEAM_ID },
  });
});
