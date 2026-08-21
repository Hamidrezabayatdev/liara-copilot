/**
 * Security tests for the allow-list. Plain node:test — run with:
 *   node --test src/lib/liara/allowlist.test.ts
 *
 * The specifier is computed so that Node resolves the real `.ts` file at
 * runtime (Node 24 strips types natively) while `typeof import(...)` keeps full
 * type checking under `moduleResolution: bundler`, which forbids a literal
 * `.ts` extension in a static import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product } from './types';

const mod = (await import(
  new URL('allowlist.ts', import.meta.url).href
)) as typeof import('./allowlist');

const { assertAllowed, classify, normalizeApiPath, describeAllowList, LiaraNotAllowedError } = mod;

const PRODUCTS: Product[] = ['paas', 'dbaas', 'dns', 'storage'];

/** Assert the call is blocked, and blocked by *our* error type. */
function denied(product: Product, method: string, path: string, label = '') {
  assert.throws(
    () => assertAllowed(product, method, path),
    (e: unknown) => {
      assert.ok(
        e instanceof LiaraNotAllowedError,
        `${label || `${method} ${product}:${path}`} threw ${String(e)} instead of LiaraNotAllowedError`,
      );
      return true;
    },
    `EXPECTED DENY but call was allowed: ${method} ${product}:${path} ${label}`,
  );
  const kind = classify(product, method, path);
  assert.ok(
    kind === 'destructive' || kind === 'unknown',
    `classify said "${kind}" for a denied op: ${method} ${product}:${path}`,
  );
}

function allowed(product: Product, method: string, path: string) {
  assert.doesNotThrow(
    () => assertAllowed(product, method, path),
    `EXPECTED ALLOW but call was blocked: ${method} ${product}:${path}`,
  );
}

/* ------------------------------------------------------------------ *
 * 1. The six permitted writes
 * ------------------------------------------------------------------ */

const ALLOWED_WRITE_CASES: Array<[Product, string, string]> = [
  ['paas', 'POST', '/v1/projects/update-envs'],
  ['paas', 'POST', '/v1/projects/digishop-api/actions/restart'],
  ['paas', 'POST', '/v1/projects/digishop-api/actions/scale'],
  ['paas', 'POST', '/v1/projects/digishop-api/resize'],
  ['paas', 'POST', '/v2/projects/digishop-api/releases'],
  ['dns', 'POST', '/api/v1/zones/example.com/dns-records'],
];

test('every permitted write is allowed and classified reversible-write', () => {
  for (const [p, m, path] of ALLOWED_WRITE_CASES) {
    allowed(p, m, path);
    assert.equal(classify(p, m, path), 'reversible-write', `${m} ${p}:${path}`);
  }
});

test('the write allow-list is exactly six entries and contains no DELETE', () => {
  const { writes } = describeAllowList();
  assert.equal(writes.length, 6, `write allow-list changed: ${JSON.stringify(writes)}`);
  for (const w of writes) assert.notEqual(w.method, 'DELETE');
  const expected = new Set(ALLOWED_WRITE_CASES.map(([p, m]) => `${p} ${m}`));
  for (const w of writes) assert.ok(expected.has(`${w.product} ${w.method}`));
});

/* ------------------------------------------------------------------ *
 * 2. DELETE is denied unconditionally, on every product
 * ------------------------------------------------------------------ */

/** Every DELETE operation documented in docs/api-specs/*.yaml. */
const ALL_SPEC_DELETES: Array<[Product, string]> = [
  ['paas', '/v1/projects/digishop-api'],
  ['paas', '/v1/projects/6a8790f225ceac1493a753c0/disks/data'],
  ['paas', '/v1/ftp/someftp'],
  ['paas', '/v1/domains/6a8790f225ceac1493a753c0'],
  ['dbaas', '/v1/databases/6a879116ffa5ac74ac3e8f51'],
  ['dns', '/api/v1/zones/example.com'],
  ['dns', '/api/v1/zones/example.com/dns-records/rec1'],
  ['storage', '/api/v1/buckets/mybucket'],
  ['storage', '/api/v1/buckets/mybucket/objects/prefix'],
  ['storage', '/api/v1/buckets/mybucket/folders'],
  ['storage', '/api/v1/keys/somekey'],
];

test('DELETE is denied for every documented delete operation', () => {
  for (const [p, path] of ALL_SPEC_DELETES) {
    denied(p, 'DELETE', path);
    assert.equal(classify(p, 'DELETE', path), 'destructive');
  }
});

test('DELETE is denied on every product, including on allow-listed read/write paths', () => {
  const paths = [
    '/v1/projects',
    '/v1/projects/digishop-api',
    '/v1/projects/update-envs',
    '/v1/projects/digishop-api/actions/restart',
    '/api/v1/zones/example.com/dns-records',
    '/api/v1/buckets',
    '/v1/me',
    '/anything/at/all',
  ];
  for (const p of PRODUCTS) {
    for (const path of paths) {
      denied(p, 'DELETE', path);
      assert.equal(classify(p, 'DELETE', path), 'destructive', `${p}:${path}`);
    }
  }
});

test('DELETE is denied regardless of method letter case', () => {
  for (const m of ['delete', 'Delete', 'DeLeTe', 'DELETE', 'dElEtE']) {
    denied('paas', m, '/v1/projects/digishop-api', `case ${m}`);
    assert.equal(classify('paas', m, '/v1/projects/digishop-api'), 'destructive');
  }
});

test('DELETE is denied even when the path itself is malformed', () => {
  for (const path of ['/v1/projects/../../admin', '/v1/projects/%2e%2e/x', '/v1/projects/x\n']) {
    denied('paas', 'DELETE', path);
  }
});

/* ------------------------------------------------------------------ *
 * 3. Traversal / encoding / injection bypass attempts
 * ------------------------------------------------------------------ */

const BYPASS_PATHS = [
  // The four the threat model calls out by name.
  '/v1/projects/../../admin',
  '/v1/projects/%2e%2e/x',
  '/v1/projects/x%2factions%2frestart',
  '/v1/projects/digishop-api\n',
  // Encoding variants of the same ideas.
  '/v1/projects/%2E%2E/x',
  '/v1/projects/x%2Factions%2Frestart',
  '/v1/projects/x%252factions%252frestart',
  '/v1/projects/%2e%2e%2f%2e%2e%2fadmin',
  '/v1/projects/x%00/actions/restart',
  '/v1/projects/x%0a/actions/restart',
  // Traversal without encoding.
  '/v1/projects/..',
  '/v1/projects/../update-envs',
  '/v1/projects/./update-envs',
  '/v1/../v1/projects/update-envs',
  '/v1/projects/update-envs/..',
  // Backslash traversal.
  '/v1/projects\\..\\admin',
  '/v1/projects/x\\actions\\restart',
  // Empty / doubled separators.
  '//v1/projects/update-envs',
  '/v1//projects/update-envs',
  '/v1/projects//actions/restart',
  '/v1/projects/update-envs//',
  '/v1/projects/',
  // Whitespace + newline injection, leading and trailing.
  '/v1/projects/update-envs\n',
  '/v1/projects/update-envs\r\n',
  '\n/v1/projects/update-envs',
  '/v1/projects/update-envs ',
  ' /v1/projects/update-envs',
  '/v1/projects/update-envs\nX-Injected: 1',
  '/v1/projects/digishop-api/actions/restart\r\nHost: evil.example',
  '/v1/projects/update\t-envs',
  // Fragment.
  '/v1/projects/update-envs#/../../admin',
  '/v1/projects#',
  // Missing or wrong leading separator.
  'v1/projects/update-envs',
  'https://api.iran.liara.ir/v1/projects/update-envs',
  '://v1/projects',
  '/',
  '',
];

test('every traversal / encoding / injection bypass attempt is denied', () => {
  for (const path of BYPASS_PATHS) {
    for (const p of PRODUCTS) {
      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        denied(p, m, path, `bypass ${JSON.stringify(path)}`);
      }
    }
  }
});

test('a bypass path can never be classified as read or reversible-write', () => {
  for (const path of BYPASS_PATHS) {
    for (const p of PRODUCTS) {
      for (const m of ['GET', 'POST']) {
        const k = classify(p, m, path);
        assert.ok(
          k === 'unknown' || k === 'destructive',
          `classify leaked "${k}" for ${m} ${p}:${JSON.stringify(path)}`,
        );
      }
    }
  }
});

test('normalizeApiPath strips the query string and rejects malformed paths', () => {
  assert.equal(
    normalizeApiPath('paas', 'GET', '/v1/projects/digishop-api?teamID=abc&since=0'),
    '/v1/projects/digishop-api',
  );
  assert.equal(normalizeApiPath('paas', 'GET', '/v1/me'), '/v1/me');
  for (const bad of ['/v1/projects/../x', '/v1/projects/x%2fy', '/v1/x\n', 'v1/x', '', '/']) {
    assert.throws(
      () => normalizeApiPath('paas', 'GET', bad),
      LiaraNotAllowedError,
      `normalizeApiPath accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('a query string cannot smuggle a different path past the matcher', () => {
  // Matching happens on the query-stripped value, so the base path still has
  // to be on the allow-list — and the query cannot promote a denied path.
  allowed('paas', 'GET', '/v1/projects/digishop-api/logs?since=0');
  assert.equal(
    normalizeApiPath('paas', 'GET', '/v1/projects?path=/v1/projects/x/disks/d/ftp'),
    '/v1/projects',
    'the smuggled path must not become the matched path',
  );
  denied('paas', 'POST', '/v1/projects?x=update-envs');
  denied('paas', 'POST', '/v1/projects/x/nuke?fallback=/v1/projects/update-envs');
  denied('paas', 'GET', '/v1/projects/x/disks/d/ftp?ok=/v1/projects');
});

/* ------------------------------------------------------------------ *
 * 4. Unknown paths are denied (default deny)
 * ------------------------------------------------------------------ */

test('unknown paths are denied and classified unknown', () => {
  const unknown: Array<[Product, string, string]> = [
    ['paas', 'GET', '/v1/admin'],
    ['paas', 'GET', '/v3/projects'],
    ['paas', 'GET', '/v1/project'],
    ['paas', 'GET', '/v1/projectsx'],
    ['paas', 'POST', '/v1/projects'],                       // app creation: billable, not allowed
    ['paas', 'POST', '/v1/networks'],
    ['paas', 'POST', '/v2/projects/digishop-api/sources'],
    ['paas', 'POST', '/v1/projects/x/zero-downtime/enable'],
    ['paas', 'POST', '/v1/projects/x/default-subdomain/enable'],
    ['paas', 'POST', '/v1/projects/x/fixed-ip/enable'],
    ['paas', 'POST', '/v1/projects/x/disks'],
    ['paas', 'POST', '/v1/projects/x/disks/data/ftp'],
    ['paas', 'GET', '/v1/projects/x/disks/data/ftp'],        // leaks FTP credentials
    ['paas', 'POST', '/v1/domains'],
    ['paas', 'POST', '/v1/domains/set-project'],
    ['paas', 'POST', '/v1/domains/provision-ssl-certs'],
    ['dbaas', 'POST', '/v1/databases'],
    ['dbaas', 'POST', '/v1/databases/x/backups'],
    ['dbaas', 'POST', '/v1/databases/x/backups/b/download'],
    ['dbaas', 'POST', '/v1/databases/x/control-panel/enable'],
    ['dns', 'POST', '/api/v1/zones'],
    ['dns', 'PUT', '/api/v1/zones/example.com/check'],
    ['storage', 'GET', '/api/v1/keys'],                     // leaks access secrets
    ['storage', 'GET', '/api/v1/keys/somekey'],
    ['storage', 'POST', '/api/v1/keys'],
    ['storage', 'POST', '/api/v1/buckets'],
    ['storage', 'GET', '/api/v1/buckets/b/download/obj'],
    ['storage', 'GET', '/api/v1/buckets/b/objects/prefix'],
    ['storage', 'POST', '/api/v1/buckets/b/folders'],
  ];
  for (const [p, m, path] of unknown) {
    denied(p, m, path);
    assert.equal(classify(p, m, path), 'unknown', `${m} ${p}:${path}`);
  }
});

test('explicitly destructive non-DELETE operations are denied', () => {
  const destructive: Array<[Product, string, string]> = [
    ['paas', 'POST', '/v1/projects/x/disks/data/resize'],
    ['paas', 'POST', '/v1/domains/abc/ssl/disable'],
    ['paas', 'POST', '/v1/projects/abc/read-only/enable'],
    ['dbaas', 'POST', '/v1/databases/abc/resize'],
    ['dbaas', 'POST', '/v1/databases/abc/actions/scale'],
    ['dbaas', 'PATCH', '/v1/databases/abc/settings'],
    ['dbaas', 'PATCH', '/v1/databases/abc/public-network/enable'],
    ['dns', 'PUT', '/api/v1/zones/example.com/dns-records/rec1'],
    ['storage', 'PATCH', '/api/v1/keys/k1/revoke'],
    ['storage', 'PATCH', '/api/v1/buckets/b/type/public'],
    ['storage', 'POST', '/api/v1/buckets/migrates'],
  ];
  for (const [p, m, path] of destructive) {
    denied(p, m, path);
    assert.equal(classify(p, m, path), 'destructive', `${m} ${p}:${path}`);
  }
});

/* ------------------------------------------------------------------ *
 * 5. Segment-count confusion
 * ------------------------------------------------------------------ */

test('a template must not match a path with a different segment count', () => {
  // `/v1/projects/{name}` (4 segments) must not swallow deeper paths.
  denied('paas', 'GET', '/v1/projects/digishop-api/actions/restart');
  denied('paas', 'GET', '/v1/projects/digishop-api/nuke');
  denied('paas', 'GET', '/v1/projects/a/b');
  denied('paas', 'GET', '/v1/projects/a/b/c/d/e');
  // Extra segment after an allowed write.
  denied('paas', 'POST', '/v1/projects/update-envs/extra');
  denied('paas', 'POST', '/v1/projects/x/actions/restart/now');
  denied('paas', 'POST', '/v1/projects/x/actions');
  denied('paas', 'POST', '/v1/projects/x/resize/up');
  denied('paas', 'POST', '/v2/projects/x/releases/y');
  denied('dns', 'POST', '/api/v1/zones/example.com/dns-records/extra');
  denied('dns', 'POST', '/api/v1/zones/dns-records');
  // Missing segment.
  denied('paas', 'POST', '/v1/projects/actions/restart');
  denied('paas', 'GET', '/v1/projects/metrics/summary');
  denied('paas', 'GET', '/v1/logs');
});

test('a wildcard segment cannot be empty and cannot span a separator', () => {
  denied('paas', 'POST', '/v1/projects//actions/restart');
  denied('paas', 'POST', '/v1/projects//resize');
  denied('paas', 'GET', '/v1/projects//logs');
  denied('dns', 'POST', '/api/v1/zones//dns-records');
  // A wildcard is one segment: "a/b" cannot fill {name}.
  denied('paas', 'GET', '/v1/projects/a/b/logs');
});

test('literal path comparison is case-sensitive', () => {
  denied('paas', 'GET', '/V1/projects');
  denied('paas', 'GET', '/v1/Projects');
  denied('paas', 'GET', '/v1/PROJECTS');
  denied('paas', 'POST', '/v1/projects/UPDATE-ENVS');
  denied('paas', 'POST', '/v1/projects/x/ACTIONS/restart');
  denied('paas', 'POST', '/v1/projects/x/Resize');
  denied('paas', 'GET', '/v1/ME');
  denied('dns', 'POST', '/api/V1/zones/example.com/dns-records');
  denied('dns', 'POST', '/api/v1/zones/example.com/DNS-Records');
  // The wildcard value itself keeps its case — app names are case-sensitive
  // upstream, so this must still be allowed.
  allowed('paas', 'GET', '/v1/projects/DigiShop-API');
});

/* ------------------------------------------------------------------ *
 * 6. Method handling
 * ------------------------------------------------------------------ */

test('method comparison is case-insensitive for allowed operations', () => {
  for (const m of ['post', 'POST', 'Post', 'pOsT']) {
    allowed('paas', m, '/v1/projects/update-envs');
    assert.equal(classify('paas', m, '/v1/projects/update-envs'), 'reversible-write');
  }
  for (const m of ['get', 'GET', 'Get', 'gEt']) {
    allowed('paas', m, '/v1/projects');
    assert.equal(classify('paas', m, '/v1/projects'), 'read');
  }
});

test('the wrong method on an allowed path is denied', () => {
  // Note: GET /v1/projects/update-envs is *not* in this list because
  // `/v1/projects/{name}` legitimately matches it — upstream that is a lookup
  // for an app literally named "update-envs" (a 404), never an env write.
  for (const m of ['PUT', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']) {
    denied('paas', m, '/v1/projects/update-envs', `method ${m}`);
  }
  for (const m of ['POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']) {
    denied('paas', m, '/v1/projects/digishop-api/logs', `method ${m}`);
    denied('paas', m, '/v1/me', `method ${m}`);
  }
});

test('bogus and non-string methods are denied', () => {
  for (const m of ['', 'FETCH', 'GETT', 'GE T', 'GET\n', 'POST;GET', 'get post']) {
    denied('paas', m, '/v1/projects', `method ${JSON.stringify(m)}`);
  }
  for (const m of [undefined, null, 0, {}, []] as unknown as string[]) {
    assert.throws(() => assertAllowed('paas', m, '/v1/projects'), LiaraNotAllowedError);
    assert.equal(classify('paas', m, '/v1/projects'), 'unknown');
  }
});

/* ------------------------------------------------------------------ *
 * 7. Product scoping
 * ------------------------------------------------------------------ */

test('an allowed operation on one product is denied on the others', () => {
  for (const p of PRODUCTS.filter((x) => x !== 'paas')) {
    denied(p, 'POST', '/v1/projects/update-envs');
    denied(p, 'POST', '/v1/projects/digishop-api/actions/restart');
    denied(p, 'GET', '/v1/me');
  }
  for (const p of PRODUCTS.filter((x) => x !== 'dns')) {
    denied(p, 'POST', '/api/v1/zones/example.com/dns-records');
  }
  for (const p of PRODUCTS.filter((x) => x !== 'storage')) {
    denied(p, 'GET', '/api/v1/buckets');
  }
  // paas and dbaas share a host but not an allow-list.
  denied('paas', 'GET', '/v1/databases');
  denied('dbaas', 'GET', '/v1/projects');
});

test('an unknown product is denied', () => {
  for (const p of ['', 'PAAS', 'ai', 'mail', 'iaas', 'paas ', undefined, null] as unknown as Product[]) {
    assert.throws(
      () => assertAllowed(p, 'GET', '/v1/projects'),
      LiaraNotAllowedError,
      `product ${JSON.stringify(p)} was accepted`,
    );
    assert.equal(classify(p, 'GET', '/v1/projects'), 'unknown');
  }
});

/* ------------------------------------------------------------------ *
 * 8. Reads
 * ------------------------------------------------------------------ */

test('every enumerated read path is allowed for GET only', () => {
  const { reads } = describeAllowList();
  assert.ok(reads.length > 20, `expected a real read inventory, got ${reads.length}`);
  for (const { product, path } of reads) {
    // Fill wildcards with a plausible concrete value.
    const concrete = path.replace(/\{[^}]+\}/g, 'digishop-api');
    allowed(product, 'GET', concrete);
    assert.equal(classify(product, 'GET', concrete), 'read', `${product}:${concrete}`);
    // No read path may be writable.
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const kind = classify(product, m, concrete);
      if (kind === 'reversible-write') {
        // Only the six writes may report this, and none share a read path
        // except by design; assert it is one of them.
        const { writes } = describeAllowList();
        assert.ok(
          writes.some((w) => w.product === product && w.method === m),
          `read path became writable: ${m} ${product}:${concrete}`,
        );
      }
    }
  }
});

test('reads are not a blanket GET *', () => {
  for (const p of PRODUCTS) {
    denied(p, 'GET', '/');
    denied(p, 'GET', '/v1');
    denied(p, 'GET', '/v1/anything');
    denied(p, 'GET', '/api/v1/anything');
    denied(p, 'GET', '/v1/users');
    denied(p, 'GET', '/v1/tokens');
  }
});

/* ------------------------------------------------------------------ *
 * 9. Structural sweep — mutating any allowed path must break it
 * ------------------------------------------------------------------ */

test('adding, removing, or altering a segment of any allowed path denies it', () => {
  const { reads, writes } = describeAllowList();
  const cases: Array<{ product: Product; method: string; template: string }> = [
    ...reads.map((r) => ({ product: r.product, method: 'GET', template: r.path })),
    ...writes.map((w) => ({ product: w.product, method: w.method, template: w.path })),
  ];

  /**
   * Re-implementation of the matcher, so the sweep can tell a real bypass from
   * a mutation that happens to land on a *different* allow-listed template
   * (e.g. `/v1/projects` + one segment is `/v1/projects/{name}`, a legitimate
   * app lookup). Only genuinely uncovered paths must be denied.
   */
  const covered = (product: Product, method: string, path: string): boolean => {
    const templates =
      method === 'GET'
        ? reads.filter((r) => r.product === product).map((r) => r.path)
        : [];
    const writeTemplates = writes
      .filter((w) => w.product === product && w.method === method)
      .map((w) => w.path);
    return [...templates, ...writeTemplates].some((t) => {
      const ts = t.split('/');
      const ps = path.split('/');
      if (ts.length !== ps.length) return false;
      return ts.every((seg, i) => (seg.startsWith('{') && seg.endsWith('}')) || seg === ps[i]);
    });
  };

  let checked = 0;
  for (const { product, method, template } of cases) {
    const concrete = template.replace(/\{[^}]+\}/g, 'x');
    allowed(product, method, concrete);
    const segs = concrete.split('/');
    const tSegs = template.split('/');

    const mutations: Array<[string, string]> = [
      [`${concrete}/extra`, `append to ${template}`],
      [`${concrete}/x/y`, `append2 to ${template}`],
    ];
    if (segs.length > 2) mutations.push([segs.slice(0, -1).join('/'), `truncate ${template}`]);
    // Corrupt each literal segment; wildcards were already replaced by 'x'.
    for (let i = 1; i < tSegs.length; i++) {
      if (tSegs[i].startsWith('{')) continue;
      const mutated = [...segs];
      mutated[i] = `${segs[i]}z`;
      mutations.push([mutated.join('/'), `mutate seg ${i} of ${template}`]);
    }

    for (const [path, label] of mutations) {
      if (covered(product, method, path)) continue; // legitimately another rule
      denied(product, method, path, label);
      checked++;
    }
  }
  assert.ok(checked > 60, `sweep degenerated, only ${checked} mutations asserted`);
});

test('classify only ever returns one of the four documented kinds', () => {
  const valid = new Set(['read', 'reversible-write', 'destructive', 'unknown']);
  const paths = [
    ...BYPASS_PATHS,
    '/v1/projects',
    '/v1/projects/x',
    '/v1/projects/update-envs',
    '/api/v1/zones/e.com/dns-records',
    '/api/v1/buckets/b',
    '/v1/databases/id/metrics/summary',
  ];
  for (const p of PRODUCTS) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'WAT']) {
      for (const path of paths) {
        const k = classify(p, m, path);
        assert.ok(valid.has(k), `classify returned ${JSON.stringify(k)}`);
      }
    }
  }
});
