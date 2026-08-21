#!/usr/bin/env node
/**
 * Live verification of src/lib/liara against the real Liara account.
 *
 *   node scripts/test-liara-client.mjs            # reads + security proof
 *   RUN_WRITE_TEST=1 node scripts/test-liara-client.mjs
 *
 * Nothing here can delete anything: the allow-list makes that impossible, and
 * this script proves it by counting fetch calls around a blocked DELETE.
 */

import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(root, '.env'));

/**
 * src/lib/liara uses extensionless relative imports (`./client`) because tsconfig
 * runs `moduleResolution: "bundler"` and forbids a literal `.ts` specifier.
 * Next's bundler resolves those natively; bare Node does not, so this harness
 * adds the extension itself. Test-harness plumbing only — no production code
 * depends on it.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && path.extname(specifier) === '') {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through to the normal resolution */
      }
    }
    return nextResolve(specifier, context);
  },
});

const liara = await import(new URL('../src/lib/liara/index.ts', import.meta.url).href);

const {
  ctxFromEnv,
  listApps,
  getApp,
  getAppEvents,
  getAppMetrics,
  getAppLogs,
  getAppReleases,
  listAppEnvs,
  listDatabases,
  findDatabaseByHostname,
  getDatabaseMetrics,
  getAccountAndPlans,
  listPlans,
  validatePlanID,
  listZones,
  listBuckets,
  liaraFetch,
  assertAllowed,
  classify,
  describeAllowList,
  LiaraNotAllowedError,
  restartApp,
} = liara;

/* ---------------------------------------------------------------- *
 * Instrument fetch so we can prove the gate runs BEFORE the network.
 * ---------------------------------------------------------------- */
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  fetchCalls++;
  return realFetch(...args);
};

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  ✗ ${m}`);
};
const check = (cond, m) => (cond ? pass(m) : bad(m));
const section = (t) => console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`);

function show(label, value, limit = 420) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  console.log(`    ${label}: ${s.length > limit ? `${s.slice(0, limit)}…` : s}`);
}

const ctx = ctxFromEnv();
if (!ctx) {
  console.error('LIARA_API_TOKEN missing from .env — cannot run live verification.');
  process.exit(1);
}
console.log(
  `token: ${ctx.token.slice(0, 4)}…${ctx.token.slice(-4)} (${ctx.token.length} chars)  ` +
    `teamId: ${ctx.teamId ?? '(none)'}`,
);

/* ================================================================ *
 * 1. Reads
 * ================================================================ */
section('1. READS against the live account');

const apps = await listApps(ctx);
check(apps.ok, `listApps -> ok=${apps.ok}`);
if (!apps.ok) show('error', apps.error);
else {
  const names = apps.data.projects.map((p) => p.project_id);
  check(apps.data.projects.length === 4, `listApps returned 4 apps (got ${apps.data.projects.length})`);
  check(apps.source === 'account', `source === 'account'`);
  show('apps', names);
  show(
    'detail',
    apps.data.projects.map((p) => `${p.project_id} [${p.type}/${p.planID}] ${p.status} scale=${p.scale}`),
  );
}

const app = await getApp(ctx, 'digishop-api');
check(app.ok && app.data.project?.project_id === 'digishop-api', `getApp('digishop-api')`);
if (app.ok) {
  const p = app.data.project;
  show('project', {
    _id: p._id,
    project_id: p.project_id,
    type: p.type,
    status: p.status,
    scale: p.scale,
    planID: p.planID,
    bundlePlanID: p.bundlePlanID,
    isDeployed: p.isDeployed,
    network: p.network?.name,
  });
} else show('error', app.error);

const envs = await listAppEnvs(ctx, 'digishop-api');
check(envs.ok, `listAppEnvs('digishop-api') -> ok=${envs.ok}`);
if (envs.ok) show('envs', `${envs.data.envs.length} variable(s): ${envs.data.envs.map((e) => e.key).join(', ') || '(none)'}`);

const events = await getAppEvents(ctx, 'digishop-api');
check(events.ok, `getAppEvents('digishop-api') -> ok=${events.ok}`);
show('events', events.ok ? events.data : events.error);

const metrics = await getAppMetrics(ctx, 'digishop-api');
check(metrics.ok, `getAppMetrics('digishop-api') -> ok=${metrics.ok}`);
if (metrics.ok) {
  show('metrics keys', Object.keys(metrics.data));
  show('metrics', metrics.data);
} else show('error', metrics.error);

const logs = await getAppLogs(ctx, 'digishop-api', { sinceMinutes: 60 });
check(logs.ok, `getAppLogs('digishop-api', last 60m) -> ok=${logs.ok}`);
show('logs', logs.ok ? logs.data : logs.error);

const releases = await getAppReleases(ctx, 'digishop-api');
check(releases.ok, `getAppReleases('digishop-api') -> ok=${releases.ok}`);
show('releases', releases.ok ? releases.data : releases.error);

const dbs = await listDatabases(ctx);
check(dbs.ok, `listDatabases -> ok=${dbs.ok}`);
if (dbs.ok) {
  check(dbs.data.databases.length === 1, `listDatabases returned 1 database (got ${dbs.data.databases.length})`);
  show(
    'databases',
    dbs.data.databases.map((d) => `${d.hostname} [${d.type}/${d.planID}] ${d.status} id=${d._id}`),
  );
} else show('error', dbs.error);

const dbLookup = await findDatabaseByHostname(ctx, 'digishop-db');
check(dbLookup.ok, `findDatabaseByHostname('digishop-db') -> ok=${dbLookup.ok}`);
if (dbLookup.ok) {
  const dbMetrics = await getDatabaseMetrics(ctx, dbLookup.data._id);
  check(dbMetrics.ok, `getDatabaseMetrics(${dbLookup.data._id}) -> ok=${dbMetrics.ok}`);
  show('db metrics', dbMetrics.ok ? Object.keys(dbMetrics.data) : dbMetrics.error);
}

const me = await getAccountAndPlans(ctx);
check(me.ok, `getAccountAndPlans -> ok=${me.ok}`);
if (me.ok) {
  show('me keys', Object.keys(me.data));
  show('team', `${me.data.team?.teamName} id=${me.data.team?._id} role=${JSON.stringify(me.data.team?.teamMemberRole)}`);
  show('plan tables', Object.keys(me.data.plans));
  show('project plans in catalog', Object.keys(me.data.plans.projects).length);
} else show('error', me.error);

const plans = await listPlans(ctx, 'projects', { region: 'iran' });
check(plans.ok, `listPlans('projects', iran) -> ok=${plans.ok}`);
if (plans.ok) {
  show(
    'cheapest 6',
    plans.data.slice(0, 6).map((p) => `${p.planID} ${p.pricePerHour}T/h ${p.ramGB}G/${p.cpuCores}cpu/${p.diskGB}G`),
  );
}

const goodPlan = await validatePlanID(ctx, 'medium-g2');
check(goodPlan.ok, `validatePlanID('medium-g2') accepted`);
if (goodPlan.ok) show('plan', { ...goodPlan.data.plan, warning: goodPlan.data.warning });

const fakePlan = await validatePlanID(ctx, 'mega-g9');
check(!fakePlan.ok, `validatePlanID('mega-g9') rejected against the LIVE catalog`);
show('rejection', fakePlan.ok ? '(unexpectedly accepted)' : fakePlan.error);

const legacyPlan = await validatePlanID(ctx, 'ir-small');
check(legacyPlan.ok && !!legacyPlan.data.warning, `validatePlanID('ir-small') warns about g1 (§6)`);
show('warning', legacyPlan.ok ? legacyPlan.data.warning : legacyPlan.error);

const zones = await listZones(ctx);
check(typeof zones.ok === 'boolean', `listZones returned a ToolResult (ok=${zones.ok})`);
show('zones', zones.ok ? zones.data : `${zones.status ?? ''} ${zones.error}`);

const buckets = await listBuckets(ctx);
check(typeof buckets.ok === 'boolean', `listBuckets returned a ToolResult (ok=${buckets.ok})`);
show('buckets', buckets.ok ? buckets.data : `${buckets.status ?? ''} ${buckets.error}`);

/* ================================================================ *
 * 2. Security proof — no network call for a blocked operation
 * ================================================================ */
section('2. SECURITY — DELETE is blocked before any network call');

const before = fetchCalls;
console.log(`  fetch calls so far: ${before}`);

let thrown = null;
try {
  await liaraFetch('paas', 'DELETE', '/v1/projects/digishop-api', { ctx });
} catch (e) {
  thrown = e;
}
const after = fetchCalls;

check(thrown instanceof LiaraNotAllowedError, `liaraFetch DELETE /v1/projects/digishop-api THREW LiaraNotAllowedError`);
show('thrown', thrown ? `${thrown.name}: ${thrown.message}` : '(nothing thrown!)');
check(after === before, `fetch call count unchanged: ${before} -> ${after} (ZERO network traffic)`);
check(classify('paas', 'DELETE', '/v1/projects/digishop-api') === 'destructive', `classify -> 'destructive'`);

console.log('\n  every blocked attempt, each asserted to make zero network calls:');
const blocked = [
  ['paas', 'DELETE', '/v1/projects/digishop-api', 'delete the app'],
  ['paas', 'DELETE', '/v1/projects/liara-copilot-ir', 'delete our own app'],
  ['dbaas', 'DELETE', '/v1/databases/6a879116ffa5ac74ac3e8f51', 'delete the database'],
  ['dns', 'DELETE', '/api/v1/zones/example.com', 'delete a zone'],
  ['storage', 'DELETE', '/api/v1/buckets/anything', 'delete a bucket'],
  ['paas', 'POST', '/v1/projects', 'create a billable app'],
  ['paas', 'GET', '/v1/projects/digishop-api/disks/data/ftp', 'read FTP credentials'],
  ['storage', 'GET', '/api/v1/keys', 'read storage access keys'],
  ['paas', 'POST', '/v1/projects/../../admin', 'path traversal'],
  ['paas', 'POST', '/v1/projects/%2e%2e/x', 'encoded traversal'],
  ['paas', 'POST', '/v1/projects/digishop-api%2factions%2frestart', 'encoded slash'],
  ['paas', 'POST', '/v1/projects/digishop-api/actions/restart\n', 'trailing newline'],
  ['paas', 'DELETE', '/v1/projects/digishop-api?teamID=x', 'delete with a query string'],
  ['dbaas', 'POST', '/v1/databases/6a879116ffa5ac74ac3e8f51/actions/scale', 'stop the live database'],
];
for (const [product, method, p, label] of blocked) {
  const n = fetchCalls;
  let threw = false;
  try {
    await liaraFetch(product, method, p, { ctx, body: {} });
  } catch (e) {
    threw = e instanceof LiaraNotAllowedError;
  }
  const noTraffic = fetchCalls === n;
  check(threw && noTraffic, `${method} ${product}:${p} blocked [${label}] (fetch calls +${fetchCalls - n})`);
}

console.log('\n  assertAllowed directly:');
for (const [product, method, p] of blocked) {
  let threw = false;
  try {
    assertAllowed(product, method, p);
  } catch {
    threw = true;
  }
  if (!threw) bad(`assertAllowed did NOT throw for ${method} ${product}:${p}`);
}
pass(`assertAllowed threw for all ${blocked.length} blocked operations`);

const { writes } = describeAllowList();
check(writes.length === 6, `the write allow-list is exactly 6 entries`);
show('permitted writes', writes.map((w) => `${w.product} ${w.method} ${w.path}`));

/* ================================================================ *
 * 3. Nothing was actually deleted
 * ================================================================ */
section('3. CONFIRM nothing was deleted');

const after1 = await listApps(ctx);
check(after1.ok && after1.data.projects.length === 4, `listApps still returns 4 apps`);
if (after1.ok) show('apps', after1.data.projects.map((p) => p.project_id));

const afterDbs = await listDatabases(ctx);
check(afterDbs.ok && afterDbs.data.databases.length === 1, `listDatabases still returns 1 database`);
if (afterDbs.ok) show('databases', afterDbs.data.databases.map((d) => d.hostname));

/* ================================================================ *
 * 4. Optional: exercise a permitted, reversible write
 * ================================================================ */
if (process.env.RUN_WRITE_TEST === '1') {
  section('4. PERMITTED WRITE — restart digishop-api (reversible, idempotent)');
  const r = await restartApp(ctx, 'digishop-api');
  check(r.ok, `restartApp('digishop-api') -> ok=${r.ok}`);
  show('result', r.ok ? r.data : `${r.status ?? ''} ${r.error}`);
} else {
  console.log('\n(skipping the write test — set RUN_WRITE_TEST=1 to exercise restartApp)');
}

/* ================================================================ *
 * Summary
 * ================================================================ */
section(failures === 0 ? 'RESULT: ALL CHECKS PASSED' : `RESULT: ${failures} CHECK(S) FAILED`);
console.log(`total fetch calls made: ${fetchCalls}`);
process.exit(failures === 0 ? 0 : 1);
