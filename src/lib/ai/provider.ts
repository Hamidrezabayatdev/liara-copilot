/**
 * Liara AI provider wiring.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. We MUST use `.chat(id)`, not `openai(id)`. In this SDK version the bare
 *    call and `.languageModel()` both return Responses-API models, and Liara
 *    only exposes `/chat/completions` (see docs/VERIFIED-FACTS.md §3).
 *
 *    Related: @ai-sdk/openai is safe against a non-OpenAI gateway here only
 *    because every Liara model id is `provider/model`. The provider's quirk
 *    heuristics are ^-anchored on bare OpenAI names (/^gpt-(\d+)/, /^o(\d+)/),
 *    so none of them fire and we send vanilla `max_tokens` + a `system` role
 *    instead of `max_completion_tokens` + `developer`. Do not pass a bare id
 *    like `gpt-5.2` through this provider; it would be silently rewritten.
 *
 * 2. Liara returns the real billed price as `usage.total_cost_toman`. That is a
 *    non-standard field, so the SDK drops it. We tee the HTTP response and read
 *    it out ourselves rather than estimating from a token count.
 */
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';

export type LiaraRawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** USD, as reported upstream */
  cost?: number;
  /** Toman, as billed by Liara. The number we actually show the user. */
  total_cost_toman?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

export type CapturedCall = {
  model: string;
  usage: LiaraRawUsage | null;
  latencyMs: number;
  ok: boolean;
  status: number;
  /** set when we fell back off the primary model */
  viaFallback?: string;
};

/**
 * Per-request bucket of what the models actually cost us. One of these is
 * created per HTTP request to /api/chat and threaded into the provider, so
 * concurrent users never mix usage. Never make this module-global.
 */
export type UsageCollector = {
  calls: CapturedCall[];
  /** In-flight observers for streamed usage. Await before presenting totals. */
  pending?: Promise<void>[];
};

export function createUsageCollector(): UsageCollector {
  return { calls: [], pending: [] };
}

function modelFromBody(body: unknown): string {
  if (typeof body !== 'string') return 'unknown';
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Pull `usage` out of a completed SSE stream without disturbing the consumer. */
async function scanSseForUsage(
  stream: ReadableStream<Uint8Array>,
  onUsage: (u: LiaraRawUsage) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are \n\n-delimited; keep the trailing partial event.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload) as { usage?: LiaraRawUsage | null };
            if (chunk.usage) onUsage(chunk.usage);
          } catch {
            // partial or non-JSON keepalive; ignore
          }
        }
      }
    }
  } catch {
    // A cancelled or broken stream costs us the cost datum, never the response.
  } finally {
    reader.releaseLock();
  }
}

/**
 * fetch wrapper that records usage into `collector`.
 * It must be transparent: any failure to observe is swallowed, and the response
 * handed back to the SDK is byte-identical to what the server sent.
 */
function instrumentedFetch(collector: UsageCollector): typeof globalThis.fetch {
  return async (input, init) => {
    const started = Date.now();
    const model = modelFromBody(init?.body);
    const res = await fetch(input as RequestInfo, init);

    const record = (usage: LiaraRawUsage | null) => {
      collector.calls.push({
        model,
        usage,
        latencyMs: Date.now() - started,
        ok: res.ok,
        status: res.status,
      });
    };

    if (!res.ok || !res.body) {
      record(null);
      return res;
    }

    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      const [toCaller, toScanner] = res.body.tee();
      // Streaming usage arrives in the final chunk (the provider sets
      // stream_options.include_usage), so this settles after the caller is done.
      let seen: LiaraRawUsage | null = null;
      const pending = scanSseForUsage(toScanner, u => {
        seen = u;
      }).then(() => record(seen));
      (collector.pending ??= []).push(pending);
      return new Response(toCaller, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    // Non-streaming: buffer, read usage, hand back an identical response.
    const text = await res.text();
    let usage: LiaraRawUsage | null = null;
    try {
      const json = JSON.parse(text) as { usage?: LiaraRawUsage };
      usage = json.usage ?? null;
    } catch {
      /* ignore */
    }
    record(usage);
    return new Response(text, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const MODELS = {
  router: () => process.env.MODEL_ROUTER ?? 'google/gemini-3.7-flash',
  answer: () => process.env.MODEL_ANSWER ?? 'google/gemini-3.7-flash',
  reason: () => process.env.MODEL_REASON ?? 'anthropic/claude-sonnet-5',
  /** only used to compute "what would this have cost on the big model" */
  baseline: () => process.env.MODEL_BASELINE ?? 'anthropic/claude-opus-5',
  embed: () => process.env.MODEL_EMBED ?? 'intfloat/multilingual-e5-large',
} as const;

export type Tier = 'router' | 'answer' | 'reason';

/** Build a Liara-backed provider whose usage lands in `collector`. */
export function createLiara(collector: UsageCollector) {
  return createOpenAI({
    baseURL: requireEnv('LIARA_AI_BASE_URL'),
    apiKey: requireEnv('LIARA_AI_KEY'),
    name: 'liara',
    fetch: instrumentedFetch(collector),
  });
}

/**
 * Optional secondary gateway. The user has AgentRouter/AvalAI accounts; if a key
 * is present we use it for failover, otherwise failover degrades to a cheaper
 * Liara model, which still keeps the session alive.
 */
function createSecondary(collector: UsageCollector) {
  const baseURL = process.env.FAILOVER_AI_BASE_URL;
  const apiKey = process.env.FAILOVER_AI_KEY;
  if (!baseURL || !apiKey) return null;
  return createOpenAI({
    baseURL,
    apiKey,
    name: 'failover',
    fetch: instrumentedFetch(collector),
  });
}

type ChatModel = ReturnType<ReturnType<typeof createOpenAI>['chat']>;

/**
 * Attach a failover chain to a model.
 *
 * Scope note: this recovers from call-level failures (HTTP 4xx/5xx, insufficient
 * balance, timeouts) because those reject the initial doStream/doGenerate
 * promise. A stream that dies halfway through is NOT retried — replaying it
 * would mean buffering and re-emitting text the user has already seen.
 */
function withFailover(
  primary: ChatModel,
  chain: Array<{ label: string; model: ChatModel }>,
  collector: UsageCollector,
) {
  const markFallback = (label: string) => {
    const last = collector.calls.at(-1);
    if (last) last.viaFallback = label;
  };

  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        return await doGenerate();
      } catch (primaryError) {
        for (const { label, model } of chain) {
          try {
            const result = await model.doGenerate(params);
            markFallback(label);
            return result;
          } catch {
            // try the next link
          }
        }
        throw primaryError;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      try {
        return await doStream();
      } catch (primaryError) {
        for (const { label, model } of chain) {
          try {
            const result = await model.doStream(params);
            markFallback(label);
            return result;
          } catch {
            // try the next link
          }
        }
        throw primaryError;
      }
    },
  };

  return wrapLanguageModel({ model: primary, middleware });
}

/** Model id for a tier. */
export function modelIdFor(tier: Tier): string {
  return MODELS[tier]();
}

/**
 * Resolve a tier to a language model, with failover already attached.
 *
 * Failover order: primary Liara model → secondary gateway (if configured) →
 * cheap Liara model. A reasoning-tier outage degrades to a weaker answer rather
 * than a broken session, which is the right trade for a live demo.
 */
export function modelFor(tier: Tier, collector: UsageCollector) {
  const liara = createLiara(collector);
  const primary = liara.chat(modelIdFor(tier));

  const secondary = createSecondary(collector);
  const chain: Array<{ label: string; model: ChatModel }> = [];
  if (secondary) chain.push({ label: 'failover-gateway', model: secondary.chat(modelIdFor(tier)) });
  if (tier === 'reason') {
    chain.push({ label: 'liara-cheap', model: liara.chat(MODELS.answer()) });
  }

  if (chain.length === 0) return primary;
  return withFailover(primary, chain, collector);
}
