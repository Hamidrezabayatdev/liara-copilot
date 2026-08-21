/**
 * Public surface of the Liara platform client.
 *
 * Import from here. Everything that touches the network goes through
 * `liaraFetch`, which is gated by `assertAllowed`. There is deliberately no
 * generic "call any endpoint" export: a coarse dispatcher would let a model
 * route around the per-operation rules.
 */

export type {
  AccountAndPlans,
  AppSummary,
  Bucket,
  DatabaseBackup,
  DatabaseSummary,
  DnsRecord,
  DnsRecordInput,
  DnsRecordType,
  EnvVar,
  LiaraCtx,
  LogLine,
  MetricsSummary,
  OpKind,
  Plan,
  PlanCatalog,
  Product,
  Release,
  ReleasesPage,
  ToolResult,
  Zone,
} from './types';
export { DNS_RECORD_TYPES, DNS_TTLS } from './types';

// Security layer.
export { assertAllowed, classify, describeAllowList, LiaraNotAllowedError, normalizeApiPath } from './allowlist';

// Transport.
export { ctxFromEnv, fail, isOk, liaraFetch } from './client';

// Account + plans.
export { getAccountAndPlans, listPlans, validatePlanID } from './account';
export type { PlanKind, PlanSummary } from './account';

// Apps (PaaS).
export {
  getApp,
  getAppApplets,
  getAppCpuMetrics,
  getAppDiskBackups,
  getAppDisks,
  getAppEvents,
  getAppLogs,
  getAppMemoryMetrics,
  getAppMetricSeries,
  getAppMetrics,
  getAppNetworkReceiveMetrics,
  getAppNetworkTransmitMetrics,
  getAppReleases,
  listAppEnvs,
  listApps,
  resizeApp,
  restartApp,
  rollbackRelease,
  scaleApp,
  setAppEnvs,
} from './apps';
export type { EnvInput, MetricSeries } from './apps';

// Databases (DBaaS) — reads only.
export {
  findDatabaseByHostname,
  getDatabase,
  getDatabaseEvents,
  getDatabaseMetricSeries,
  getDatabaseMetrics,
  listDatabaseBackups,
  listDatabases,
} from './dbs';
export type { DbMetricSeries } from './dbs';

// DNS.
export { createDnsRecord, getDnsRecord, getZone, listDnsRecords, listZones } from './dns';

// Object storage — reads only.
export {
  getBucket,
  getBucketHistoricalMetrics,
  getBucketMetrics,
  listBuckets,
} from './storage';
