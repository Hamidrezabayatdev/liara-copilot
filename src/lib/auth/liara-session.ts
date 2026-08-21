import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import type { LiaraCtx } from '@/lib/liara/types';

export const LIARA_SESSION_COOKIE = 'liara_session';
export const LIARA_SESSION_TTL_SECONDS = 8 * 60 * 60;

const COOKIE_AAD = Buffer.from('liara-copilot:liara-session:v1');
const MIN_SECRET_BYTES = 32;
// Keep the encrypted value comfortably below browsers' ~4 KiB cookie limit.
const MAX_TOKEN_BYTES = 2_048;
const TEAM_ID_RE = /^[a-f0-9]{24}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

type SessionEnvironment = Readonly<Record<string, string | undefined>>;

type StoredSession = {
  v: 1;
  token: string;
  teamId?: string;
  expiresAt: number;
};

export type LiaraConnection = {
  ctx: LiaraCtx | null;
  source: 'cookie' | 'environment' | null;
};

export class LiaraSessionConfigurationError extends Error {
  constructor() {
    super('TOKEN_COOKIE_SECRET must contain at least 32 bytes');
    this.name = 'LiaraSessionConfigurationError';
  }
}

function cookieSecret(env: SessionEnvironment): string | null {
  const secret = env.TOKEN_COOKIE_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) return null;
  return secret;
}

function keyFromEnvironment(env: SessionEnvironment): Buffer | null {
  const secret = cookieSecret(env);
  return secret ? createHash('sha256').update(secret, 'utf8').digest() : null;
}

function secureAttribute(env: SessionEnvironment): string {
  return env.NODE_ENV === 'production' ? '; Secure' : '';
}

function cookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const item = part.trim();
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator) !== LIARA_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate and normalise credentials before either calling Liara or sealing
 * them into a cookie. Errors deliberately describe fields, never values.
 */
export function normalizeLiaraContext(
  token: unknown,
  teamId: unknown,
): { ctx: LiaraCtx } | { error: 'token' | 'teamId' } {
  if (typeof token !== 'string') return { error: 'token' };
  const cleanToken = token.trim();
  if (
    cleanToken.length < 16 ||
    Buffer.byteLength(cleanToken, 'utf8') > MAX_TOKEN_BYTES ||
    CONTROL_CHARS.test(cleanToken)
  ) {
    return { error: 'token' };
  }

  if (teamId === undefined || teamId === null || teamId === '') {
    return { ctx: { token: cleanToken } };
  }
  if (typeof teamId !== 'string' || !TEAM_ID_RE.test(teamId.trim())) {
    return { error: 'teamId' };
  }

  return { ctx: { token: cleanToken, teamId: teamId.trim().toLowerCase() } };
}

/** True only when the cookie encryption secret is strong enough to use. */
export function isLiaraSessionConfigured(
  env: SessionEnvironment = process.env,
): boolean {
  return cookieSecret(env) !== null;
}

/**
 * Shared management credentials are convenient locally, but unsafe as the
 * implicit identity of a public deployment. Production requires an explicit
 * opt-in.
 */
export function isSharedLiaraTokenAllowed(
  env: SessionEnvironment = process.env,
): boolean {
  if (env.ALLOW_SHARED_LIARA_TOKEN !== undefined) {
    return env.ALLOW_SHARED_LIARA_TOKEN === 'true';
  }
  return env.NODE_ENV !== 'production';
}

export function sealLiaraSession(
  ctx: LiaraCtx,
  env: SessionEnvironment = process.env,
  now = Date.now(),
): string {
  const normalised = normalizeLiaraContext(ctx.token, ctx.teamId);
  if ('error' in normalised) throw new TypeError(`invalid Liara ${normalised.error}`);

  const key = keyFromEnvironment(env);
  if (!key) throw new LiaraSessionConfigurationError();

  const payload: StoredSession = {
    v: 1,
    ...normalised.ctx,
    expiresAt: now + LIARA_SESSION_TTL_SECONDS * 1_000,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(COOKIE_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function openLiaraSession(
  value: string | null | undefined,
  env: SessionEnvironment = process.env,
  now = Date.now(),
): LiaraCtx | null {
  const key = keyFromEnvironment(env);
  if (!key || !value || value.length > 16_384) return null;

  try {
    const [version, ivPart, ciphertextPart, tagPart, extra] = value.split('.');
    if (version !== 'v1' || !ivPart || !ciphertextPart || !tagPart || extra !== undefined) {
      return null;
    }

    const iv = Buffer.from(ivPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== 12 || ciphertext.length === 0 || tag.length !== 16) return null;

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(COOKIE_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as Partial<StoredSession>;

    if (
      payload.v !== 1 ||
      typeof payload.expiresAt !== 'number' ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= now
    ) {
      return null;
    }

    const normalised = normalizeLiaraContext(payload.token, payload.teamId);
    return 'ctx' in normalised ? normalised.ctx : null;
  } catch {
    // Authentication failures, malformed base64 and invalid JSON are all the
    // same externally. Never surface ciphertext or credential details.
    return null;
  }
}

export function createLiaraSessionCookie(
  ctx: LiaraCtx,
  env: SessionEnvironment = process.env,
  now = Date.now(),
): string {
  const value = sealLiaraSession(ctx, env, now);
  return (
    `${LIARA_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=${LIARA_SESSION_TTL_SECONDS}; Priority=High${secureAttribute(env)}`
  );
}

export function clearLiaraSessionCookie(
  env: SessionEnvironment = process.env,
): string {
  return (
    `${LIARA_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=0; Priority=High${secureAttribute(env)}`
  );
}

export function getLiaraConnection(
  cookieHeader: string | null | undefined,
  env: SessionEnvironment = process.env,
  now = Date.now(),
): LiaraConnection {
  const session = openLiaraSession(cookieValue(cookieHeader), env, now);
  if (session) return { ctx: session, source: 'cookie' };

  if (isSharedLiaraTokenAllowed(env)) {
    const token = env.LIARA_API_TOKEN?.trim();
    const teamId = env.LIARA_TEAM_ID?.trim();
    if (token) {
      const normalised = normalizeLiaraContext(token, teamId);
      if ('ctx' in normalised) return { ctx: normalised.ctx, source: 'environment' };
    }
  }

  return { ctx: null, source: null };
}
