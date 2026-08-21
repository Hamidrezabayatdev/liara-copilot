import { inspectRuntimeHealth } from '@/lib/server/health';
import {
  emitRequestTelemetry,
  requestIdFor,
} from '@/lib/server/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const started = Date.now();
  const requestId = requestIdFor(request);
  const health = await inspectRuntimeHealth();
  const status = health.ready ? 200 : 503;

  emitRequestTelemetry({
    event: 'http.request',
    requestId,
    method: 'GET',
    path: '/api/health',
    status,
    outcome: health.ready ? 'ok' : 'failed',
    durationMs: Date.now() - started,
    errorCode: health.ready ? undefined : 'not_ready',
  });

  return Response.json(
    {
      status: health.ready ? 'ok' : 'not_ready',
      checks: health.checks,
      corpus: health.corpus,
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-ID': requestId,
      },
    },
  );
}
