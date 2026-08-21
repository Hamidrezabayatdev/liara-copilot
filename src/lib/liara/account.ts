/**
 * Account + plan catalog. `GET /v1/me` is the golden endpoint: one call returns
 * the user, the team (with role + permissions), feature flags, database
 * versions and the FULL plan catalog with prices.
 *
 * Plan IDs are validated against this catalog rather than hardcoded — the
 * catalog is the account's own truth and changes without notice.
 */

import { fail, liaraFetch } from './client';
import type { AccountAndPlans, LiaraCtx, Plan, ToolResult } from './types';

export function getAccountAndPlans(ctx: LiaraCtx): Promise<ToolResult<AccountAndPlans>> {
  return liaraFetch<AccountAndPlans>('paas', 'GET', '/v1/me', { ctx });
}

export type PlanSummary = {
  planID: string;
  available: boolean;
  region: string;
  /** Toman per hour. */
  pricePerHour: number;
  /** Toman per month, as shown in the console. */
  pricePerMonth?: number;
  ramGB?: number;
  cpuCores?: number;
  diskGB?: number;
  /** True for the `-g2` generation, the only one that can actually be created. */
  isG2: boolean;
};

function summarize(planID: string, plan: Plan): PlanSummary {
  return {
    planID,
    available: plan.available === true,
    region: plan.region,
    pricePerHour: plan.price,
    pricePerMonth: typeof plan.displayPrice === 'number' ? plan.displayPrice : undefined,
    ramGB: plan.RAM?.amount,
    cpuCores: plan.CPU?.amount,
    diskGB: typeof plan.volume === 'number' ? plan.volume : undefined,
    isG2: planID.endsWith('-g2'),
  };
}

export type PlanKind = 'projects' | 'databases';

/**
 * The plan catalog for one product family, sorted cheapest first.
 *
 * ⚠️ `available` is NOT reliable — docs/VERIFIED-FACTS.md §6 records `ir-small`
 * advertised as available while creation fails with `g1_plan_unavailable`.
 * Surface plans, let the API be the final authority, and prefer `-g2`.
 */
export async function listPlans(
  ctx: LiaraCtx,
  kind: PlanKind = 'projects',
  opts?: { region?: string; onlyAvailable?: boolean },
): Promise<ToolResult<PlanSummary[]>> {
  const me = await getAccountAndPlans(ctx);
  if (!me.ok) return me;

  const table = me.data?.plans?.[kind];
  if (!table || typeof table !== 'object') {
    return fail(`plan catalog for "${kind}" was missing from GET /v1/me`);
  }

  let plans = Object.entries(table).map(([id, p]) => summarize(id, p as Plan));
  if (opts?.region) plans = plans.filter((p) => p.region === opts.region);
  if (opts?.onlyAvailable !== false) plans = plans.filter((p) => p.available);
  plans.sort((a, b) => a.pricePerHour - b.pricePerHour);

  return { ok: true, data: plans, source: 'account' };
}

/**
 * Check a plan ID against the live catalog.
 *
 * `ok: false` only when the ID does not exist at all — an existing plan marked
 * `available: false` is returned with a warning so the caller can decide,
 * because the flag has been observed to be wrong in both directions.
 */
export async function validatePlanID(
  ctx: LiaraCtx,
  planID: string,
  kind: PlanKind = 'projects',
): Promise<ToolResult<{ plan: PlanSummary; warning?: string }>> {
  if (typeof planID !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(planID)) {
    return fail(`planID ${JSON.stringify(planID)} is not a valid plan identifier`);
  }

  const all = await listPlans(ctx, kind, { onlyAvailable: false });
  if (!all.ok) return all;

  const found = all.data.find((p) => p.planID === planID);
  if (!found) {
    const suggestions = all.data
      .filter((p) => p.available && p.isG2)
      .map((p) => p.planID)
      .slice(0, 8);
    return fail(
      `planID "${planID}" does not exist in this account's ${kind} catalog. ` +
        `Available g2 plans: ${suggestions.join(', ') || '(none)'}`,
    );
  }

  let warning: string | undefined;
  if (!found.available) {
    warning =
      `plan "${planID}" is marked available:false in the catalog — Liara will probably ` +
      `reject it (e.g. g1_plan_unavailable). Prefer a -g2 plan.`;
  } else if (!found.isG2) {
    warning =
      `plan "${planID}" is a pre-g2 generation. The catalog claims it is available, but ` +
      `creation/resize has been observed to fail with g1_plan_unavailable.`;
  }

  return { ok: true, data: { plan: found, warning }, source: 'account' };
}
