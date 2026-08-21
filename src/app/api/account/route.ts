import {
  clearLiaraSessionCookie,
  createLiaraSessionCookie,
  getLiaraConnection,
  isLiaraSessionConfigured,
  isSharedLiaraTokenAllowed,
  normalizeLiaraContext,
} from '@/lib/auth/liara-session';
import { getAccountAndPlans } from '@/lib/liara';
import type { AccountAndPlans } from '@/lib/liara';
import { isSameOriginRequest, takeRateLimit } from '@/lib/server/request-guard';
import {
  accountHash as hashAccount,
  emitRequestTelemetry,
  requestIdFor,
} from '@/lib/server/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 12_000;

function requestResponder(request: Request) {
  const started = Date.now();
  const requestId = requestIdFor(request);
  let accountHash: string | undefined;
  let finished = false;

  return {
    identify(token: string, teamId?: string) {
      accountHash = hashAccount(token, teamId);
    },
    json(
      body: Record<string, unknown>,
      status = 200,
      options?: { headers?: HeadersInit; errorCode?: string },
    ): Response {
      if (!finished) {
        finished = true;
        emitRequestTelemetry({
          event: 'http.request',
          requestId,
          method: request.method,
          path: '/api/account',
          status,
          outcome: status < 400 ? 'ok' : status < 500 ? 'rejected' : 'failed',
          durationMs: Date.now() - started,
          accountHash,
          errorCode: options?.errorCode,
        });
      }
      const headers = new Headers(options?.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Request-ID', requestId);
      return Response.json(body, { status, headers });
    },
  };
}

function connectionStatus(request: Request): Record<string, unknown> {
  const connection = getLiaraConnection(request.headers.get('cookie'));
  return {
    connected: connection.ctx !== null,
    source: connection.source,
    teamId: connection.ctx?.teamId ?? null,
    canConnect: isLiaraSessionConfigured(),
    sharedTokenAllowed: isSharedLiaraTokenAllowed(),
  };
}

function matchesRequestedTeam(data: AccountAndPlans, teamId: string | undefined): boolean {
  if (!teamId) return true;
  const team = data.team;
  if (!team || typeof team !== 'object') return false;

  const reported = [team._id, team.id].find((value) => typeof value === 'string');
  return reported !== undefined && reported.toLowerCase() === teamId.toLowerCase();
}

export async function GET(request: Request): Promise<Response> {
  const responder = requestResponder(request);
  const connection = getLiaraConnection(request.headers.get('cookie'));
  if (connection.ctx) responder.identify(connection.ctx.token, connection.ctx.teamId);
  return responder.json(connectionStatus(request));
}

export async function POST(request: Request): Promise<Response> {
  const responder = requestResponder(request);
  if (!isSameOriginRequest(request)) {
    return responder.json(
      { error: 'مبدأ درخواست مجاز نیست.' },
      403,
      { errorCode: 'origin_rejected' },
    );
  }
  const rate = takeRateLimit(request, 'account-connect', 10, 60_000);
  if (!rate.allowed) {
    return responder.json(
      { error: 'تعداد تلاش‌های اتصال بیش از حد است.' },
      429,
      {
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        errorCode: 'rate_limit',
      },
    );
  }
  if (!isLiaraSessionConfigured()) {
    return responder.json(
      { error: 'رمز اتصال امن سرور تنظیم نشده است.' },
      503,
      { errorCode: 'session_not_configured' },
    );
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return responder.json(
      { error: 'بدنهٔ درخواست باید JSON باشد.' },
      415,
      { errorCode: 'content_type' },
    );
  }

  const advertisedLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_BODY_BYTES) {
    return responder.json(
      { error: 'درخواست اتصال بیش از حد بزرگ است.' },
      413,
      { errorCode: 'body_too_large' },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return responder.json(
        { error: 'درخواست اتصال بیش از حد بزرگ است.' },
        413,
        { errorCode: 'body_too_large' },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return responder.json(
      { error: 'درخواست اتصال معتبر نیست.' },
      400,
      { errorCode: 'invalid_json' },
    );
  }

  if (!body || typeof body !== 'object') {
    return responder.json(
      { error: 'توکن Liara لازم است.' },
      400,
      { errorCode: 'token_missing' },
    );
  }

  const values = body as { token?: unknown; teamId?: unknown };
  const normalised = normalizeLiaraContext(values.token, values.teamId);
  if ('error' in normalised) {
    const message =
      normalised.error === 'teamId'
        ? 'شناسهٔ تیم باید یک شناسهٔ ۲۴ نویسه‌ای معتبر باشد.'
        : 'توکن Liara معتبر نیست.';
    return responder.json(
      { error: message },
      400,
      { errorCode: `invalid_${normalised.error}` },
    );
  }
  responder.identify(normalised.ctx.token, normalised.ctx.teamId);

  // GET /v1/me is a harmless read and the canonical way to verify both the
  // bearer token and its requested team scope before retaining credentials.
  const validation = await getAccountAndPlans(normalised.ctx);
  if (!validation.ok) {
    if (validation.status === 401 || validation.status === 403) {
      return responder.json(
        { error: 'توکن Liara پذیرفته نشد.' },
        401,
        { errorCode: 'token_rejected' },
      );
    }
    if (validation.status === 400 || validation.status === 404) {
      return responder.json(
        { error: 'شناسهٔ تیم با این توکن معتبر نیست.' },
        400,
        { errorCode: 'team_rejected' },
      );
    }
    return responder.json(
      { error: 'در حال حاضر امکان بررسی اتصال Liara نیست.' },
      502,
      { errorCode: 'liara_unavailable' },
    );
  }

  if (!matchesRequestedTeam(validation.data, normalised.ctx.teamId)) {
    return responder.json(
      { error: 'توکن به تیم درخواستی دسترسی ندارد.' },
      403,
      { errorCode: 'team_scope_mismatch' },
    );
  }

  const setCookie = createLiaraSessionCookie(normalised.ctx);
  return responder.json(
    {
      connected: true,
      source: 'cookie',
      teamId: normalised.ctx.teamId ?? null,
    },
    200,
    { headers: { 'Set-Cookie': setCookie } },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const responder = requestResponder(request);
  if (!isSameOriginRequest(request)) {
    return responder.json(
      { error: 'مبدأ درخواست مجاز نیست.' },
      403,
      { errorCode: 'origin_rejected' },
    );
  }
  const current = getLiaraConnection(request.headers.get('cookie'));
  if (current.ctx) responder.identify(current.ctx.token, current.ctx.teamId);
  // Report the state that remains after the cookie disappears. A private local
  // demo may intentionally fall back to the shared environment account.
  const connection = getLiaraConnection(null);
  return responder.json(
    {
      connected: connection.ctx !== null,
      source: connection.source,
      teamId: connection.ctx?.teamId ?? null,
    },
    200,
    { headers: { 'Set-Cookie': clearLiaraSessionCookie() } },
  );
}
