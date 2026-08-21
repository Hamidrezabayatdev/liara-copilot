import { createHash, randomUUID } from 'node:crypto';

import type { UsageCollector } from '@/lib/ai/provider';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export type RequestOutcome =
  | 'ok'
  | 'rejected'
  | 'failed'
  | 'stream_error'
  | 'cancelled';

export type RequestTelemetry = {
  event: 'http.request';
  requestId: string;
  method: string;
  path: string;
  status: number;
  outcome: RequestOutcome;
  durationMs: number;
  authMode?: 'anonymous-docs' | 'connected';
  accountHash?: string;
  errorCode?: string;
  ai?: ReturnType<typeof summarizeCollectorForTelemetry>;
};

/**
 * Reuse a proxy request id only when it is a short log-safe token. New ids are
 * otherwise generated server-side, preventing control-character log injection.
 */
export function requestIdFor(request: Request): string {
  const upstream = request.headers.get('x-request-id')?.trim();
  return upstream && REQUEST_ID_RE.test(upstream) ? upstream : randomUUID();
}

/** A stable, non-reversible account label. Inputs are never included in logs. */
export function accountHash(token: string, teamId?: string): string {
  return createHash('sha256')
    .update('liara-copilot:telemetry-account:v1\0')
    .update(token)
    .update('\0')
    .update(teamId ?? '')
    .digest('base64url')
    .slice(0, 16);
}

const amount = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * Convert model observations to an intentionally narrow, prompt-free record.
 * No provider body, user text, tool input, token, or upstream error is accepted.
 */
export function summarizeCollectorForTelemetry(collector: UsageCollector) {
  const calls = collector.calls;
  const models = [...new Set(calls.map((call) => call.model))];
  return {
    tier: collector.summary?.tier,
    escalation: collector.summary?.escalation,
    modelCalls: calls.length,
    attemptedModelCalls: collector.attemptedCalls ?? calls.length,
    models,
    toolCalls: collector.summary?.toolCalls,
    promptTokens: calls.reduce(
      (total, call) => total + amount(call.usage?.prompt_tokens),
      0,
    ),
    completionTokens: calls.reduce(
      (total, call) => total + amount(call.usage?.completion_tokens),
      0,
    ),
    costToman: calls.reduce(
      (total, call) => total + amount(call.usage?.total_cost_toman),
      0,
    ),
    providerLatencyMs: calls.reduce(
      (total, call) => total + amount(call.latencyMs),
      0,
    ),
    failedCalls: calls.filter((call) => !call.ok).length,
    fallbackUsed: calls.some((call) => call.viaFallback !== undefined),
    callBudgetExceeded: collector.callBudgetExceeded === true,
  };
}

/** One compact JSON line per completed HTTP request, ready for Liara logs. */
export function emitRequestTelemetry(record: RequestTelemetry): void {
  if (process.env.TELEMETRY_ENABLED === 'false') return;
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'liara-copilot',
    ...record,
  }));
}
