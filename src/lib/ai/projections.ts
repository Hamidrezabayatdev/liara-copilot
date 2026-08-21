/**
 * Raw Liara API shapes → the UI shapes in src/components/types.ts.
 *
 * Every tool result passes through here, for two reasons that happen to point
 * the same way. The components need one canonical shape, and the *model* needs
 * a small one: a single `GET /v1/projects` response is ~14 KB of JSON, most of
 * it plan tables and internal ids. Projecting it to eight fields per app costs
 * roughly a twentieth of the context, which on a Level-3 trace with a dozen
 * tool calls is the difference between one cheap request and several.
 *
 * Everything here is defensive. These are real observed shapes (see
 * docs/VERIFIED-FACTS.md §7), but the account is live and undocumented fields
 * come and go — a projection that throws would take a whole diagnosis with it,
 * so unknown values degrade to `undefined` and the UI omits the row.
 */

import type {
  AppMetricSnapshot,
  AppPlatform,
  AppStatus,
  Deployment,
  DeploymentState,
  DiffRow,
  DnsRecord as UiDnsRecord,
  DnsRecordType as UiDnsRecordType,
  EnvVar as UiEnvVar,
  LiaraApp,
  LogLine as UiLogLine,
  LogSeverity,
  MetricSeries as UiMetricSeries,
  Source,
} from '@/components/types';
import type {
  AppSummary,
  DatabaseSummary,
  DnsRecord,
  EnvVar,
  LogLine,
  MetricsSummary,
  Plan,
  Release,
} from '@/lib/liara/types';

/* ================================================================== *
 * Small helpers
 * ================================================================== */

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function iso(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function round(v: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/* ================================================================== *
 * Apps
 * ================================================================== */

/**
 * Liara's `type` is a build-pack slug and there are more of them than the UI
 * has icons for. Anything unmapped renders as `docker`, which is the honest
 * answer: it says "a container" without claiming a framework.
 */
const PLATFORMS = new Set<AppPlatform>([
  'node', 'next', 'static', 'react', 'laravel', 'django', 'flask', 'php',
  'docker', 'postgres', 'mysql', 'mongodb', 'redis',
]);

const PLATFORM_ALIASES: Record<string, AppPlatform> = {
  nodejs: 'node',
  netcore: 'docker',
  dotnet: 'docker',
  angular: 'static',
  vue: 'static',
  html: 'static',
  python: 'flask',
  postgresql: 'postgres',
  mariadb: 'mysql',
  ms_sql: 'docker',
  elasticsearch: 'docker',
  rabbitmq: 'docker',
};

export function toPlatform(type: unknown): AppPlatform {
  const t = String(type ?? '').toLowerCase();
  if (PLATFORMS.has(t as AppPlatform)) return t as AppPlatform;
  return PLATFORM_ALIASES[t] ?? 'docker';
}

/**
 * Liara's status vocabulary is wider than the four states the UI draws, and
 * two of the mappings carry judgement worth naming:
 *
 *   scale 0            → STOPPED, whatever the API says. A zero-replica app is
 *                        not "running"; reporting ACTIVE here is how you get a
 *                        diagnosis that confidently checks the wrong thing.
 *   deployed === false → BUILDING rather than ACTIVE. An app that exists but
 *                        has never had a release is not serving traffic.
 */
export function toStatus(raw: unknown, scale?: number, isDeployed?: boolean): AppStatus {
  const s = String(raw ?? '').toUpperCase();
  if (scale === 0) return 'STOPPED';
  if (s === 'RUNNING' || s === 'ACTIVE' || s === 'READY') {
    return isDeployed === false ? 'BUILDING' : 'ACTIVE';
  }
  if (s === 'STOPPED' || s === 'SLEEPING' || s === 'PAUSED' || s === 'SUSPENDED') return 'STOPPED';
  if (s === 'BUILDING' || s === 'CREATING' || s === 'DEPLOYING' || s === 'PENDING') return 'BUILDING';
  if (s === 'UNHEALTHY' || s === 'ERROR' || s === 'FAILED' || s === 'CRASHED') return 'UNHEALTHY';
  return isDeployed === false ? 'BUILDING' : 'ACTIVE';
}

/** `small-g2` + its plan row → `۰.۵ GB RAM · ۰.۵ CPU · ۵ GB disk`, or undefined. */
export function planSummary(plan?: Plan): string | undefined {
  if (!plan) return undefined;
  const parts: string[] = [];
  const ram = num(plan.RAM?.amount);
  const cpu = num(plan.CPU?.amount);
  const disk = num(plan.volume);
  if (ram !== undefined) parts.push(`${ram} GB RAM`);
  if (cpu !== undefined) parts.push(`${cpu} CPU`);
  if (disk !== undefined && disk > 0) parts.push(`${disk} GB disk`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function toApp(raw: AppSummary, plans?: Record<string, Plan>): LiaraApp {
  const name = str(raw.project_id) ?? str(raw._id) ?? 'unknown';
  const scale = num(raw.scale) ?? 0;
  const planId = str(raw.planID) ?? 'unknown';
  const plan = plans?.[planId];

  return {
    id: str(raw._id) ?? name,
    name,
    platform: toPlatform(raw.type),
    status: toStatus(raw.status, scale, raw.isDeployed),
    planId,
    planSummary: planSummary(plan),
    scale,
    region: str(plan?.region) ?? str(raw.region) ?? 'iran',
    // Liara's default host. Not returned by the API — it is derived from the
    // app name, and every Liara user recognises the pattern.
    subdomain: `${name}.iran.liara.run`,
    domains: Array.isArray(raw.domains)
      ? raw.domains.map((d) => (typeof d === 'string' ? d : str((d as { name?: string })?.name) ?? '')).filter(Boolean)
      : undefined,
    createdAt: iso(raw.created_at) ?? new Date(0).toISOString(),
    network: str(raw.network?.name),
    note: raw.isDeployed === false ? 'هنوز هیچ release موفقی روی این app منتشر نشده است.' : undefined,
  };
}

export function toDatabaseApp(raw: DatabaseSummary, plans?: Record<string, Plan>): LiaraApp {
  const name = str(raw.hostname) ?? str(raw._id) ?? 'unknown';
  const scale = num(raw.scale) ?? 0;
  const planId = str(raw.planID) ?? 'unknown';
  const plan = plans?.[planId];

  return {
    id: str(raw._id) ?? str(raw.id) ?? name,
    name,
    platform: toPlatform(raw.type),
    status: toStatus(raw.status, scale, true),
    planId,
    planSummary: planSummary(plan),
    scale,
    region: str(plan?.region) ?? 'iran',
    createdAt: iso(raw.created_at) ?? new Date(0).toISOString(),
    version: str(raw.version),
    network: str(raw.network?.name),
    note: raw.publicNetwork === true ? 'public network روی این database فعال است.' : undefined,
  };
}

/**
 * `GET /v1/projects/{name}/metrics/summary` reports per-applet arrays. For an
 * app of scale 1 that is one entry; for a scaled app the mean is what a human
 * means by "CPU usage", so that is what is reported.
 */
export function toMetricSnapshot(raw: MetricsSummary | undefined): AppMetricSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const mean = (rows: unknown): number | undefined => {
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const values = rows.map((r) => num((r as { value?: unknown })?.value)).filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const cpu = mean(raw.cpuUsage);
  const mem = mean(raw.memoryUsage);
  if (cpu === undefined && mem === undefined) return undefined;

  return {
    cpuPercent: cpu === undefined ? undefined : round(cpu <= 1 ? cpu * 100 : cpu),
    memoryPercent: mem === undefined ? undefined : round(mem <= 1 ? mem * 100 : mem),
  };
}

/* ================================================================== *
 * Releases → deployments
 * ================================================================== */

const RELEASE_STATES: Record<string, DeploymentState> = {
  READY: 'SUCCESS',
  SUCCESS: 'SUCCESS',
  DEPLOYED: 'SUCCESS',
  BUILDING: 'BUILDING',
  BUILD: 'BUILDING',
  DEPLOYING: 'DEPLOYING',
  RELEASING: 'DEPLOYING',
  FAILED: 'FAILED',
  ERROR: 'FAILED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
};

const RELEASE_SOURCES: Record<string, Deployment['source']> = {
  CLI: 'cli',
  GIT: 'git',
  GITHUB: 'git',
  GITLAB: 'git',
  CONSOLE: 'console',
  WEB: 'console',
  API: 'api',
};

export function toDeployment(raw: Release, appName: string, currentReleaseId?: string): Deployment {
  const id = str(raw._id) ?? 'unknown';
  const created = iso(raw.createdAt) ?? new Date(0).toISOString();
  const finished = iso(raw.finishedAt) ?? iso(raw.updatedAt);
  const state = RELEASE_STATES[String(raw.state ?? '').toUpperCase()] ?? 'DEPLOYING';

  return {
    id,
    appName,
    state,
    source: RELEASE_SOURCES[String(raw.type ?? '').toUpperCase()] ?? 'api',
    commitSha: str(raw.commitHash) ?? str(raw.gitCommit),
    commitMessage: str(raw.commitMessage),
    branch: str(raw.branch),
    createdAt: created,
    finishedAt: finished,
    durationMs:
      finished && created ? Math.max(0, Date.parse(finished) - Date.parse(created)) : undefined,
    triggeredBy: str(raw.userEmail) ?? str((raw.user as { email?: string })?.email),
    failureReason: state === 'FAILED' ? str(raw.failReason) ?? str(raw.message) : undefined,
    isCurrent: currentReleaseId !== undefined && id === currentReleaseId,
  };
}

/* ================================================================== *
 * Logs
 * ================================================================== */

/**
 * Liara does not classify log lines; it reports the stream (`stdout`/`stderr`)
 * and the text. Severity is therefore inferred, and the order matters: an
 * explicit level in the text beats the stream, because plenty of frameworks log
 * ordinary startup banners to stderr and calling those ERROR would bury the
 * real failure in a wall of red.
 */
const LEVEL_PATTERNS: Array<[LogSeverity, RegExp]> = [
  ['ERROR', /\b(error|err|fatal|panic|exception|traceback|failed|refused|EADDRINUSE|ECONNREFUSED|segfault|OOM|killed)\b/i],
  ['WARN', /\b(warn|warning|deprecat|retry|retrying|timeout|slow)\b/i],
  ['DEBUG', /\b(debug|trace|verbose)\b/i],
  ['INFO', /\b(info|listening|started|ready|serving|connected)\b/i],
];

export function toLogSeverity(line: LogLine): LogSeverity {
  const message = str(line.message) ?? '';
  for (const [severity, re] of LEVEL_PATTERNS) {
    if (re.test(message)) return severity;
  }
  return String(line.type ?? '').toLowerCase() === 'stderr' ? 'WARN' : 'INFO';
}

export function toLogLines(raw: LogLine[] | { data?: LogLine[] } | undefined): UiLogLine[] {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return rows
    .filter((r) => str(r?.message) !== undefined)
    .map((r, i) => ({
      id: `${i}`,
      timestamp: iso(r.datetime) ?? new Date(0).toISOString(),
      severity: toLogSeverity(r),
      message: String(r.message).replace(/\s+$/, ''),
      source: str(r.type),
    }));
}

/* ================================================================== *
 * Metric series
 * ================================================================== */

/**
 * The metric endpoints have been observed empty on this account, so the shape
 * is taken from the spec rather than from a live sample: a list of points, each
 * either `{ time, value }` or a Prometheus-style `[ts, "value"]` pair, possibly
 * wrapped in `{ data: { result: [{ values }] } }`. All three are unwrapped here
 * so that whichever one shows up in the demo renders instead of vanishing.
 */
function extractPoints(raw: unknown): Array<number | null> {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data)
      : Array.isArray((raw as { data?: { result?: unknown } })?.data?.result)
        ? ((raw as { data: { result: Array<{ values?: unknown[] }> } }).data.result[0]?.values ?? [])
        : [];

  return rows.map((row) => {
    if (Array.isArray(row)) return num(row[1]) ?? null;
    if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>;
      return num(r.value) ?? num(r.y) ?? num(r.usage) ?? null;
    }
    return num(row) ?? null;
  });
}

const SERIES_META: Record<UiMetricSeries['key'], { label: string; unit: string; max?: number }> = {
  cpu: { label: 'مصرف CPU', unit: '%', max: 100 },
  memory: { label: 'مصرف RAM', unit: '%', max: 100 },
  network: { label: 'ترافیک شبکه', unit: 'KB/s' },
};

export function toMetricSeries(key: UiMetricSeries['key'], raw: unknown): UiMetricSeries {
  const points = extractPoints(raw).map((p) =>
    p === null ? null : round(key === 'network' ? p / 1024 : p <= 1 ? p * 100 : p),
  );
  const last = [...points].reverse().find((p): p is number => p !== null);
  return { key, ...SERIES_META[key], points, current: last };
}

/* ================================================================== *
 * Env vars
 * ================================================================== */

/**
 * Which variables are secret is a naming convention, not API metadata. Getting
 * this wrong in the safe direction costs a click; getting it wrong the other
 * way puts a live credential on screen during a recorded demo, so the patterns
 * are deliberately broad.
 */
const SECRET_KEY = /(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|PRIVATE|SALT|SIGNATURE|AUTH|DSN|CONNECTION_STRING)/i;
const SECRET_VALUE = /^(postgres|mysql|mongodb|redis|amqp|rediss)(\+srv)?:\/\/[^:]+:[^@]+@/i;

export function isSecretEnv(key: string, value: string): boolean {
  if (/^(NODE_ENV|PORT|HOST|TZ|LANG|PATH|DEBUG|LOG_LEVEL)$/i.test(key)) return false;
  return SECRET_KEY.test(key) || SECRET_VALUE.test(value);
}

/**
 * What a secret looks like once it is safe to send to a model.
 *
 * Env values are the one place in this app where account data is genuinely
 * dangerous: `DATABASE_URL` holds a live password, and a tool result travels to
 * the model provider *and* down to the browser. Redacting the whole value would
 * be safe but useless — "the app cannot reach its database" is usually a wrong
 * host or port, and you need to see them to say so.
 *
 * So connection strings keep their structure and lose only the password, which
 * is the part that is both secret and diagnostically worthless. Everything else
 * collapses to a length, which is enough to distinguish "unset" from "set" and
 * "one key" from "a key with a stray newline" without revealing the value.
 */
export function redactEnvValue(key: string, value: string): string {
  if (!isSecretEnv(key, value)) return value;

  const url = SECRET_VALUE.exec(value);
  if (url) {
    return value.replace(/^([a-z+]+:\/\/[^:]+:)[^@]+(@)/i, '$1•••$2');
  }
  return `«مقدار مخفی، ${value.length} کاراکتر»`;
}

export function toEnvVars(raw: EnvVar[] | undefined): UiEnvVar[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => typeof e?.key === 'string')
    .map((e) => {
      const value = String(e.value ?? '');
      return { key: e.key, value, secret: isSecretEnv(e.key, value) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The before/after diff that makes a write reversible. Ordering puts what
 * changed first, because that is what the user is being asked to approve;
 * unchanged rows are context and go last.
 */
export function envDiff(previous: UiEnvVar[] | EnvVar[], next: UiEnvVar[] | EnvVar[]): DiffRow[] {
  const before = new Map(previous.map((e) => [e.key, String(e.value ?? '')]));
  const after = new Map(next.map((e) => [e.key, String(e.value ?? '')]));
  const rows: DiffRow[] = [];

  for (const [key, value] of after) {
    if (!before.has(key)) {
      rows.push({ kind: 'added', label: key, after: value });
    } else if (before.get(key) !== value) {
      rows.push({ kind: 'changed', label: key, before: before.get(key), after: value });
    }
  }
  for (const [key, value] of before) {
    if (!after.has(key)) rows.push({ kind: 'removed', label: key, before: value });
  }
  for (const [key, value] of before) {
    if (after.get(key) === value) rows.push({ kind: 'unchanged', label: key, before: value, after: value });
  }
  return rows;
}

/** A one-row diff for the scalar writes: scale, plan, release. */
export function scalarDiff(label: string, before: unknown, after: unknown): DiffRow[] {
  const b = before === undefined || before === null ? undefined : String(before);
  const a = after === undefined || after === null ? undefined : String(after);
  return [{ kind: b === a ? 'unchanged' : 'changed', label, before: b, after: a }];
}

/* ================================================================== *
 * DNS
 * ================================================================== */

const UI_DNS_TYPES = new Set<UiDnsRecordType>(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV']);

/**
 * The API stores record values as type-specific objects — `{ ip }` for A,
 * `{ host, priority }` for MX. The table shows strings, so each shape is
 * flattened to the field a human would read.
 */
function recordValues(contents: Array<Record<string, unknown>> | undefined): string[] {
  if (!Array.isArray(contents)) return [];
  return contents
    .map((c) => {
      if (!c || typeof c !== 'object') return String(c ?? '');
      return (
        str(c.ip) ?? str(c.host) ?? str(c.text) ?? str(c.value) ?? str(c.target) ?? JSON.stringify(c)
      );
    })
    .filter(Boolean);
}

export function toDnsRecord(raw: DnsRecord | (Partial<DnsRecord> & { _id?: string })): UiDnsRecord {
  const type = String(raw.type ?? 'A').toUpperCase();
  const priority = Array.isArray(raw.contents)
    ? num((raw.contents[0] as { priority?: unknown })?.priority)
    : undefined;

  return {
    id: str(raw.id) ?? str((raw as { _id?: string })._id) ?? `${raw.name}-${type}`,
    // ALIAS/SPF/PTR/CAA exist upstream but the table has no column semantics
    // for them; TXT is the closest honest rendering of "a string value".
    type: UI_DNS_TYPES.has(type as UiDnsRecordType) ? (type as UiDnsRecordType) : 'TXT',
    name: str(raw.name) ?? '@',
    values: recordValues(raw.contents),
    ttl: num(raw.ttl) ?? 3600,
    priority,
  };
}

/* ================================================================== *
 * Sources
 * ================================================================== */

/** A docs hit becomes a citable source. `score` is normalised for the UI bar. */
export function docSource(
  hit: { id: string; title: string; url: string; section?: string; text: string; score: number },
  topScore: number,
): Source {
  return {
    id: hit.id,
    kind: 'docs',
    title: hit.section && hit.section !== hit.title ? `${hit.title} — ${hit.section}` : hit.title,
    url: hit.url,
    snippet: hit.text.slice(0, 320),
    score: topScore > 0 ? round(Math.min(1, hit.score / topScore), 2) : undefined,
  };
}

/** An observation about the account. `origin` is the endpoint it came from. */
export function accountSource(id: string, title: string, origin: string, snippet: string): Source {
  return { id, kind: 'account', title, origin, snippet: snippet.slice(0, 320) };
}
