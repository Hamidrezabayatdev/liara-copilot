/**
 * Layer 1 of the security model — capability narrowing.
 *
 * A tool the model was never told about cannot be argued into being called. This
 * runs *before* toolApproval (layer 2) and the HTTP allow-list (layer 3): those
 * two assume a tool call already exists, this one decides whether it ever gets
 * the chance to. It is also the cheapest of the three layers — fewer tool
 * schemas in the request body means fewer input tokens on every single turn,
 * not just the ones that end up calling a write.
 *
 * The mapping is deliberately monotonic — level 3 gets everything level 2 has,
 * plus writes — because a level is a ceiling on what a turn is trusted to do,
 * not a partition of unrelated capabilities.
 */

import type { Level } from './router';

/** A tool's minimum required level. Declared once, read by both sides. */
export type MinLevel = 1 | 2 | 3;

export const TOOL_MIN_LEVEL = {
  // Level 1 — informational. Safe for the cheapest, least-supervised turns.
  searchDocs: 1,

  // Level 2 — inspect. Read-only account observations.
  listApps: 2,
  getApp: 2,
  getAppLogs: 2,
  getAppEvents: 2,
  getAppReleases: 2,
  getAppMetrics: 2,
  listEnvVars: 2,
  listDatabases: 2,
  getDatabase: 2,
  listBuckets: 2,
  listDnsRecords: 2,
  getPlans: 2,

  // Level 3 presentation — turns inspected evidence into a reliable verdict
  // card. It has no external side effect and cannot apply its proposed fix.
  reportDiagnosis: 3,

  // Level 3 — action. Every one of these is a reversible write behind a
  // confirmation (see approval.ts); none is reachable below level 3 regardless
  // of what the model asks for.
  setEnvVars: 3,
  restartApp: 3,
  scaleApp: 3,
  resizeApp: 3,
  rollbackRelease: 3,
  createDnsRecord: 3,

  // Meta — no execute(); the client fulfils it. Available whenever the agent
  // can run at all, because asking a clarifying question is never the risky part.
  askUser: 1,
} as const satisfies Record<string, MinLevel>;

export type ToolName = keyof typeof TOOL_MIN_LEVEL;

const ALL_TOOL_NAMES = Object.keys(TOOL_MIN_LEVEL) as ToolName[];

/**
 * The tool names active at a given level, in the AI SDK's `activeTools` shape.
 * Cached per level since the input set never changes at runtime — there are
 * only three possible arrays and no reason to rebuild one on every step.
 */
const ACTIVE_BY_LEVEL: Record<Level, readonly ToolName[]> = {
  1: ALL_TOOL_NAMES.filter((t) => TOOL_MIN_LEVEL[t] <= 1),
  2: ALL_TOOL_NAMES.filter((t) => TOOL_MIN_LEVEL[t] <= 2),
  3: ALL_TOOL_NAMES.filter((t) => TOOL_MIN_LEVEL[t] <= 3),
};

const ALWAYS_AVAILABLE = new Set<ToolName>([
  'searchDocs',
  'reportDiagnosis',
  'askUser',
]);

/** Tool families mirror the nouns users naturally put in a request. */
const TOOL_FAMILIES = {
  app: new Set<ToolName>([
    'listApps',
    'getApp',
    'getAppLogs',
    'getAppEvents',
    'getAppReleases',
    'getAppMetrics',
    'listEnvVars',
    'getPlans',
    'setEnvVars',
    'restartApp',
    'scaleApp',
    'resizeApp',
    'rollbackRelease',
  ]),
  database: new Set<ToolName>(['listDatabases', 'getDatabase', 'getPlans']),
  bucket: new Set<ToolName>(['listBuckets']),
  dns: new Set<ToolName>(['listDnsRecords', 'createDnsRecord']),
  plans: new Set<ToolName>(['getPlans']),
} as const;

const FAMILY_SIGNALS: Record<keyof typeof TOOL_FAMILIES, readonly string[]> = {
  app: [
    'اپ', 'برنامه', 'پروژه', 'paas', 'app', 'project', 'لاگ', 'log', 'ریلیز', 'release',
    'دیپلوی', 'deploy', 'ری استارت', 'ریستارت', 'restart', 'اسکیل', 'scale', 'replica',
    'متغیر محیطی', 'env', 'environment', 'cpu', 'ram', 'متریک', 'metric',
  ],
  database: [
    'دیتابیس', 'پایگاه داده', 'database', 'postgres', 'mysql', 'mongo', 'redis',
    'mariadb', 'sql server',
  ],
  bucket: ['باکت', 'ذخیره سازی ابری', 'object storage', 'bucket', 's3'],
  dns: ['dns', 'دامنه', 'domain', 'رکورد', 'record', 'cname', 'nameserver'],
  plans: ['پلن', 'plan', 'تعرفه', 'قیمت', 'price'],
};

const ARCHITECTURE_SIGNALS = [
  'معماری',
  'architecture',
  'workload',
  'طراحی زیرساخت',
  'پیشنهاد زیرساخت',
] as const;

function normalizeIntent(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u200c/g, ' ')
    .replace(/\u064a/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/\s+/g, ' ')
    .trim();
}

function mentionsSignal(text: string, signal: string): boolean {
  const normalized = normalizeIntent(signal);
  // Latin capability words need real token boundaries: raw substring matching
  // made `app` in "happened" look like an application request. Persian keeps
  // prefix matching because suffixes are grammatical and carry the same noun.
  if (/^[a-z0-9][a-z0-9 ._-]*$/i.test(normalized)) {
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
  }
  return text.includes(normalized);
}

function mentionsAny(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => mentionsSignal(text, signal));
}

export function activeToolsFor(level: Level): readonly ToolName[] {
  return ACTIVE_BY_LEVEL[level];
}

/**
 * Narrow schemas to the resource families named in this turn.
 *
 * This is deliberately conservative: an ambiguous/terse request gets the full
 * level allow-list, so capability is never lost when intent cannot be proven.
 * Specific requests (for example logs for one app or a DNS record) avoid paying
 * input tokens for unrelated database, bucket, and DNS schemas. The result is
 * still intersected with the level ceiling, so intent can only narrow access.
 */
export function activeToolsForTurn(level: Level, userText: string): readonly ToolName[] {
  const levelTools = ACTIVE_BY_LEVEL[level];
  if (level === 1) return levelTools;

  const text = normalizeIntent(userText);
  // Architecture advice intentionally spans apps, databases, buckets and live
  // plans; family narrowing would hide the very comparisons that make it useful.
  if (mentionsAny(text, ARCHITECTURE_SIGNALS)) return levelTools;
  const families = (Object.keys(TOOL_FAMILIES) as Array<keyof typeof TOOL_FAMILIES>)
    .filter((family) => mentionsAny(text, FAMILY_SIGNALS[family]));

  // A bare hyphenated identifier is not assumed to be an app: it could equally
  // be a database, bucket, or DNS zone. Terse continuations, identifiers, and
  // vague account questions intentionally fall back to the complete level set.
  if (families.length === 0) return levelTools;

  const selected = new Set<ToolName>(ALWAYS_AVAILABLE);
  for (const family of families) {
    for (const name of TOOL_FAMILIES[family]) selected.add(name);
  }

  // Preserve the stable registry order and enforce the routing level ceiling.
  return levelTools.filter((name) => selected.has(name));
}

/**
 * `prepareStep` hook: narrows the active tool set on every step of the loop,
 * not just the first. A level decided once at routing time still needs
 * re-asserting per step — `prepareStep` is called fresh each time and nothing
 * upstream guarantees the same options object is reused.
 *
 * Escalation only ever narrows here; a Level-3 conversation can still, mid-loop,
 * be capped back down by passing a lower `level` (used by tests and by any
 * future "the model is spiralling, cut its tools" safety valve), but nothing in
 * this function *widens* beyond what capability.ts declares — that decision
 * lives in router.ts, once, at the start of the turn.
 */
export function prepareStepCapability(level: Level): { activeTools: readonly ToolName[] } {
  return { activeTools: activeToolsFor(level) };
}

/** For the UI: "این ابزار نیاز به سطح بالاتری دارد" style messaging, and tests. */
export function minLevelFor(tool: ToolName): MinLevel {
  return TOOL_MIN_LEVEL[tool];
}

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_MIN_LEVEL, name);
}
