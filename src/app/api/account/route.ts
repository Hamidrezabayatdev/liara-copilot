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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 12_000;

function json(
  body: Record<string, unknown>,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return Response.json(body, { status, headers: responseHeaders });
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
  return json(connectionStatus(request));
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return json({ error: 'مبدأ درخواست مجاز نیست.' }, 403);
  }
  const rate = takeRateLimit(request, 'account-connect', 10, 60_000);
  if (!rate.allowed) {
    return json(
      { error: 'تعداد تلاش‌های اتصال بیش از حد است.' },
      429,
      { 'Retry-After': String(rate.retryAfterSeconds) },
    );
  }
  if (!isLiaraSessionConfigured()) {
    return json({ error: 'رمز اتصال امن سرور تنظیم نشده است.' }, 503);
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return json({ error: 'بدنهٔ درخواست باید JSON باشد.' }, 415);
  }

  const advertisedLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_BODY_BYTES) {
    return json({ error: 'درخواست اتصال بیش از حد بزرگ است.' }, 413);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'درخواست اتصال بیش از حد بزرگ است.' }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'درخواست اتصال معتبر نیست.' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return json({ error: 'توکن Liara لازم است.' }, 400);
  }

  const values = body as { token?: unknown; teamId?: unknown };
  const normalised = normalizeLiaraContext(values.token, values.teamId);
  if ('error' in normalised) {
    const message =
      normalised.error === 'teamId'
        ? 'شناسهٔ تیم باید یک شناسهٔ ۲۴ نویسه‌ای معتبر باشد.'
        : 'توکن Liara معتبر نیست.';
    return json({ error: message }, 400);
  }

  // GET /v1/me is a harmless read and the canonical way to verify both the
  // bearer token and its requested team scope before retaining credentials.
  const validation = await getAccountAndPlans(normalised.ctx);
  if (!validation.ok) {
    if (validation.status === 401 || validation.status === 403) {
      return json({ error: 'توکن Liara پذیرفته نشد.' }, 401);
    }
    if (validation.status === 400 || validation.status === 404) {
      return json({ error: 'شناسهٔ تیم با این توکن معتبر نیست.' }, 400);
    }
    return json({ error: 'در حال حاضر امکان بررسی اتصال Liara نیست.' }, 502);
  }

  if (!matchesRequestedTeam(validation.data, normalised.ctx.teamId)) {
    return json({ error: 'توکن به تیم درخواستی دسترسی ندارد.' }, 403);
  }

  const setCookie = createLiaraSessionCookie(normalised.ctx);
  return json(
    {
      connected: true,
      source: 'cookie',
      teamId: normalised.ctx.teamId ?? null,
    },
    200,
    { 'Set-Cookie': setCookie },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return json({ error: 'مبدأ درخواست مجاز نیست.' }, 403);
  }
  const connection = getLiaraConnection(null);
  return json(
    {
      connected: connection.ctx !== null,
      source: connection.source,
      teamId: connection.ctx?.teamId ?? null,
    },
    200,
    { 'Set-Cookie': clearLiaraSessionCookie() },
  );
}
