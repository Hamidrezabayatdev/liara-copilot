/**
 * The complete agent tool surface.
 *
 * Liara credentials are injected once, through `createLiaraTools`, and captured
 * by server-only execute closures. They are never part of an input schema,
 * output, probe, or tool metadata. There is deliberately no generic HTTP tool.
 *
 * AI SDK v7 note: tools use `inputSchema` (not `parameters`). `askUser` omits
 * `execute`, which makes it a client tool; its required `outputSchema` describes
 * the result the client will send back when the user answers.
 */

import { createHmac } from 'node:crypto';

import { tool, type InferToolInput, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';

import {
  DNS_RECORD_TYPES,
  DNS_TTLS,
  createDnsRecord as createDnsRecordApi,
  getApp as getAppApi,
  getAppEvents as getAppEventsApi,
  getAppLogs as getAppLogsApi,
  getAppMetrics as getAppMetricsApi,
  getAppReleases as getAppReleasesApi,
  getDatabase as getDatabaseApi,
  listAppEnvs,
  listApps as listAppsApi,
  listBuckets as listBucketsApi,
  listDatabases as listDatabasesApi,
  listDnsRecords as listDnsRecordsApi,
  listPlans as listPlansApi,
  resizeApp as resizeAppApi,
  restartApp as restartAppApi,
  rollbackRelease as rollbackReleaseApi,
  scaleApp as scaleAppApi,
  setAppEnvs,
  type DnsRecord,
  type DnsRecordInput,
  type EnvVar,
  type LiaraCtx,
  type OpKind,
  type Product,
} from '../liara/index';
import { searchDocs as searchDocsIndex } from '../retrieval/index';
import type { UsageCollector } from './provider';
import {
  docSource,
  envDiff,
  isSecretEnv,
  redactEnvValue,
  scalarDiff,
  toApp,
  toDatabaseApp,
  toDeployment,
  toDnsRecord,
  toEnvVars,
  toLogLines,
  toMetricSnapshot,
} from './projections';

/* ================================================================== *
 * Trust metadata consumed by approval.ts
 * ================================================================== */

export type LiaraToolProbe = {
  scope: 'liara';
  product: Product;
  method: string;
  path: string;
};

export type ToolProbe =
  | LiaraToolProbe
  | { scope: 'local'; operation: 'searchDocs' }
  | { scope: 'client'; operation: 'askUser' };

/** Structural on purpose: approval.ts can audit any registry without coupling. */
export type TrustedToolMetadata<INPUT = unknown> = {
  kind: OpKind;
  probe: (input: INPUT) => ToolProbe;
};

export type TrustedTool<INPUT = unknown, OUTPUT = unknown> = Tool<INPUT, OUTPUT> &
  TrustedToolMetadata<INPUT>;

function trusted<T extends Tool>(
  definition: T,
  kind: OpKind,
  probe: (input: InferToolInput<T>) => ToolProbe,
): T & TrustedToolMetadata<InferToolInput<T>> {
  // `tool()` returns the definition object. Metadata stays server-side: unlike
  // AI SDK's provider metadata it is not sent to the model.
  return Object.assign(definition, { kind, probe });
}

const liaraProbe = (
  product: Product,
  method: 'GET' | 'POST',
  path: string,
): LiaraToolProbe => ({ scope: 'liara', product, method, path });

/* ================================================================== *
 * Schemas
 * ================================================================== */

const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const RELEASE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const ZONE_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_KEY_PART = /(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|PRIVATE|SALT|SIGNATURE|AUTH|DSN|CONNECTION_STRING)/i;

const appNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(APP_NAME_RE)
  .describe('Liara app name, for example digishop-api');

const databaseIdSchema = z
  .string()
  .regex(OBJECT_ID_RE)
  .describe('24-character Liara database id');

const zoneSchema = z
  .string()
  .regex(ZONE_RE)
  .describe('DNS zone name, for example example.com');

const releaseIdSchema = z.string().regex(RELEASE_ID_RE).describe('Release id returned by getAppReleases');

const publicEnvKeySchema = z
  .string()
  .regex(ENV_KEY_RE)
  .refine((key) => !SECRET_KEY_PART.test(key), 'secret-like env keys are not accepted by this tool')
  .describe('A non-secret environment variable name such as PORT or LOG_LEVEL');

const publicEnvValueSchema = z
  .string()
  .max(8_192)
  .refine(
    (value) => !/^(?:postgres|mysql|mongodb|redis|amqp|rediss)(?:\+srv)?:\/\/[^:]+:[^@]+@/i.test(value),
    'credential-bearing connection strings are not accepted by this tool',
  )
  .describe('A non-secret value; never put passwords, tokens, keys, or credential URLs here');

const envChangeSchema = z.object({
  key: publicEnvKeySchema,
  value: publicEnvValueSchema,
  expectedCurrentValue: publicEnvValueSchema
    .nullable()
    .describe('Current non-secret value from listEnvVars, or null when the key is absent'),
});

const dnsContentSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

/* ================================================================== *
 * Safe compact result helpers
 * ================================================================== */

type Failure = { ok: false; error: string; status?: number };

function scrubText(value: string, token: string): string {
  let out = token.length > 0 ? value.split(token).join('***') : value;
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***');
  out = out.replace(
    /\b((?:postgres|mysql|mongodb|redis|amqp|rediss)(?:\+srv)?:\/\/[^:\s]+:)[^@\s]+(@)/gi,
    '$1•••$2',
  );
  return out.replace(
    /\b(password|passwd|token|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
    '$1=•••',
  );
}

function failure(result: { ok: false; error: string; status?: number }, token: string): Failure {
  const safe: Failure = { ok: false, error: scrubText(String(result.error), token) };
  if (typeof result.status === 'number') safe.status = result.status;
  return safe;
}

function rejected(error: string): Failure {
  return { ok: false, error };
}

function accountResult<T>(data: T): { ok: true; data: T; source: 'account' } {
  return { ok: true, data, source: 'account' };
}

function scrubValue(value: unknown, token: string): unknown {
  if (typeof value === 'string') return scrubText(value, token);
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, token));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scrubValue(entry, token)]),
    );
  }
  return value;
}

function safeEnvVars(raw: EnvVar[] | undefined) {
  return toEnvVars(raw).map((entry) => ({
    ...entry,
    value: redactEnvValue(entry.key, entry.value),
  }));
}

/**
 * An opaque, account-bound concurrency token. HMAC (rather than a plain hash)
 * prevents an observer from guessing a short secret value from the revision.
 */
function envRevision(raw: EnvVar[], token: string): string {
  const canonical = [...raw]
    .map(({ key, value }) => ({ key, value: String(value ?? '') }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return createHmac('sha256', token).update(JSON.stringify(canonical)).digest('hex');
}

function compactEvents(raw: { data?: unknown[] } | undefined, token: string) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  return rows.slice(0, 100).map((value, index) => {
    const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const text = (key: string): string | undefined =>
      typeof row[key] === 'string' && row[key] ? scrubText(row[key], token) : undefined;
    return {
      id: text('_id') ?? text('id') ?? String(index),
      type: text('type') ?? text('event') ?? 'event',
      message: text('message') ?? text('description'),
      createdAt: text('createdAt') ?? text('created_at') ?? text('datetime'),
    };
  });
}

function compactBuckets(raw: { buckets?: unknown[]; data?: unknown[] } | undefined) {
  const rows = Array.isArray(raw?.buckets) ? raw.buckets : Array.isArray(raw?.data) ? raw.data : [];
  return rows.slice(0, 100).map((value) => {
    const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return {
      id: typeof row._id === 'string' ? row._id : undefined,
      name: typeof row.name === 'string' ? row.name : 'unknown',
      permission: typeof row.permission === 'string' ? row.permission : undefined,
      plan: typeof row.plan === 'string' ? row.plan : undefined,
      createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    };
  });
}

function dnsRows(raw: { data?: DnsRecord[] } | undefined): DnsRecord[] {
  return Array.isArray(raw?.data) ? raw.data : [];
}

/* ================================================================== *
 * Factory
 * ================================================================== */

export const TOOL_NAMES = [
  'searchDocs',
  'listApps',
  'getApp',
  'getAppLogs',
  'getAppEvents',
  'getAppReleases',
  'getAppMetrics',
  'listEnvVars',
  'listDatabases',
  'getDatabase',
  'listBuckets',
  'listDnsRecords',
  'getPlans',
  'setEnvVars',
  'restartApp',
  'scaleApp',
  'resizeApp',
  'rollbackRelease',
  'createDnsRecord',
  'askUser',
] as const;

export type LiaraToolName = (typeof TOOL_NAMES)[number];

/**
 * Build one request/account-scoped registry. Do not cache this globally: doing
 * so could retain one user's token and use it for another user's request.
 */
export function createLiaraTools(
  inputCtx: Readonly<LiaraCtx>,
  options?: { collector?: UsageCollector },
) {
  const token = typeof inputCtx?.token === 'string' ? inputCtx.token.trim() : '';
  if (!token) throw new TypeError('createLiaraTools requires a Liara server context');

  // Copy only the two known context fields. Never retain a caller-owned object
  // that could be mutated while parallel tools are executing.
  const teamId = typeof inputCtx.teamId === 'string' ? inputCtx.teamId.trim() : '';
  const ctx: Readonly<LiaraCtx> = Object.freeze(teamId ? { token, teamId } : { token });
  const accountData = <T>(data: T) => accountResult(scrubValue(data, token) as T);

  const tools = {
    searchDocs: trusted(
      tool({
        description: 'Search the bundled official Liara documentation. Use returned source URLs as citations.',
        inputSchema: z.object({
          query: z.string().min(2).max(500).describe('The user question or focused search phrase'),
          limit: z.number().int().min(1).max(6).optional().describe('Number of diverse sources, default 5'),
        }),
        execute: async ({ query, limit }) => {
          const result = await searchDocsIndex(query, {
            limit: limit ?? 5,
            collector: options?.collector,
          });
          const topScore = result.hits[0]?.score ?? 0;
          return {
            ok: true as const,
            data: {
              sources: result.hits.map((hit) => docSource(hit, topScore)),
              strategy: result.strategy,
              keywordConfidence: result.keywordConfidence,
            },
            source: 'docs' as const,
          };
        },
      }),
      'read',
      () => ({ scope: 'local', operation: 'searchDocs' }),
    ),

    listApps: trusted(
      tool({
        description: 'List Liara PaaS apps in the current account using compact UI-safe fields.',
        inputSchema: z.object({}),
        execute: async () => {
          const result = await listAppsApi(ctx);
          if (!result.ok) return failure(result, token);
          const rows = Array.isArray(result.data?.projects) ? result.data.projects : [];
          return accountData({ apps: rows.map((row) => toApp(row)) });
        },
      }),
      'read',
      () => liaraProbe('paas', 'GET', '/v1/projects'),
    ),

    getApp: trusted(
      tool({
        description: 'Get one Liara PaaS app and project it to compact application-card fields.',
        inputSchema: z.object({ appName: appNameSchema }),
        execute: async ({ appName }) => {
          const result = await getAppApi(ctx, appName);
          if (!result.ok) return failure(result, token);
          return accountData({ app: toApp(result.data.project) });
        },
      }),
      'read',
      ({ appName }) => liaraProbe('paas', 'GET', `/v1/projects/${appName}`),
    ),

    getAppLogs: trusted(
      tool({
        description: 'Read recent app logs. Start with a short window and stop once the failure is clear.',
        inputSchema: z.object({
          appName: appNameSchema,
          sinceMinutes: z.number().int().min(1).max(1_440).optional().describe('Lookback window, default 60'),
        }),
        execute: async ({ appName, sinceMinutes }) => {
          const result = await getAppLogsApi(ctx, appName, { sinceMinutes });
          if (!result.ok) return failure(result, token);
          const logs = toLogLines(result.data)
            .slice(-300)
            .map((line) => ({ ...line, message: scrubText(line.message, token) }));
          return accountData({ appName, logs });
        },
      }),
      'read',
      ({ appName }) => liaraProbe('paas', 'GET', `/v1/projects/${appName}/logs`),
    ),

    getAppEvents: trusted(
      tool({
        description: 'Read recent operational events for one app.',
        inputSchema: z.object({
          appName: appNameSchema,
          search: z.string().max(120).optional(),
          start: z.number().int().nonnegative().optional().describe('Optional unix start timestamp'),
          end: z.number().int().nonnegative().optional().describe('Optional unix end timestamp'),
        }),
        execute: async ({ appName, search, start, end }) => {
          const result = await getAppEventsApi(ctx, appName, { search, start, end });
          if (!result.ok) return failure(result, token);
          return accountData({ appName, events: compactEvents(result.data, token) });
        },
      }),
      'read',
      ({ appName }) => liaraProbe('paas', 'GET', `/v1/projects/${appName}/events`),
    ),

    getAppReleases: trusted(
      tool({
        description: 'List recent deployments/releases for an app, newest first.',
        inputSchema: z.object({
          appName: appNameSchema,
          page: z.number().int().min(1).max(100).optional(),
          count: z.number().int().min(1).max(50).optional().describe('Default 10'),
        }),
        execute: async ({ appName, page, count }) => {
          const result = await getAppReleasesApi(ctx, appName, { page, count });
          if (!result.ok) return failure(result, token);
          const releases = Array.isArray(result.data?.releases) ? result.data.releases : [];
          return accountData({
            appName,
            currentRelease: result.data.currentRelease,
            total: result.data.total ?? releases.length,
            releases: releases.map((release) =>
              toDeployment(release, appName, result.data.currentRelease),
            ),
          });
        },
      }),
      'read',
      ({ appName }) => liaraProbe('paas', 'GET', `/v1/projects/${appName}/releases`),
    ),

    getAppMetrics: trusted(
      tool({
        description: 'Get the current compact CPU and memory snapshot for an app.',
        inputSchema: z.object({ appName: appNameSchema }),
        execute: async ({ appName }) => {
          const result = await getAppMetricsApi(ctx, appName);
          if (!result.ok) return failure(result, token);
          return accountData({ appName, metrics: toMetricSnapshot(result.data) });
        },
      }),
      'read',
      ({ appName }) => liaraProbe('paas', 'GET', `/v1/projects/${appName}/metrics/summary`),
    ),

    listEnvVars: trusted(
      tool({
        description: 'List app environment variables. Secret values are irreversibly redacted before this result leaves the server.',
        inputSchema: z.object({ appName: appNameSchema }),
        execute: async ({ appName }) => {
          const result = await listAppEnvs(ctx, appName);
          if (!result.ok) return failure(result, token);
          const raw = result.data.envs;
          return accountData({
            appName,
            envs: safeEnvVars(raw),
            revision: envRevision(raw, token),
          });
        },
      }),
      'read',
      ({ appName }) => liaraProbe('paas', 'GET', `/v1/projects/${appName}`),
    ),

    listDatabases: trusted(
      tool({
        description: 'List managed Liara databases using compact application-card fields.',
        inputSchema: z.object({}),
        execute: async () => {
          const result = await listDatabasesApi(ctx);
          if (!result.ok) return failure(result, token);
          const rows = Array.isArray(result.data?.databases) ? result.data.databases : [];
          return accountData({ databases: rows.map((row) => toDatabaseApp(row)) });
        },
      }),
      'read',
      () => liaraProbe('dbaas', 'GET', '/v1/databases'),
    ),

    getDatabase: trusted(
      tool({
        description: 'Get one managed database by its 24-character id.',
        inputSchema: z.object({ databaseId: databaseIdSchema }),
        execute: async ({ databaseId }) => {
          const result = await getDatabaseApi(ctx, databaseId);
          if (!result.ok) return failure(result, token);
          return accountData({ database: toDatabaseApp(result.data.database) });
        },
      }),
      'read',
      ({ databaseId }) => liaraProbe('dbaas', 'GET', `/v1/databases/${databaseId}`),
    ),

    listBuckets: trusted(
      tool({
        description: 'List object-storage buckets. Access keys and object bodies are never exposed.',
        inputSchema: z.object({}),
        execute: async () => {
          const result = await listBucketsApi(ctx);
          if (!result.ok) return failure(result, token);
          return accountData({ buckets: compactBuckets(result.data) });
        },
      }),
      'read',
      () => liaraProbe('storage', 'GET', '/api/v1/buckets'),
    ),

    listDnsRecords: trusted(
      tool({
        description: 'List records in one Liara DNS zone.',
        inputSchema: z.object({ zone: zoneSchema }),
        execute: async ({ zone }) => {
          const result = await listDnsRecordsApi(ctx, zone);
          if (!result.ok) return failure(result, token);
          return accountData({ zone, records: dnsRows(result.data).map((row) => toDnsRecord(row)) });
        },
      }),
      'read',
      ({ zone }) => liaraProbe('dns', 'GET', `/api/v1/zones/${zone}/dns-records`),
    ),

    getPlans: trusted(
      tool({
        description: 'Read the live account plan catalog and prices in Toman. Never hardcode plan availability.',
        inputSchema: z.object({
          kind: z.enum(['projects', 'databases']).optional().describe('Default projects'),
          region: z.string().max(40).optional(),
          onlyAvailable: z.boolean().optional().describe('Default true'),
        }),
        execute: async ({ kind, region, onlyAvailable }) => {
          const result = await listPlansApi(ctx, kind ?? 'projects', { region, onlyAvailable });
          if (!result.ok) return failure(result, token);
          return accountData({ kind: kind ?? 'projects', plans: result.data });
        },
      }),
      'read',
      () => liaraProbe('paas', 'GET', '/v1/me'),
    ),

    setEnvVars: trusted(
      tool({
        description:
          'Merge non-secret environment variables after listEnvVars. Provide its exact revision and each safe Before value. This tool refuses secret-like keys and values; use the Liara console for secrets.',
        inputSchema: z.object({
          appName: appNameSchema,
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).describe('Opaque revision from the latest listEnvVars result'),
          changes: z.array(envChangeSchema).min(1).max(30),
        }),
        execute: async ({ appName, expectedRevision, changes }) => {
          const keys = new Set<string>();
          for (const change of changes) {
            if (keys.has(change.key)) return rejected(`duplicate env var ${change.key}`);
            keys.add(change.key);
            if (isSecretEnv(change.key, change.value)) {
              return rejected('setEnvVars accepts non-secret values only; set secrets in the Liara console');
            }
            if (
              change.expectedCurrentValue !== null &&
              isSecretEnv(change.key, change.expectedCurrentValue)
            ) {
              return rejected('setEnvVars accepts non-secret current values only; set secrets in the Liara console');
            }
          }

          const current = await listAppEnvs(ctx, appName);
          if (!current.ok) return failure(current, token);
          if (envRevision(current.data.envs, token) !== expectedRevision) {
            return rejected('environment variables changed since preview; run listEnvVars again before retrying');
          }

          const byKey = new Map(current.data.envs.map((entry) => [entry.key, entry.value]));
          for (const change of changes) {
            const actual = byKey.has(change.key) ? byKey.get(change.key)! : null;
            if (actual !== change.expectedCurrentValue) {
              return rejected(`environment variable ${change.key} changed since preview; run listEnvVars again`);
            }
          }

          const result = await setAppEnvs(
            ctx,
            appName,
            changes.map(({ key, value }) => ({ key, value })),
            { mode: 'merge' },
          );
          if (!result.ok) return failure(result, token);

          const previous = safeEnvVars(result.data.previous);
          const applied = safeEnvVars(result.data.applied);
          return accountData({
            appName,
            mode: 'merge' as const,
            envs: applied,
            diff: envDiff(previous, applied),
            revision: envRevision(result.data.applied, token),
          });
        },
      }),
      'reversible-write',
      () => liaraProbe('paas', 'POST', '/v1/projects/update-envs'),
    ),

    restartApp: trusted(
      tool({
        description: 'Restart an app after getApp. The expected state is re-checked immediately before mutation.',
        inputSchema: z.object({
          appName: appNameSchema,
          expectedCurrentStatus: z.enum(['ACTIVE', 'STOPPED', 'BUILDING', 'UNHEALTHY']),
          expectedCurrentScale: z.number().int().min(0).max(10),
        }),
        execute: async ({ appName, expectedCurrentStatus, expectedCurrentScale }) => {
          const current = await getAppApi(ctx, appName);
          if (!current.ok) return failure(current, token);
          const app = toApp(current.data.project);
          if (app.status !== expectedCurrentStatus || app.scale !== expectedCurrentScale) {
            return rejected('app state changed since preview; run getApp again before retrying');
          }
          const result = await restartAppApi(ctx, appName);
          if (!result.ok) return failure(result, token);
          return accountData({ appName, operation: 'restart' as const, accepted: true });
        },
      }),
      'reversible-write',
      ({ appName }) => liaraProbe('paas', 'POST', `/v1/projects/${appName}/actions/restart`),
    ),

    scaleApp: trusted(
      tool({
        description: 'Scale an app to 0..10 instances after getApp. Requires the exact current scale for a safe Before/After approval.',
        inputSchema: z.object({
          appName: appNameSchema,
          scale: z.number().int().min(0).max(10),
          expectedCurrentScale: z.number().int().min(0).max(10),
        }),
        execute: async ({ appName, scale, expectedCurrentScale }) => {
          const current = await getAppApi(ctx, appName);
          if (!current.ok) return failure(current, token);
          const actual = toApp(current.data.project).scale;
          if (actual !== expectedCurrentScale) {
            return rejected('app scale changed since preview; run getApp again before retrying');
          }
          const result = await scaleAppApi(ctx, appName, scale);
          if (!result.ok) return failure(result, token);
          return accountData({
            appName,
            scale: result.data.scale,
            diff: scalarDiff('scale', result.data.previousScale, result.data.scale),
          });
        },
      }),
      'reversible-write',
      ({ appName }) => liaraProbe('paas', 'POST', `/v1/projects/${appName}/actions/scale`),
    ),

    resizeApp: trusted(
      tool({
        description: 'Change an app compute plan after getApp/getPlans. Requires the exact current plan id for approval and stale-state protection.',
        inputSchema: z.object({
          appName: appNameSchema,
          planId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
          expectedCurrentPlanId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
        }),
        execute: async ({ appName, planId, expectedCurrentPlanId }) => {
          const current = await getAppApi(ctx, appName);
          if (!current.ok) return failure(current, token);
          const actual = toApp(current.data.project).planId;
          if (actual !== expectedCurrentPlanId) {
            return rejected('app plan changed since preview; run getApp again before retrying');
          }
          const result = await resizeAppApi(ctx, appName, planId);
          if (!result.ok) return failure(result, token);
          return accountData({
            appName,
            planId: result.data.planID,
            warning: result.data.warning,
            diff: scalarDiff('plan', result.data.previousPlanID, result.data.planID),
          });
        },
      }),
      'reversible-write',
      ({ appName }) => liaraProbe('paas', 'POST', `/v1/projects/${appName}/resize`),
    ),

    rollbackRelease: trusted(
      tool({
        description: 'Redeploy an earlier release after getAppReleases. Requires the current release id for a safe Before/After approval.',
        inputSchema: z.object({
          appName: appNameSchema,
          releaseId: releaseIdSchema,
          expectedCurrentReleaseId: releaseIdSchema.nullable(),
        }),
        execute: async ({ appName, releaseId, expectedCurrentReleaseId }) => {
          const current = await getAppReleasesApi(ctx, appName, { count: 100 });
          if (!current.ok) return failure(current, token);
          const actual = current.data.currentRelease ?? null;
          if (actual !== expectedCurrentReleaseId) {
            return rejected('current release changed since preview; run getAppReleases again before retrying');
          }
          const result = await rollbackReleaseApi(ctx, appName, releaseId);
          if (!result.ok) return failure(result, token);
          return accountData({
            appName,
            releaseId: result.data.releaseID,
            diff: scalarDiff('release', result.data.previousRelease, result.data.rolledBackTo),
          });
        },
      }),
      'reversible-write',
      ({ appName }) => liaraProbe('paas', 'POST', `/v2/projects/${appName}/releases`),
    ),

    createDnsRecord: trusted(
      tool({
        description:
          'Create a new DNS record only after listDnsRecords confirms no same-name/type record exists. Rollback is manual deletion in the Liara console; this tool never exposes DELETE.',
        inputSchema: z.object({
          zone: zoneSchema,
          expectedAbsent: z.literal(true).describe('Confirms the latest listDnsRecords result had no same-name/type record'),
          record: z.object({
            name: z.string().min(1).max(253),
            type: z.enum(DNS_RECORD_TYPES),
            ttl: z.number().int().refine((ttl) => (DNS_TTLS as readonly number[]).includes(ttl)).optional(),
            contents: z.array(dnsContentSchema).min(1).max(20),
          }),
        }),
        execute: async ({ zone, record }) => {
          // The client helper re-reads the current records immediately before
          // POST and refuses a collision, closing the approval-to-execute gap.
          const result = await createDnsRecordApi(ctx, zone, record as DnsRecordInput);
          if (!result.ok) return failure(result, token);
          const projected = toDnsRecord(result.data.created);
          return accountData({
            zone,
            record: projected,
            diff: scalarDiff(`${projected.name} ${projected.type}`, 'absent', 'created'),
            rollback: 'manual-console-delete' as const,
          });
        },
      }),
      'reversible-write',
      ({ zone }) => liaraProbe('dns', 'POST', `/api/v1/zones/${zone}/dns-records`),
    ),

    askUser: trusted(
      tool({
        description: 'Ask one concise clarifying question when missing information would materially change the answer or action.',
        inputSchema: z.object({
          question: z.string().min(2).max(300),
          reason: z.string().max(300).optional(),
          options: z
            .array(
              z.object({
                id: z.string().min(1).max(40),
                label: z.string().min(1).max(120),
                detail: z.string().max(240).optional(),
                target: z.string().max(120).optional(),
                recommended: z.boolean().optional(),
              }),
            )
            .min(2)
            .max(4),
          allowFreeText: z.boolean().optional(),
        }),
        outputSchema: z.object({
          optionId: z.string().optional(),
          text: z.string().optional(),
        }),
      }),
      'read',
      () => ({ scope: 'client', operation: 'askUser' }),
    ),
  } satisfies ToolSet & Record<LiaraToolName, TrustedToolMetadata<never>>;

  return tools;
}

export type LiaraTools = ReturnType<typeof createLiaraTools>;
