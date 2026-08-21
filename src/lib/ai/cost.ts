/**
 * Cost accounting.
 *
 * This is a hero feature, so it must show *real* numbers, not estimates:
 *  - Per-message Toman comes from Liara's own `usage.total_cost_toman`.
 *  - Per-token prices come from `GET /models`, never hardcoded.
 *  - The USD→Toman rate is derived from `total_cost_toman / cost` on real
 *    responses, so it self-corrects as the rial moves.
 *
 * The only place we *compute* rather than read is the counterfactual baseline
 * ("what would this have cost on claude-opus-5 all the way through"), which by
 * definition never happened. That is labelled as an estimate in the UI.
 */
import type { UsageMeta as ComponentUsageMeta } from '@/components/types';

import type { CapturedCall, Tier, UsageCollector } from './provider';
import { MODELS } from './provider';

/**
 * Per-message accounting. Field names deliberately match the UI kit's
 * `UsageMeta` in src/components/types.ts so the server result can be handed to
 * the components with no mapping layer; the extra fields here (baseline,
 * savings, tier, fallback) are additive and drive the session footer.
 */
export type UsageMeta = ComponentUsageMeta & {
  tier: Tier;
  /** short Persian explanation of the route — the "چرا این مسیر؟" popover */
  routingReason: string;
  /** set if the primary model failed and a fallback served the answer */
  viaFallback?: string;
  /** ESTIMATE: what this would have cost with the baseline model throughout */
  baselineToman: number;
  /** 0..100, how much the routing saved versus that baseline */
  savedPercent: number;
  /** False when a successful provider/failover call omitted a real Toman cost. */
  costComplete: boolean;
};

export type ModelPrice = {
  promptUsdPerToken: number;
  completionUsdPerToken: number;
  cachedPromptUsdPerToken?: number;
};

/**
 * Observed 2026-08-21 as total_cost_toman/cost. Only ever used before the first
 * real response of a process; the first call with both fields overwrites it.
 */
let fxTomanPerUsd = 259_847;

function updateFxFrom(calls: CapturedCall[]): void {
  for (const call of calls) {
    const usd = call.usage?.cost;
    const toman = call.usage?.total_cost_toman;
    if (
      typeof usd === 'number' &&
      Number.isFinite(usd) &&
      usd > 0 &&
      typeof toman === 'number' &&
      Number.isFinite(toman) &&
      toman > 0
    ) {
      fxTomanPerUsd = toman / usd;
    }
  }
}

export function currentFx(): number {
  return fxTomanPerUsd;
}

let priceCache: Map<string, ModelPrice> | null = null;

/** Fetch and memoize the price catalogue. Failure degrades the baseline, not the chat. */
export async function loadPricing(): Promise<Map<string, ModelPrice>> {
  if (priceCache) return priceCache;
  const base = process.env.LIARA_AI_BASE_URL;
  const key = process.env.LIARA_AI_KEY;
  const prices = new Map<string, ModelPrice>();
  if (!base || !key) {
    return prices;
  }
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3_000),
      cache: 'no-store',
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: unknown };
      const items = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
      for (const raw of items) {
        const m = raw as {
          id?: string;
          pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
        };
        if (!m.id) continue;
        prices.set(m.id, {
          promptUsdPerToken: Number(m.pricing?.prompt ?? 0) || 0,
          completionUsdPerToken: Number(m.pricing?.completion ?? 0) || 0,
          cachedPromptUsdPerToken:
            Number(m.pricing?.input_cache_read ?? 0) || undefined,
        });
      }
    }
  } catch {
    // offline / gateway down: baseline shows 0 and the UI hides the comparison
  }
  // Do not turn a transient timeout/non-200 into a process-lifetime failure.
  // A successful catalogue is stable enough to cache; an empty one can retry.
  if (prices.size > 0) priceCache = prices;
  return prices;
}

/** Toman a given token count would have cost on `modelId`. */
export function estimateToman(
  prices: Map<string, ModelPrice>,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const p = prices.get(modelId);
  if (!p) return 0;
  const cached = Math.max(0, Math.min(inputTokens, cachedInputTokens));
  const uncached = Math.max(0, inputTokens - cached);
  const usd =
    uncached * p.promptUsdPerToken +
    cached * (p.cachedPromptUsdPerToken ?? p.promptUsdPerToken) +
    outputTokens * p.completionUsdPerToken;
  return usd * fxTomanPerUsd;
}

const safeAmount = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const sum = (ns: Array<number | undefined>) =>
  ns.reduce<number>((total, value) => total + safeAmount(value), 0);

function hasRealToman(call: CapturedCall): boolean {
  const value = call.usage?.total_cost_toman;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Fold every model call made while answering one message into a single record
 * for the UI. `calls` spans all agent steps, so a Level-3 answer that took 9
 * steps reports one honest total rather than nine fragments.
 */
export async function summarize(
  collector: UsageCollector,
  opts: { tier: Tier; escalation: 1 | 2 | 3; routingReason: string; toolCalls: number },
): Promise<UsageMeta> {
  // The provider observes streamed billing data on a tee of the upstream SSE.
  // Wait for those observers before folding the request into a UI total.
  await Promise.allSettled(collector.pending ?? []);
  updateFxFrom(collector.calls);
  const calls = collector.calls;
  const billed = calls.filter(c => c.ok);
  const costComplete = billed.length > 0 && billed.every(hasRealToman);

  const promptTokens = sum(billed.map(c => c.usage?.prompt_tokens));
  const completionTokens = sum(billed.map(c => c.usage?.completion_tokens));
  const toman = sum(billed.map(c => c.usage?.total_cost_toman));
  const cachedTokens = sum(billed.map(c => c.usage?.prompt_tokens_details?.cached_tokens));
  const reasoningTokens = sum(billed.map(c => c.usage?.completion_tokens_details?.reasoning_tokens));

  const prices = await loadPricing();
  const estimatedBaselineToman = estimateToman(
    prices,
    MODELS.baseline(),
    promptTokens,
    completionTokens,
    cachedTokens,
  );
  // A partial actual cost cannot support an honest savings percentage. Keep the
  // known subtotal, but hide the counterfactual until every successful provider
  // call supplied Liara's real Toman field.
  const baselineToman = costComplete ? estimatedBaselineToman : 0;

  const byModel = new Map<string, { model: string; calls: number; toman: number }>();
  for (const call of billed) {
    const current = byModel.get(call.model);
    byModel.set(call.model, {
      model: call.model,
      calls: (current?.calls ?? 0) + 1,
      toman: (current?.toman ?? 0) + safeAmount(call.usage?.total_cost_toman),
    });
  }

  // Guard both directions: no baseline price (catalogue fetch failed) and the
  // case where the route we picked was actually the expensive one.
  const savedPercent =
    baselineToman > 0 && toman > 0
      ? Math.max(0, Math.min(100, ((baselineToman - toman) / baselineToman) * 100))
      : 0;

  const fallback = calls.find(c => c.viaFallback)?.viaFallback;

  return {
    model: billed.at(-1)?.model ?? calls.at(-1)?.model ?? 'unknown',
    tier: opts.tier,
    promptTokens,
    completionTokens,
    toman,
    toolCalls: opts.toolCalls,
    // wall-clock of the slowest single call understates a serial chain, so sum.
    latencyMs: sum(calls.map(c => c.latencyMs)),
    escalation: opts.escalation,
    routingReason: opts.routingReason,
    cachedTokens: cachedTokens || undefined,
    reasoningTokens: reasoningTokens || undefined,
    viaFallback: fallback,
    baselineToman,
    savedPercent,
    modelBreakdown: [...byModel.values()],
    costComplete,
  };
}
