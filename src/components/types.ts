/**
 * Shared data shapes for the Liara Copilot UI kit.
 *
 * These mirror what the agent's tools return (Liara PaaS / DBaaS / DNS APIs and
 * the Liara AI usage block). Components are purely presentational: they accept
 * these shapes as props and emit callbacks — no fetching, no AI SDK.
 */

/** Lifecycle of a PaaS application, as reported by `GET /v1/projects`. */
export type AppStatus = "ACTIVE" | "STOPPED" | "BUILDING" | "UNHEALTHY";

/** Liara platform slug (`platform` field on a project). */
export type AppPlatform =
  | "node"
  | "next"
  | "static"
  | "react"
  | "laravel"
  | "django"
  | "flask"
  | "php"
  | "docker"
  | "postgres"
  | "mysql"
  | "mongodb"
  | "redis";

export interface AppMetricSnapshot {
  /** Percentage 0–100. */
  cpuPercent?: number;
  /** Percentage 0–100 of the plan's memory. */
  memoryPercent?: number;
  /** Bytes of memory in use. */
  memoryBytes?: number;
  /** Requests per minute over the last window. */
  requestsPerMinute?: number;
  /** Share of 5xx responses, 0–100. */
  errorRatePercent?: number;
}

export interface LiaraApp {
  id: string;
  name: string;
  platform: AppPlatform;
  status: AppStatus;
  /** Plan id such as `small-g2`. */
  planId: string;
  /** Human-readable plan resources, e.g. `0.5 GB RAM · 0.5 CPU · 5 GB disk`. */
  planSummary?: string;
  /** Instance count. `0` means scaled down. */
  scale: number;
  region: string;
  /** Default `*.iran.liara.run` host, without protocol. */
  subdomain?: string;
  /** Custom domains bound to the app. */
  domains?: string[];
  createdAt: string;
  /** ISO timestamp of the most recent successful deploy. */
  lastDeployedAt?: string;
  /** Postgres/MySQL version for database resources. */
  version?: string;
  /** Private network name the app is attached to. */
  network?: string;
  metrics?: AppMetricSnapshot;
  /** Short Persian note explaining an abnormal state. */
  note?: string;
}

export type DeploymentState =
  | "SUCCESS"
  | "BUILDING"
  | "DEPLOYING"
  | "FAILED"
  | "CANCELLED";

export interface Deployment {
  id: string;
  appName: string;
  state: DeploymentState;
  /** `cli` | `git` | `console` | `api` */
  source: "cli" | "git" | "console" | "api";
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
  createdAt: string;
  finishedAt?: string;
  /** Build+release duration in milliseconds. */
  durationMs?: number;
  triggeredBy?: string;
  /** Set when `state === "FAILED"`. */
  failureReason?: string;
  /** True when this release is what is currently serving traffic. */
  isCurrent?: boolean;
}

export type LogSeverity = "ERROR" | "WARN" | "INFO" | "DEBUG";

export interface LogLine {
  /** Stable key; line number is fine. */
  id: string;
  timestamp: string;
  severity: LogSeverity;
  message: string;
  /** Container / replica the line came from. */
  source?: string;
}

export interface MetricSeries {
  key: "cpu" | "memory" | "network";
  label: string;
  /** Ordered samples; `null` marks a gap in collection. */
  points: Array<number | null>;
  unit: string;
  /** Upper bound for the y axis; inferred from data when omitted. */
  max?: number;
  /** Latest value, shown large. `undefined` when the last sample is missing. */
  current?: number;
}

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS" | "SRV";

export interface DnsRecord {
  id: string;
  type: DnsRecordType;
  /** `@` for apex. */
  name: string;
  values: string[];
  ttl: number;
  /** Priority for MX/SRV records. */
  priority?: number;
  /** True when Liara created it automatically. */
  managed?: boolean;
}

export interface EnvVar {
  key: string;
  value: string;
  /** Treated as a secret: masked until the user reveals it. */
  secret?: boolean;
}

export type DiffKind = "added" | "removed" | "unchanged" | "changed";

export interface DiffRow {
  kind: DiffKind;
  label: string;
  before?: string;
  after?: string;
}

/** The three grounding kinds the product must visibly distinguish (spec §14). */
export type Provenance = "docs" | "account" | "inference";

export interface Source {
  id: string;
  kind: Provenance;
  title: string;
  /** Only present for `docs`; always a `docs.liara.ir` URL. */
  url?: string;
  snippet: string;
  /** e.g. `GET /v1/projects` for account observations. */
  origin?: string;
  /** Retrieval score, 0–1, when the source came from the docs index. */
  score?: number;
}

export interface Evidence {
  id: string;
  text: string;
  /** Id of a `Source` in the same message. */
  sourceId?: string;
  sourceKind?: Provenance;
}

export type StepState = "done" | "running" | "pending" | "failed" | "skipped";

export interface ChecklistStep {
  id: string;
  label: string;
  state: StepState;
  /** One-line result shown under the label, e.g. `502 از 5 replica`. */
  detail?: string;
  /** Tool this step used, shown as a monospace chip. */
  tool?: string;
  durationMs?: number;
}

/** Per-message accounting, sourced from Liara AI's `usage` block. */
export interface UsageMeta {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** `usage.total_cost_toman` — read, never estimated. */
  toman: number;
  toolCalls: number;
  latencyMs: number;
  /** 1 = direct answer, 2 = retrieval/inspect, 3 = full agentic reasoning. */
  escalation: 1 | 2 | 3;
  /** Persian explanation of the routing decision, shown in the popover. */
  routingReason?: string;
}
