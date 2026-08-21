/**
 * PaaS (app) operations. Pure async functions — no AI SDK involvement.
 * Every call funnels through `liaraFetch`, so every call is allow-list gated.
 *
 * Writes here are the five permitted PaaS writes and nothing else. There is no
 * create and no delete: app deletion is hard-blocked in `allowlist.ts`.
 */

import { fail, liaraFetch } from './client';
import { validatePlanID } from './account';
import type {
  AppSummary,
  EnvVar,
  LiaraCtx,
  LogLine,
  MetricsSummary,
  ReleasesPage,
  ToolResult,
} from './types';

/** App names must be safe as a single URL path segment. */
const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** Liara object ids are 24-char hex. */
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function badName(name: unknown): string | null {
  if (typeof name !== 'string' || !APP_NAME_RE.test(name)) {
    return `invalid app name ${JSON.stringify(name)} (expected letters, digits, "-", "_", ".")`;
  }
  return null;
}

function badId(id: unknown): string | null {
  if (typeof id !== 'string' || !OBJECT_ID_RE.test(id)) {
    return `invalid app id ${JSON.stringify(id)} (expected a 24-character hex id)`;
  }
  return null;
}

/* ================================================================== *
 * Reads
 * ================================================================== */

export function listApps(ctx: LiaraCtx): Promise<ToolResult<{ projects: AppSummary[] }>> {
  return liaraFetch<{ projects: AppSummary[] }>('paas', 'GET', '/v1/projects', { ctx });
}

export function getApp(
  ctx: LiaraCtx,
  name: string,
): Promise<ToolResult<{ project: AppSummary }>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch<{ project: AppSummary }>('paas', 'GET', `/v1/projects/${name}`, { ctx });
}

/**
 * App logs. `since` is required by the API — a unix timestamp in seconds.
 * Defaults to the last hour, which is what you want when triaging a 502.
 */
export function getAppLogs(
  ctx: LiaraCtx,
  name: string,
  opts?: { since?: number | string; sinceMinutes?: number },
): Promise<ToolResult<LogLine[] | { data?: LogLine[] }>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));

  const since =
    opts?.since !== undefined
      ? String(opts.since)
      : String(Math.floor(Date.now() / 1000) - Math.max(1, opts?.sinceMinutes ?? 60) * 60);

  if (!/^\d{1,12}$/.test(since)) {
    return Promise.resolve(fail(`invalid "since" ${JSON.stringify(since)} (unix seconds expected)`));
  }
  return liaraFetch('paas', 'GET', `/v1/projects/${name}/logs`, { ctx, query: { since } });
}

export function getAppEvents(
  ctx: LiaraCtx,
  name: string,
  opts?: { search?: string; start?: number; end?: number },
): Promise<ToolResult<{ data?: unknown[] }>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));

  const query: Record<string, string> = {};
  if (opts?.search) query.search = opts.search;
  if (opts?.start !== undefined) query.start = String(Math.floor(opts.start));
  if (opts?.end !== undefined) query.end = String(Math.floor(opts.end));

  return liaraFetch('paas', 'GET', `/v1/projects/${name}/events`, { ctx, query });
}

/** Releases, newest first. `page`/`count` are required upstream, so always sent. */
export function getAppReleases(
  ctx: LiaraCtx,
  name: string,
  opts?: { page?: number; count?: number },
): Promise<ToolResult<ReleasesPage>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));

  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const count = Math.min(100, Math.max(1, Math.floor(opts?.count ?? 10)));
  return liaraFetch<ReleasesPage>('paas', 'GET', `/v1/projects/${name}/releases`, {
    ctx,
    query: { page: String(page), count: String(count) },
  });
}

export function getAppMetrics(
  ctx: LiaraCtx,
  name: string,
): Promise<ToolResult<MetricsSummary>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch<MetricsSummary>('paas', 'GET', `/v1/projects/${name}/metrics/summary`, { ctx });
}

export type MetricSeries = 'cpu' | 'memory' | 'network-receive' | 'network-transmit';

const METRIC_SERIES: readonly MetricSeries[] = ['cpu', 'memory', 'network-receive', 'network-transmit'];

/** A single time-series metric. `since` is a unix timestamp in seconds. */
export function getAppMetricSeries(
  ctx: LiaraCtx,
  name: string,
  series: MetricSeries,
  opts?: { since?: number; sinceMinutes?: number },
): Promise<ToolResult<unknown>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));
  if (!METRIC_SERIES.includes(series)) {
    return Promise.resolve(
      fail(`unknown metric series ${JSON.stringify(series)} (expected ${METRIC_SERIES.join(', ')})`),
    );
  }
  const since =
    opts?.since !== undefined
      ? Math.floor(opts.since)
      : Math.floor(Date.now() / 1000) - Math.max(1, opts?.sinceMinutes ?? 60) * 60;

  return liaraFetch('paas', 'GET', `/v1/projects/${name}/metrics/${series}`, {
    ctx,
    query: { since: String(since) },
  });
}

export const getAppCpuMetrics = (ctx: LiaraCtx, name: string, opts?: { since?: number; sinceMinutes?: number }) =>
  getAppMetricSeries(ctx, name, 'cpu', opts);
export const getAppMemoryMetrics = (ctx: LiaraCtx, name: string, opts?: { since?: number; sinceMinutes?: number }) =>
  getAppMetricSeries(ctx, name, 'memory', opts);
export const getAppNetworkReceiveMetrics = (ctx: LiaraCtx, name: string, opts?: { since?: number; sinceMinutes?: number }) =>
  getAppMetricSeries(ctx, name, 'network-receive', opts);
export const getAppNetworkTransmitMetrics = (ctx: LiaraCtx, name: string, opts?: { since?: number; sinceMinutes?: number }) =>
  getAppMetricSeries(ctx, name, 'network-transmit', opts);

/** Disks. Upstream keys this by app **id**, not name. */
export function getAppDisks(ctx: LiaraCtx, id: string): Promise<ToolResult<unknown>> {
  const bad = badId(id);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('paas', 'GET', `/v1/projects/${id}/disks`, { ctx });
}

export function getAppDiskBackups(
  ctx: LiaraCtx,
  id: string,
  diskName: string,
): Promise<ToolResult<unknown>> {
  const bad = badId(id) ?? badName(diskName);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('paas', 'GET', `/v1/projects/${id}/disks/${diskName}/backups`, { ctx });
}

export function getAppApplets(ctx: LiaraCtx, name: string): Promise<ToolResult<unknown>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('paas', 'GET', `/v1/projects/${name}/applets`, { ctx });
}

/**
 * Environment variables. There is no dedicated envs endpoint — they arrive
 * inside `GET /v1/projects/{name}`.
 */
export async function listAppEnvs(
  ctx: LiaraCtx,
  name: string,
): Promise<ToolResult<{ envs: EnvVar[] }>> {
  const res = await getApp(ctx, name);
  if (!res.ok) return res;
  const raw = (res.data?.project as { envs?: unknown })?.envs;
  const envs = Array.isArray(raw)
    ? raw
        .filter((e): e is EnvVar => !!e && typeof (e as EnvVar).key === 'string')
        .map((e) => ({ key: e.key, value: String((e as EnvVar).value ?? '') }))
    : [];
  return { ok: true, data: { envs }, source: 'account' };
}

/* ================================================================== *
 * Writes — the five permitted PaaS writes
 * ================================================================== */

export type EnvInput = Record<string, string | number | boolean> | EnvVar[];

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function toEnvArray(input: EnvInput): { envs: EnvVar[] } | { error: string } {
  const out: EnvVar[] = [];
  const entries: Array<[string, unknown]> = Array.isArray(input)
    ? input.map((e) => [e?.key as string, e?.value])
    : Object.entries(input ?? {});

  const seen = new Set<string>();
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || !ENV_KEY_RE.test(key)) {
      return { error: `invalid env var name ${JSON.stringify(key)} (expected [A-Za-z_][A-Za-z0-9_]*)` };
    }
    if (seen.has(key)) return { error: `duplicate env var ${key}` };
    seen.add(key);
    if (value === undefined || value === null) {
      return { error: `env var ${key} has no value (use "" to blank it)` };
    }
    out.push({ key, value: String(value) });
  }
  return { envs: out };
}

/**
 * Set environment variables.
 *
 * `POST /v1/projects/update-envs` REPLACES the whole set upstream, which makes
 * a partial payload silently destructive. So the default here is `'merge'`:
 * read the current set, apply the changes on top, send the union. Pass
 * `mode: 'replace'` for a deliberate full replacement.
 *
 * The previous set is always returned so the caller can render a diff and
 * offer an exact undo — this is what makes the write reversible.
 */
export async function setAppEnvs(
  ctx: LiaraCtx,
  name: string,
  envs: EnvInput,
  opts?: { mode?: 'merge' | 'replace' },
): Promise<ToolResult<{ previous: EnvVar[]; applied: EnvVar[]; mode: 'merge' | 'replace' }>> {
  const bad = badName(name);
  if (bad) return fail(bad);

  const parsed = toEnvArray(envs);
  if ('error' in parsed) return fail(parsed.error);

  const mode = opts?.mode ?? 'merge';

  const current = await listAppEnvs(ctx, name);
  if (!current.ok) return current;
  const previous = current.data.envs;

  let applied: EnvVar[];
  if (mode === 'replace') {
    applied = parsed.envs;
  } else {
    const merged = new Map(previous.map((e) => [e.key, e.value]));
    for (const e of parsed.envs) merged.set(e.key, e.value);
    applied = [...merged].map(([key, value]) => ({ key, value }));
  }

  const res = await liaraFetch<unknown>('paas', 'POST', '/v1/projects/update-envs', {
    ctx,
    body: { project: name, variables: applied },
  });
  if (!res.ok) return res;

  return { ok: true, data: { previous, applied, mode }, source: 'account' };
}

export function restartApp(ctx: LiaraCtx, name: string): Promise<ToolResult<unknown>> {
  const bad = badName(name);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('paas', 'POST', `/v1/projects/${name}/actions/restart`, { ctx, body: {} });
}

/** Upper bound on instances. The API is the final authority; this stops typos. */
const MAX_SCALE = 10;

/**
 * Scale an app. `0` stops it, `1..MAX_SCALE` runs that many instances.
 * Reversible: the previous scale is returned so the caller can undo exactly.
 */
export async function scaleApp(
  ctx: LiaraCtx,
  name: string,
  scale: number,
): Promise<ToolResult<{ previousScale: number | null; scale: number }>> {
  const bad = badName(name);
  if (bad) return fail(bad);

  if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    return fail(`invalid scale ${JSON.stringify(scale)} (expected an integer 0..${MAX_SCALE})`);
  }

  // Read first so the confirmation UI can show before/after and undo exactly.
  const before = await getApp(ctx, name);
  if (!before.ok) return before;
  const previousScale =
    typeof before.data?.project?.scale === 'number' ? before.data.project.scale : null;

  const res = await liaraFetch<unknown>('paas', 'POST', `/v1/projects/${name}/actions/scale`, {
    ctx,
    body: { scale },
  });
  if (!res.ok) return res;

  return { ok: true, data: { previousScale, scale }, source: 'account' };
}

/**
 * Change an app's compute plan. `planID` is validated against the account's own
 * catalog from `GET /v1/me` — never against a hardcoded list.
 *
 * A plan that exists but is flagged unavailable is still attempted (the flag is
 * unreliable, docs/VERIFIED-FACTS.md §6); the warning is returned either way so
 * a failure is explainable.
 */
export async function resizeApp(
  ctx: LiaraCtx,
  name: string,
  planID: string,
): Promise<ToolResult<{ previousPlanID: string | null; planID: string; warning?: string }>> {
  const bad = badName(name);
  if (bad) return fail(bad);

  const check = await validatePlanID(ctx, planID, 'projects');
  if (!check.ok) return check;

  const before = await getApp(ctx, name);
  if (!before.ok) return before;
  const previousPlanID =
    typeof before.data?.project?.planID === 'string' ? before.data.project.planID : null;

  if (previousPlanID === planID) {
    return fail(`app "${name}" is already on plan "${planID}" — nothing to change`);
  }

  const res = await liaraFetch<unknown>('paas', 'POST', `/v1/projects/${name}/resize`, {
    ctx,
    body: { planID },
  });
  if (!res.ok) {
    return check.data.warning ? fail(`${res.error} (${check.data.warning})`, res.status) : res;
  }

  return {
    ok: true,
    data: { previousPlanID, planID, warning: check.data.warning },
    source: 'account',
  };
}

/**
 * Roll back to an earlier release by redeploying its source.
 *
 * `POST /v2/projects/{name}/releases` takes `{ sourceID, port, type }`, so the
 * release is looked up first and its source reused. Reversible: the release that
 * was current before the rollback is returned, and rolling forward again is the
 * same call with that id.
 */
export async function rollbackRelease(
  ctx: LiaraCtx,
  name: string,
  releaseId: string,
  overrides?: { port?: number; type?: string },
): Promise<
  ToolResult<{
    rolledBackTo: string;
    previousRelease: string | null;
    sourceID: string;
    port?: number;
    type?: string;
    releaseID?: string;
  }>
> {
  const bad = badName(name);
  if (bad) return fail(bad);
  if (typeof releaseId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(releaseId)) {
    return fail(`invalid release id ${JSON.stringify(releaseId)}`);
  }

  const page = await getAppReleases(ctx, name, { count: 100 });
  if (!page.ok) return page;

  const releases = Array.isArray(page.data?.releases) ? page.data.releases : [];
  const target = releases.find((r) => r?._id === releaseId || (r as { id?: string })?.id === releaseId);
  if (!target) {
    const known = releases.slice(0, 10).map((r) => r._id).filter(Boolean);
    return fail(
      `release "${releaseId}" was not found on app "${name}". ` +
        `Recent release ids: ${known.join(', ') || '(none — the app has never been deployed)'}`,
    );
  }

  const t = target as Record<string, unknown>;
  const sourceID =
    (typeof t.sourceID === 'string' && t.sourceID) ||
    (typeof t.sourceId === 'string' && t.sourceId) ||
    (typeof (t.source as { _id?: string })?._id === 'string' && (t.source as { _id: string })._id) ||
    '';
  if (!sourceID) {
    return fail(
      `release "${releaseId}" has no stored source, so it cannot be redeployed. ` +
        `Redeploy from git or the CLI instead.`,
    );
  }

  const port =
    overrides?.port ?? (typeof t.port === 'number' ? (t.port as number) : undefined);
  const type =
    overrides?.type ??
    (typeof t.type === 'string' ? (t.type as string) : undefined) ??
    (typeof t.projectType === 'string' ? (t.projectType as string) : undefined);

  const body: Record<string, unknown> = { sourceID };
  if (port !== undefined) body.port = port;
  if (type !== undefined) body.type = type;

  const res = await liaraFetch<{ releaseID?: string }>('paas', 'POST', `/v2/projects/${name}/releases`, {
    ctx,
    body,
  });
  if (!res.ok) return res;

  return {
    ok: true,
    data: {
      rolledBackTo: releaseId,
      previousRelease:
        typeof page.data?.currentRelease === 'string' ? page.data.currentRelease : null,
      sourceID,
      port,
      type,
      releaseID: res.data?.releaseID,
    },
    source: 'account',
  };
}
