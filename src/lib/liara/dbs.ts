/**
 * DBaaS (managed database) operations. READ ONLY.
 *
 * Every database write is denied by `allowlist.ts`: deletion is a DELETE,
 * resize can shrink storage, scale 0 stops a live database, and settings /
 * public-network changes alter the security posture. None of those are
 * reversible by a symmetric call, so none are exposed.
 */

import { fail, liaraFetch } from './client';
import type { DatabaseBackup, DatabaseSummary, LiaraCtx, MetricsSummary, ToolResult } from './types';

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
/** Metrics and backups are keyed by id; events accepts the hostname. */
const HOSTNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

function badId(id: unknown): string | null {
  if (typeof id !== 'string' || !OBJECT_ID_RE.test(id)) {
    return `invalid database id ${JSON.stringify(id)} (expected a 24-character hex id)`;
  }
  return null;
}

export function listDatabases(
  ctx: LiaraCtx,
): Promise<ToolResult<{ databases: DatabaseSummary[] }>> {
  return liaraFetch<{ databases: DatabaseSummary[] }>('dbaas', 'GET', '/v1/databases', { ctx });
}

export function getDatabase(
  ctx: LiaraCtx,
  id: string,
): Promise<ToolResult<{ database: DatabaseSummary }>> {
  const bad = badId(id);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch<{ database: DatabaseSummary }>('dbaas', 'GET', `/v1/databases/${id}`, { ctx });
}

/** Resolve a hostname (e.g. `digishop-db`) to its id, since most paths need the id. */
export async function findDatabaseByHostname(
  ctx: LiaraCtx,
  hostname: string,
): Promise<ToolResult<DatabaseSummary>> {
  if (typeof hostname !== 'string' || !HOSTNAME_RE.test(hostname)) {
    return fail(`invalid database hostname ${JSON.stringify(hostname)}`);
  }
  const list = await listDatabases(ctx);
  if (!list.ok) return list;

  const found = (list.data?.databases ?? []).find((d) => d?.hostname === hostname);
  if (!found) {
    const names = (list.data?.databases ?? []).map((d) => d?.hostname).filter(Boolean);
    return fail(
      `no database named "${hostname}" in this account. Databases: ${names.join(', ') || '(none)'}`,
    );
  }
  return { ok: true, data: found, source: 'account' };
}

export function getDatabaseMetrics(
  ctx: LiaraCtx,
  id: string,
): Promise<ToolResult<MetricsSummary>> {
  const bad = badId(id);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch<MetricsSummary>('dbaas', 'GET', `/v1/databases/${id}/metrics/summary`, { ctx });
}

export type DbMetricSeries = 'cpu' | 'memory' | 'network-receive' | 'network-transmit';

const DB_METRIC_SERIES: readonly DbMetricSeries[] = [
  'cpu',
  'memory',
  'network-receive',
  'network-transmit',
];

export function getDatabaseMetricSeries(
  ctx: LiaraCtx,
  id: string,
  series: DbMetricSeries,
  opts?: { since?: number; sinceMinutes?: number },
): Promise<ToolResult<unknown>> {
  const bad = badId(id);
  if (bad) return Promise.resolve(fail(bad));
  if (!DB_METRIC_SERIES.includes(series)) {
    return Promise.resolve(
      fail(`unknown metric series ${JSON.stringify(series)} (expected ${DB_METRIC_SERIES.join(', ')})`),
    );
  }
  const since =
    opts?.since !== undefined
      ? Math.floor(opts.since)
      : Math.floor(Date.now() / 1000) - Math.max(1, opts?.sinceMinutes ?? 60) * 60;

  return liaraFetch('dbaas', 'GET', `/v1/databases/${id}/metrics/${series}`, {
    ctx,
    query: { since: String(since) },
  });
}

/** List existing backups. Creating a backup is a write and is not exposed. */
export function listDatabaseBackups(
  ctx: LiaraCtx,
  id: string,
): Promise<ToolResult<{ backups: DatabaseBackup[] }>> {
  const bad = badId(id);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch<{ backups: DatabaseBackup[] }>('dbaas', 'GET', `/v1/databases/${id}/backups`, {
    ctx,
  });
}

/** Events accept either the id or the hostname upstream. */
export function getDatabaseEvents(
  ctx: LiaraCtx,
  idOrHostname: string,
): Promise<ToolResult<{ data?: unknown[] }>> {
  if (typeof idOrHostname !== 'string' || !HOSTNAME_RE.test(idOrHostname)) {
    return Promise.resolve(fail(`invalid database identifier ${JSON.stringify(idOrHostname)}`));
  }
  return liaraFetch('dbaas', 'GET', `/v1/databases/${idOrHostname}/events`, { ctx });
}
