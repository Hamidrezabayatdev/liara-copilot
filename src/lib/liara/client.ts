/**
 * The single HTTP entry point to the Liara management API.
 *
 * Security invariants:
 *   1. `assertAllowed` runs before anything else. There is no bypass flag and
 *      no exported raw-fetch helper, so no code path reaches `fetch` without
 *      passing the allow-list.
 *   2. The request is built from the SAME normalised path that was matched.
 *   3. The token is never logged and is scrubbed out of anything returned.
 *
 * Runtime invariants:
 *   - Never throws on an HTTP error; returns `{ ok: false, error, status }`.
 *     The only throw is `LiaraNotAllowedError`, which is a programming/security
 *     error rather than a runtime condition.
 */

import { assertAllowed, normalizeApiPath } from './allowlist';
import type { LiaraCtx, Product, ToolResult } from './types';

/** Verified 2026-08-21 against the live API — docs/VERIFIED-FACTS.md §2. */
const DEFAULT_BASE: Record<Product, string> = {
  paas: 'https://api.iran.liara.ir',
  dbaas: 'https://api.iran.liara.ir',
  dns: 'https://dns-service.iran.liara.ir',
  storage: 'https://storage-service.iran.liara.ir',
};

const BASE_ENV: Record<Product, string> = {
  paas: 'LIARA_API_BASE_PAAS',
  dbaas: 'LIARA_API_BASE_DBAAS',
  dns: 'LIARA_API_BASE_DNS',
  storage: 'LIARA_API_BASE_STORAGE',
};

const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 400;
const MAX_ERROR_CHARS = 600;

function baseUrl(product: Product): string {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.[BASE_ENV[product]] : undefined;
  const raw = (fromEnv && fromEnv.trim()) || DEFAULT_BASE[product];
  // Only https, and no trailing slash (the path always supplies its own).
  if (!raw.startsWith('https://')) return DEFAULT_BASE[product];
  return raw.replace(/\/+$/, '');
}

/** Remove the bearer token from any string that might be surfaced or logged. */
function redact(text: string, token: string | undefined): string {
  if (!text) return text;
  let out = text;
  if (token && token.length >= 8) out = out.split(token).join('***');
  // Catch a token echoed inside an Authorization-looking fragment.
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***');
}

function debug(product: Product, method: string, path: string, note: string): void {
  if (typeof process === 'undefined' || process.env?.LIARA_DEBUG !== '1') return;
  // Deliberately method + product + path + note only. Never headers, never the
  // full URL (which carries teamID), never the body.
  console.error(`[liara] ${method} ${product}:${path} ${note}`);
}

/** ASCII control characters, which have no business in a query value. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Merge the query string embedded in `path` (if any) with the explicit `query`
 * record, rejecting anything that looks like an injection attempt.
 */
function collectQuery(
  rawPath: string,
  query: Record<string, string> | undefined,
): { pairs: Array<[string, string]>; error?: string } {
  const pairs: Array<[string, string]> = [];
  const q = rawPath.indexOf('?');
  if (q !== -1) {
    for (const [k, v] of new URLSearchParams(rawPath.slice(q + 1))) pairs.push([k, v]);
  }
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    pairs.push([k, String(v)]);
  }
  for (const [k, v] of pairs) {
    if (!/^[A-Za-z0-9_.-]+$/.test(k)) {
      return { pairs, error: `invalid query key ${JSON.stringify(k)}` };
    }
    if (CONTROL_CHARS.test(v)) return { pairs, error: `invalid value for query key ${k}` };
    if (v.length > 2048) return { pairs, error: `query value for ${k} is too long` };
  }
  return { pairs };
}

/** Turn an upstream body into one readable, diagnostic line. */
function formatUpstreamError(
  status: number,
  statusText: string,
  body: unknown,
  raw: string,
): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const label = typeof b.error === 'string' && b.error ? b.error : statusText || 'error';
    // Liara's `message` carries the actionable code (g2_plan_unavailable,
    // "Token expired", validation text). Never drop it.
    const message =
      typeof b.message === 'string'
        ? b.message
        : Array.isArray(b.message)
          ? b.message.map(String).join('; ')
          : typeof b.msg === 'string'
            ? b.msg
            : '';
    return message ? `HTTP ${status} ${label}: ${message}` : `HTTP ${status} ${label}`;
  }
  const text = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_ERROR_CHARS);
  return text
    ? `HTTP ${status} ${statusText || 'error'}: ${text}`
    : `HTTP ${status} ${statusText || 'error'}`;
}

function describeNetworkError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return `request timed out after ${TIMEOUT_MS / 1000}s`;
    }
    const cause = (e as { cause?: { code?: string } }).cause;
    const code = cause?.code ? ` (${cause.code})` : '';
    return `network error: ${e.message}${code}`;
  }
  return `network error: ${String(e)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function liaraFetch<T>(
  p: Product,
  method: string,
  path: string,
  o?: { ctx: LiaraCtx; body?: unknown; query?: Record<string, string> },
): Promise<ToolResult<T>> {
  // ---- SECURITY GATE. Must be first, and must be able to throw. ----------
  assertAllowed(p, method, path);
  const m = String(method).toUpperCase();
  const cleanPath = normalizeApiPath(p, m, path);
  // -----------------------------------------------------------------------

  const ctx = o?.ctx;
  if (!ctx || typeof ctx.token !== 'string' || ctx.token.trim().length === 0) {
    return { ok: false, error: 'missing Liara API token (LIARA_API_TOKEN)' };
  }
  const token = ctx.token.trim();

  const { pairs, error: queryError } = collectQuery(path, o?.query);
  if (queryError) return { ok: false, error: queryError };

  let url: URL;
  try {
    url = new URL(baseUrl(p) + cleanPath);
  } catch {
    return { ok: false, error: `could not build a request URL for ${p}:${cleanPath}` };
  }
  for (const [k, v] of pairs) url.searchParams.set(k, v);
  // Without teamID the management API answers for the empty personal account
  // instead of erroring — docs/VERIFIED-FACTS.md §1.
  if (ctx.teamId && String(ctx.teamId).trim()) {
    url.searchParams.set('teamID', String(ctx.teamId).trim());
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if (o?.body !== undefined && m !== 'GET') {
    try {
      payload = JSON.stringify(o.body);
    } catch {
      return { ok: false, error: 'request body is not JSON-serialisable' };
    }
    headers['Content-Type'] = 'application/json';
  }

  // Retrying a write is unsafe: a network error does not tell us whether the
  // call landed. Only GET is replayed.
  const idempotent = m === 'GET';
  const maxAttempts = idempotent ? 2 : 1;

  let lastError = 'request failed';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: m,
        headers,
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (e) {
      lastError = redact(describeNetworkError(e), token);
      lastStatus = undefined;
      debug(p, m, cleanPath, `attempt ${attempt} failed: ${lastError}`);
      if (attempt < maxAttempts) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { ok: false, error: lastError };
    }

    const raw = await res.text().catch(() => '');
    let parsed: unknown;
    if (raw.trim().length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }

    if (res.ok) {
      debug(p, m, cleanPath, String(res.status));
      const data = (parsed !== undefined ? parsed : raw.trim() === '' ? {} : { raw }) as T;
      return { ok: true, data, source: 'account' };
    }

    lastStatus = res.status;
    lastError = redact(formatUpstreamError(res.status, res.statusText, parsed, raw), token);
    debug(p, m, cleanPath, String(res.status));

    if (idempotent && res.status >= 500 && attempt < maxAttempts) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    return { ok: false, error: lastError, status: lastStatus };
  }

  return { ok: false, error: lastError, status: lastStatus };
}

/** Build a `LiaraCtx` from server environment variables. Server-side only. */
export function ctxFromEnv(): LiaraCtx | null {
  if (typeof process === 'undefined') return null;
  const token = process.env?.LIARA_API_TOKEN?.trim();
  if (!token) return null;
  const teamId = process.env?.LIARA_TEAM_ID?.trim();
  return teamId ? { token, teamId } : { token };
}

/** Narrowing helper so callers can early-return without repeating the union. */
export function isOk<T>(r: ToolResult<T>): r is { ok: true; data: T; source: 'account' } {
  return r.ok;
}

/** Wrap a validation failure in the same shape the client returns. */
export function fail(error: string, status?: number): { ok: false; error: string; status?: number } {
  return status === undefined ? { ok: false, error } : { ok: false, error, status };
}
