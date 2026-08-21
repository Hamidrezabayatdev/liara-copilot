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
import type { CapturedCall, Tier, UsageCollector } from './provider';
import { MODELS } from './provider';

/**
 * Per-message accounting. Field names deliberately match the UI kit's
 * `UsageMeta` in src/components/types.ts so the server result can be handed to
 * the components with no mapping layer; the extra fields here (baseline,
 * savings, tier, fallback) are additive and drive the session footer.
 */
export type UsageMeta = {
  model: string;
  tier: Tier;
  promptTokens: number;
  completionTokens: number;
  /** real billed cost, straight from Liara's `usage.total_cost_toman` */
  toman: number;
  toolCalls: number;
  latencyMs: number;
  /** 1 = direct answer, 2 = retrieval/inspect, 3 = full agentic reasoning */
  escalation: 1 | 2 | 3;
  /** short Persian explanation of the route — the "چرا این مسیر؟" popover */
  routingReason: string;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** set if the primary model failed and a fallback served the answer */
  viaFallback?: string;
  /** ESTIMATE: what this would have cost with the baseline model throughout */
  baselineToman: number;
  /** 0..100, how much the routing saved versus that baseline */
  savedPercent: number;
};

export type ModelPrice = { promptUsdPerToken: number; completionUsdPerToken: number };

/**
 * Observed 2026-08-21 as total_cost_toman/cost. Only ever used before the first
 * real response of a process; the first call with both fields overwrites it.
 */
let fxTomanPerUsd = 259_847;

function updateFxFrom(calls: CapturedCall[]): void {
  for (const call of calls) {
    const usd = call.usage?.cost;
    const toman = call.usage?.total_cost_toman;
    if (usd && toman && usd > 0) fxTomanPerUsd = toman / usd;
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
    priceCache = prices;
    return prices;
  }
  try {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      const body = (await res.json()) as { data?: unknown };
      const items = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
      for (const raw of items) {
        const m = raw as { id?: string; pricing?: { prompt?: string; completion?: string } };
        if (!m.id) continue;
        prices.set(m.id, {
          promptUsdPerToken: Number(m.pricing?.prompt ?? 0) || 0,
          completionUsdPerToken: Number(m.pricing?.completion ?? 0) || 0,
        });
      }
    }
  } catch {
    // offline / gateway down: baseline shows 0 and the UI hides the comparison
  }
  priceCache = prices;
  return prices;
}

/** Toman a given token count would have cost on `modelId`. */
export function estimateToman(
  prices: Map<string, ModelPrice>,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = prices.get(modelId);
  if (!p) return 0;
  const usd = inputTokens * p.promptUsdPerToken + outputTokens * p.completionUsdPerToken;
  return usd * fxTomanPerUsd;
}

const sum = (ns: Array<number | undefined>) => ns.reduce<number>((a, b) => a + (b ?? 0), 0);

/**
 * Fold every model call made while answering one message into a single record
 * for the UI. `calls` spans all agent steps, so a Level-3 answer that took 9
 * steps reports one honest total rather than nine fragments.
 */
export async function summarize(
  collector: UsageCollector,
  opts: { tier: Tier; escalation: 1 | 2 | 3; routingReason: string; toolCalls: number },
): Promise<UsageMeta> {
  updateFxFrom(collector.calls);
  const calls = collector.calls;
  const billed = calls.filter(c => c.ok);

  const promptTokens = sum(billed.map(c => c.usage?.prompt_tokens));
  const completionTokens = sum(billed.map(c => c.usage?.completion_tokens));
  const toman = sum(billed.map(c => c.usage?.total_cost_toman));
  const cachedTokens = sum(billed.map(c => c.usage?.prompt_tokens_details?.cached_tokens));
  const reasoningTokens = sum(billed.map(c => c.usage?.completion_tokens_details?.reasoning_tokens));

  const prices = await loadPricing();
  const baselineToman = estimateToman(prices, MODELS.baseline(), promptTokens, completionTokens);

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
  };
}
