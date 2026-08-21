/**
 * SECURITY ENFORCEMENT LAYER — default deny, fail closed.
 *
 * This module is the only thing standing between an LLM and a real cloud
 * account. It is an allow-list *in code*, not a prompt instruction:
 *
 *   - Every DELETE is denied unconditionally, on every product.
 *   - Exactly six writes are permitted (see ALLOWED_WRITES); all of them are
 *     reversible by an equal-and-opposite call.
 *   - Reads are enumerated path by path from the OpenAPI specs in
 *     docs/api-specs/. There is deliberately no `GET *` rule — a blanket read
 *     rule would expose endpoints nobody reviewed (e.g. FTP credentials,
 *     object-storage access keys).
 *   - Anything that does not match a rule is 'unknown' and is DENIED.
 *
 * There is no bypass parameter and no exported raw-fetch helper. `liaraFetch`
 * calls `assertAllowed` before it touches the network.
 */

import type { OpKind, Product } from './types';

/** Thrown when a call is not on the allow-list. A programming/security error. */
export class LiaraNotAllowedError extends Error {
  readonly product: Product;
  readonly method: string;
  readonly path: string;
  readonly kind: OpKind;

  constructor(args: { product: Product; method: string; path: string; kind: OpKind; reason: string }) {
    super(
      `liara: blocked ${args.method} ${args.product}:${args.path} ` +
        `[${args.kind}] — ${args.reason}`,
    );
    this.name = 'LiaraNotAllowedError';
    this.product = args.product;
    this.method = args.method;
    this.path = args.path;
    this.kind = args.kind;
  }
}

/* ================================================================== *
 * Path hygiene
 * ================================================================== */

/**
 * Substrings that must never appear anywhere in a caller-supplied path.
 * Checked on the RAW input, before any stripping or normalisation, so that a
 * dangerous token cannot hide inside a query string or an encoding.
 *
 * `%` is rejected wholesale: every legitimate path segment we speak to is an
 * app name, hostname, zone, bucket or Mongo id, none of which need
 * percent-encoding. Rejecting it kills `%2f`, `%2F`, `%5c`, `%2e%2e`, `%00`
 * and every future variant in one rule instead of playing whack-a-mole.
 */
const FORBIDDEN_SUBSTRINGS = [
  '..',   // path traversal
  '//',   // empty segment / scheme-relative confusion
  '\\',   // backslash traversal on tolerant servers
  '%',    // any percent-encoding, incl. %2f %2F %5c %2e%2e %00
  '#',    // fragment
  '\0',   // NUL
] as const;

/** A single concrete path segment. No `%`, no whitespace, no separators. */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

class PathRejected extends Error {}

/**
 * Validate + normalise a caller-supplied path.
 * Returns the query-stripped path that MUST be used for both matching and the
 * eventual request — matching one string and sending another is exactly how
 * this kind of layer gets bypassed.
 *
 * @throws PathRejected (internal) — callers surface it as a denial.
 */
function normalize(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new PathRejected('path must be a non-empty string');
  }
  // Any whitespace at all — space, tab, CR, LF, unicode spaces. This is what
  // catches trailing-newline injection ("/v1/projects/app\n").
  if (/\s/.test(rawPath)) {
    throw new PathRejected('path contains whitespace');
  }
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (rawPath.includes(bad)) {
      throw new PathRejected(`path contains forbidden sequence ${JSON.stringify(bad)}`);
    }
  }
  if (!rawPath.startsWith('/')) {
    throw new PathRejected('path must start with "/"');
  }

  // Strip the query string. Anything after the first "?" is not part of the
  // path and is validated separately by the client.
  const qIndex = rawPath.indexOf('?');
  const path = qIndex === -1 ? rawPath : rawPath.slice(0, qIndex);
  if (path.length < 2) {
    throw new PathRejected('path has no segments');
  }

  const segments = path.split('/');
  // segments[0] is always '' because the path starts with '/'.
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.length === 0) throw new PathRejected('path has an empty segment');
    if (seg === '.' || seg === '..') throw new PathRejected('path has a relative segment');
    if (!SEGMENT_RE.test(seg)) {
      throw new PathRejected(`path segment ${JSON.stringify(seg)} has illegal characters`);
    }
  }
  return path;
}

/**
 * Validate + normalise, exported for the client so the request is built from
 * the same string that was matched. Throws `LiaraNotAllowedError` on rejection.
 * This is NOT an escape hatch: it performs no I/O and grants no permission.
 */
export function normalizeApiPath(product: Product, method: string, rawPath: string): string {
  try {
    return normalize(rawPath);
  } catch (e) {
    throw new LiaraNotAllowedError({
      product,
      method: String(method).toUpperCase(),
      path: typeof rawPath === 'string' ? rawPath : String(rawPath),
      kind: 'unknown',
      reason: e instanceof PathRejected ? e.message : 'malformed path',
    });
  }
}

/* ================================================================== *
 * Template matching
 * ================================================================== */

/**
 * Match a normalised path against an OpenAPI-style template.
 * `{name}` matches exactly one non-empty segment. The match is anchored by
 * requiring an equal segment count, so a template for `/v1/projects/{name}`
 * can never match `/v1/projects/x/actions/restart`. Literal comparison is
 * case-sensitive.
 */
function matchTemplate(template: string, path: string): boolean {
  const t = template.split('/');
  const p = path.split('/');
  if (t.length !== p.length) return false;
  for (let i = 0; i < t.length; i++) {
    const tSeg = t[i];
    if (tSeg.length > 2 && tSeg.charCodeAt(0) === 123 /* { */ && tSeg.endsWith('}')) {
      const value = p[i];
      // A wildcard must consume exactly one non-empty segment.
      if (value.length === 0 || value.includes('/')) return false;
      continue;
    }
    if (tSeg !== p[i]) return false;
  }
  return true;
}

/* ================================================================== *
 * The tables
 * ================================================================== */

type Rule = { method: string; template: string };

const R = (method: string, template: string): Rule => ({ method, template });

/**
 * The COMPLETE set of permitted writes. Six entries. Every one is reversible:
 * envs can be set back, restart is idempotent, scale/resize can be reverted to
 * the previous value, a release rollback can itself be rolled back, and a DNS
 * record can be recreated. Adding to this table is a security decision.
 */
const ALLOWED_WRITES: Record<Product, readonly Rule[]> = {
  paas: [
    R('POST', '/v1/projects/update-envs'),
    R('POST', '/v1/projects/{name}/actions/restart'),
    R('POST', '/v1/projects/{name}/actions/scale'),
    R('POST', '/v1/projects/{name}/resize'),
    R('POST', '/v2/projects/{name}/releases'),
  ],
  dbaas: [],
  dns: [R('POST', '/api/v1/zones/{zone}/dns-records')],
  storage: [],
};

/**
 * Explicitly destructive operations. Checked BEFORE ALLOWED_WRITES so that if
 * someone later pastes one of these into the writes table it is still denied,
 * and so refusals carry an accurate reason. DELETE is separately blanket-denied
 * — the DELETE rows here exist as defence in depth and documentation.
 */
const DESTRUCTIVE: Record<Product, readonly Rule[]> = {
  paas: [
    R('DELETE', '/v1/projects/{name}'),
    R('DELETE', '/v1/projects/{id}/disks/{name}'),
    R('DELETE', '/v1/ftp/{fname}'),
    R('DELETE', '/v1/domains/{id}'),
    R('POST', '/v1/projects/{name}/disks/{dname}/resize'), // shrinking a disk loses data
    R('POST', '/v1/domains/{id}/ssl/disable'),
    R('POST', '/v1/projects/{id}/read-only/{status}'),
  ],
  dbaas: [
    R('DELETE', '/v1/databases/{id}'),
    R('POST', '/v1/databases/{id}/resize'),          // plan change can shrink storage
    R('POST', '/v1/databases/{id}/actions/scale'),   // scale 0 stops a live database
    R('PATCH', '/v1/databases/{id}/settings'),
    R('PATCH', '/v1/databases/{id}/public-network/{status}'),
  ],
  dns: [
    R('DELETE', '/api/v1/zones/{zone}'),
    R('DELETE', '/api/v1/zones/{zone}/dns-records/{id}'),
    R('PUT', '/api/v1/zones/{zone}/dns-records/{id}'), // overwrites a live record
  ],
  storage: [
    R('DELETE', '/api/v1/buckets/{bucket}'),
    R('DELETE', '/api/v1/buckets/{bucket}/objects/{prefix}'),
    R('DELETE', '/api/v1/buckets/{bucket}/folders'),
    R('DELETE', '/api/v1/keys/{key}'),
    R('PATCH', '/api/v1/keys/{key}/revoke'),
    R('PATCH', '/api/v1/buckets/{bucket}/type/{permission}'), // can make private data public
    R('POST', '/api/v1/buckets/migrates'),
  ],
};

/**
 * Reviewed GET paths, transcribed from docs/api-specs/*.yaml.
 *
 * Deliberately EXCLUDED even though the specs document them:
 *   paas    GET /v1/projects/{name}/disks/{dname}/ftp   → returns FTP credentials
 *   storage GET /api/v1/keys, /api/v1/keys/{key}        → returns access secrets
 *   storage GET /api/v1/buckets/{bucket}/download/...   → object bodies
 * Secrets must never reach the model context.
 */
const ALLOWED_READS: Record<Product, readonly string[]> = {
  paas: [
    // Account + plan catalog. Not in the OpenAPI specs; verified live
    // (docs/VERIFIED-FACTS.md §2) and required to validate planIDs.
    '/v1/me',
    '/v1/projects',
    '/v1/projects/{name}',
    '/v1/projects/{name}/logs',
    '/v1/projects/{name}/events',
    '/v1/projects/{name}/releases',
    '/v1/projects/{name}/applets',
    '/v1/projects/{name}/metrics/summary',
    '/v1/projects/{name}/metrics/cpu',
    '/v1/projects/{name}/metrics/memory',
    '/v1/projects/{name}/metrics/network-receive',
    '/v1/projects/{name}/metrics/network-transmit',
    '/v1/projects/{id}/disks',
    '/v1/projects/{id}/disks/{name}/backups',
    '/v1/domains',
    '/v1/domains/{id}/check',
  ],
  dbaas: [
    '/v1/databases',
    '/v1/databases/{id}',
    '/v1/databases/{id}/backups',
    '/v1/databases/{id}/events',
    '/v1/databases/{id}/metrics/summary',
    '/v1/databases/{id}/metrics/cpu',
    '/v1/databases/{id}/metrics/memory',
    '/v1/databases/{id}/metrics/network-receive',
    '/v1/databases/{id}/metrics/network-transmit',
  ],
  dns: [
    '/api/v1/zones',
    '/api/v1/zones/{zone}',
    '/api/v1/zones/{zone}/dns-records',
    '/api/v1/zones/{zone}/dns-records/{id}',
  ],
  storage: [
    '/api/v1/buckets',
    '/api/v1/buckets/{bucket}',
    '/api/v1/buckets/{bucket}/metrics/summary',
    '/api/v1/buckets/{bucket}/metrics/historical',
  ],
};

/**
 * Load-time invariant: a DELETE must never be reachable through the writes
 * table, and a permitted write must never also be listed as destructive.
 * If a future edit breaks either, the module fails to import rather than
 * silently widening the allow-list.
 */
(function assertTablesSane() {
  for (const product of Object.keys(ALLOWED_WRITES) as Product[]) {
    for (const rule of ALLOWED_WRITES[product]) {
      if (rule.method.toUpperCase() === 'DELETE') {
        throw new Error(
          `allowlist misconfigured: DELETE ${product}:${rule.template} present in ALLOWED_WRITES`,
        );
      }
      const clash = DESTRUCTIVE[product].some(
        (d) => d.method === rule.method && d.template === rule.template,
      );
      if (clash) {
        throw new Error(
          `allowlist misconfigured: ${rule.method} ${product}:${rule.template} is in both ALLOWED_WRITES and DESTRUCTIVE`,
        );
      }
    }
  }
})();

/* ================================================================== *
 * Public API
 * ================================================================== */

const PRODUCTS = new Set<Product>(['paas', 'dbaas', 'dns', 'storage']);

/**
 * Classify an operation. `'unknown'` means "not on the allow-list" and is
 * always denied — never treat it as permissive.
 */
export function classify(product: Product, method: string, path: string): OpKind {
  if (!PRODUCTS.has(product)) return 'unknown';

  const m = typeof method === 'string' ? method.toUpperCase() : '';
  if (!METHODS.has(m)) return 'unknown';

  // Unconditional, before any path parsing: no DELETE ever reaches the API.
  if (m === 'DELETE') return 'destructive';

  let p: string;
  try {
    p = normalize(path);
  } catch {
    return 'unknown';
  }

  for (const rule of DESTRUCTIVE[product]) {
    if (rule.method === m && matchTemplate(rule.template, p)) return 'destructive';
  }
  for (const rule of ALLOWED_WRITES[product]) {
    if (rule.method === m && matchTemplate(rule.template, p)) return 'reversible-write';
  }
  if (m === 'GET') {
    for (const template of ALLOWED_READS[product]) {
      if (matchTemplate(template, p)) return 'read';
    }
  }
  return 'unknown';
}

/**
 * Gate every request. Throws `LiaraNotAllowedError` unless the operation is a
 * reviewed read or one of the six reversible writes.
 */
export function assertAllowed(product: Product, method: string, path: string): void {
  const m = typeof method === 'string' ? method.toUpperCase() : String(method);

  if (!PRODUCTS.has(product)) {
    throw new LiaraNotAllowedError({
      product, method: m, path: String(path), kind: 'unknown',
      reason: `unknown product ${JSON.stringify(product)}`,
    });
  }

  // Surfaces the precise hygiene failure instead of a generic "not allowed".
  if (m !== 'DELETE') normalizeApiPath(product, m, path);

  const kind = classify(product, m, path);
  if (kind === 'read' || kind === 'reversible-write') return;

  throw new LiaraNotAllowedError({
    product, method: m, path: String(path), kind,
    reason:
      kind === 'destructive'
        ? 'destructive operations are hard-blocked at the tool layer'
        : 'not on the allow-list (default deny)',
  });
}

/** Read-only introspection for docs/UI. Returns copies. */
export function describeAllowList(): {
  writes: Array<{ product: Product; method: string; path: string }>;
  reads: Array<{ product: Product; path: string }>;
} {
  const writes: Array<{ product: Product; method: string; path: string }> = [];
  const reads: Array<{ product: Product; path: string }> = [];
  for (const product of PRODUCTS) {
    for (const r of ALLOWED_WRITES[product]) {
      writes.push({ product, method: r.method, path: r.template });
    }
    for (const t of ALLOWED_READS[product]) reads.push({ product, path: t });
  }
  return { writes, reads };
}
