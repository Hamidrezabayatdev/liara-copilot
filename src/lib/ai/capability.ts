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

export function activeToolsFor(level: Level): readonly ToolName[] {
  return ACTIVE_BY_LEVEL[level];
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
