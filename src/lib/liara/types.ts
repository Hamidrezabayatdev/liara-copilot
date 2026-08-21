/**
 * Frozen public contract for the Liara platform client.
 * Other workstreams (agent core, UI) build against exactly these shapes.
 */

export type Product = 'paas' | 'dbaas' | 'dns' | 'storage';

export type LiaraCtx = {
  token: string;
  /**
   * Liara team id. MUST be threaded through for team accounts: without
   * `teamID` the management API silently answers for the *personal* account
   * (which is empty) instead of erroring. See docs/VERIFIED-FACTS.md §1.
   */
  teamId?: string;
};

export type ToolResult<T> =
  | { ok: true; data: T; source: 'account' }
  | { ok: false; error: string; status?: number };

/** Risk classification used by the allow-list and by the approval layer. */
export type OpKind = 'read' | 'reversible-write' | 'destructive' | 'unknown';

/* ------------------------------------------------------------------ *
 * PaaS
 * ------------------------------------------------------------------ */

export type AppSummary = {
  _id: string;
  /** The app name. Liara calls it `project_id` in list/get responses. */
  project_id: string;
  type: string;
  status: string;
  scale: number;
  planID: string;
  bundlePlanID?: string;
  network?: { _id: string; name: string };
  created_at: string;
  isDeployed?: boolean;
  envs?: EnvVar[];
  [k: string]: unknown;
};

export type EnvVar = { key: string; value: string };

export type LogLine = { type?: string; datetime?: string; message?: string };

export type Release = {
  _id: string;
  type?: string;
  state?: string;
  port?: number;
  imageName?: string;
  projectType?: string;
  sourceID?: string;
  createdAt?: string;
  [k: string]: unknown;
};

export type ReleasesPage = {
  total?: number;
  currentRelease?: string;
  readyReleasesCount?: number;
  releases: Release[];
};

export type MetricsSummary = {
  cpuUsage?: Array<{ value?: unknown; applet?: string }>;
  memoryUsage?: Array<{ value?: unknown; applet?: string }>;
  disksUsage?: Array<{ size?: string; usage?: string; reportedAt?: string; name?: string }>;
  [k: string]: unknown;
};

/* ------------------------------------------------------------------ *
 * DBaaS
 * ------------------------------------------------------------------ */

export type DatabaseSummary = {
  _id: string;
  id?: string;
  hostname: string;
  type: string;
  status: string;
  scale: number;
  planID: string;
  bundlePlanID?: string;
  network?: { _id: string; name: string };
  publicNetwork?: boolean;
  internalPort?: number;
  created_at: string;
  [k: string]: unknown;
};

export type DatabaseBackup = {
  name: string;
  lastModified?: string;
  etag?: string;
  size?: number;
};

/* ------------------------------------------------------------------ *
 * DNS
 * ------------------------------------------------------------------ */

export type DnsRecordType =
  | 'A' | 'AAAA' | 'TXT' | 'CNAME' | 'ALIAS' | 'MX' | 'SRV' | 'SPF' | 'PTR' | 'CAA';

export type DnsRecordInput = {
  /** `@` for the zone root, `*` for a wildcard, otherwise an RFC-1123 label. */
  name: string;
  type: DnsRecordType;
  ttl?: number;
  /** Shape depends on `type`, e.g. `[{ ip: '1.2.3.4' }]` for A. */
  contents: Array<Record<string, unknown>>;
};

export type DnsRecord = DnsRecordInput & { id: string };

export type Zone = {
  id?: string;
  name: string;
  status?: string;
  [k: string]: unknown;
};

/** TTL values the DNS API accepts (from docs/api-specs/dns.yaml). */
export const DNS_TTLS = [
  120, 180, 300, 600, 900, 1800, 3600, 7200, 18000, 43200, 86400, 172800, 432000,
] as const;

export const DNS_RECORD_TYPES: readonly DnsRecordType[] = [
  'A', 'AAAA', 'TXT', 'CNAME', 'ALIAS', 'MX', 'SRV', 'SPF', 'PTR', 'CAA',
];

/* ------------------------------------------------------------------ *
 * Object storage
 * ------------------------------------------------------------------ */

export type Bucket = {
  _id?: string;
  name: string;
  permission?: string;
  plan?: string;
  created_at?: string;
  [k: string]: unknown;
};

/* ------------------------------------------------------------------ *
 * Account + plan catalog (GET /v1/me)
 * ------------------------------------------------------------------ */

export type Plan = {
  available: boolean;
  region: string;
  /** Toman per hour. */
  price: number;
  /** Toman per month, as shown in the console. */
  displayPrice?: number;
  storageClass?: string;
  /** Disk size in GB. */
  volume?: number;
  RAM?: { amount: number; shared: boolean };
  CPU?: { amount: number; shared: boolean };
  [k: string]: unknown;
};

export type PlanCatalog = {
  projects: Record<string, Plan>;
  databases: Record<string, Plan>;
  objectStorage?: Record<string, Plan>;
  projectBundlePlans?: Record<string, unknown>;
  databaseBundlePlans?: Record<string, unknown>;
  [k: string]: unknown;
};

export type AccountAndPlans = {
  user?: Record<string, unknown>;
  team?: Record<string, unknown>;
  featureFlags?: Record<string, unknown>;
  databaseVersions?: Record<string, unknown>;
  defaultDatabaseVersions?: Record<string, unknown>;
  plans: PlanCatalog;
};
