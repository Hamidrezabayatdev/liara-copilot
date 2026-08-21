import { createHash } from 'node:crypto';

import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  validateUIMessages,
} from 'ai';

import {
  MAX_USER_MESSAGE_CHARS,
  latestUserText,
  streamAgentResponse,
  type ChatMessage,
} from '@/lib/ai/agent';
import { createUsageCollector, type UsageCollector } from '@/lib/ai/provider';
import { createDocsTools, createLiaraTools } from '@/lib/ai/tools';
import { getLiaraConnection } from '@/lib/auth/liara-session';
import {
  ANONYMOUS_DOCS_INSTRUCTIONS,
  clearlyNeedsLiaraAccount,
} from '@/lib/server/anonymous-chat';
import {
  clientFingerprint,
  isSameOriginRequest,
  takeConcurrencySlot,
  takeRateLimit,
  withRequestDeadline,
} from '@/lib/server/request-guard';
import {
  accountHash,
  emitRequestTelemetry,
  requestIdFor,
  summarizeCollectorForTelemetry,
  type RequestOutcome,
} from '@/lib/server/telemetry';

export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 256_000;
const MAX_MESSAGES = 80;
const MAX_CONVERSATION_TEXT_CHARS = 64_000;
const REQUEST_DEADLINE_MS = 110_000;

function jsonError(
  message: string,
  status: number,
  requestId: string,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('X-Request-ID', requestId);
  return Response.json({ error: message }, { status, headers: responseHeaders });
}

function releaseWhenFinished(
  response: Response,
  finish: (outcome: RequestOutcome) => void,
  requestId: string,
): Response {
  if (!response.body) {
    finish('ok');
    const headers = new Headers(response.headers);
    headers.set('X-Request-ID', requestId);
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish('ok');
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        finish('stream_error');
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish('cancelled');
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  const headers = new Headers(response.headers);
  headers.set('X-Request-ID', requestId);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const requestId = requestIdFor(request);
  let telemetryFinished = false;
  const telemetryContext: {
    collector?: UsageCollector;
    accountHash?: string;
    authMode?: 'anonymous-docs' | 'connected';
  } = {};

  const finishTelemetry = (
    status: number,
    outcome: RequestOutcome,
    errorCode?: string,
  ) => {
    if (telemetryFinished) return;
    telemetryFinished = true;
    const hasAiActivity = telemetryContext.collector && (
      telemetryContext.collector.calls.length > 0 ||
      (telemetryContext.collector.attemptedCalls ?? 0) > 0 ||
      telemetryContext.collector.summary !== undefined
    );
    emitRequestTelemetry({
      event: 'http.request',
      requestId,
      method: 'POST',
      path: '/api/chat',
      status,
      outcome,
      durationMs: Date.now() - started,
      authMode: telemetryContext.authMode,
      accountHash: telemetryContext.accountHash,
      errorCode,
      ai: hasAiActivity && telemetryContext.collector
        ? summarizeCollectorForTelemetry(telemetryContext.collector)
        : undefined,
    });
  };

  const fail = (
    message: string,
    status: number,
    errorCode: string,
    headers?: HeadersInit,
  ) => {
    finishTelemetry(status, status >= 500 ? 'failed' : 'rejected', errorCode);
    return jsonError(message, status, requestId, headers);
  };

  if (!isSameOriginRequest(request)) {
    return fail('مبدأ درخواست مجاز نیست.', 403, 'origin_rejected');
  }
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return fail('بدنهٔ درخواست باید JSON باشد.', 415, 'content_type');
  }
  const rate = takeRateLimit(request, 'chat', 30, 5 * 60_000);
  if (!rate.allowed) {
    return fail('تعداد درخواست‌ها بیش از حد است؛ کمی بعد تلاش کنید.', 429, 'rate_limit', {
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }
  const advertisedLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_BODY_BYTES) {
    return fail('گفتگو بیش از حد بزرگ است.', 413, 'body_too_large');
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return fail('گفتگو بیش از حد بزرگ است.', 413, 'body_too_large');
    }
    body = JSON.parse(raw);
  } catch {
    return fail('درخواست گفتگو معتبر نیست.', 400, 'invalid_json');
  }

  const rawMessages =
    body && typeof body === 'object' && 'messages' in body
      ? (body as { messages?: unknown }).messages
      : undefined;

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return fail('حداقل یک پیام لازم است.', 400, 'messages_missing');
  }
  if (rawMessages.length > MAX_MESSAGES) {
    return fail('تعداد پیام‌های گفتگو بیش از حد مجاز است.', 413, 'messages_too_many');
  }

  const connection = getLiaraConnection(request.headers.get('cookie'));
  const anonymous = connection.ctx === null;
  telemetryContext.authMode = anonymous ? 'anonymous-docs' : 'connected';
  if (connection.ctx) {
    telemetryContext.accountHash = accountHash(connection.ctx.token, connection.ctx.teamId);
  } else {
    const anonymousRate = takeRateLimit(request, 'chat-anonymous', 12, 5 * 60_000);
    if (!anonymousRate.allowed) {
      return fail(
        'سهم پرسش‌های عمومی تمام شده است؛ کمی بعد دوباره تلاش کنید.',
        429,
        'anonymous_rate_limit',
        { 'Retry-After': String(anonymousRate.retryAfterSeconds) },
      );
    }
  }

  const collector = createUsageCollector();
  telemetryContext.collector = collector;
  const tools = connection.ctx
    ? createLiaraTools(connection.ctx, { collector })
    : createDocsTools({ collector });

  let messages: ChatMessage[];
  try {
    messages = await validateUIMessages<ChatMessage>({
      messages: rawMessages,
      tools,
    });
  } catch {
    return fail('ساختار پیام‌ها یا ابزارها معتبر نیست.', 400, 'invalid_messages');
  }

  if (messages.some((message) => message.role === 'system')) {
    return fail('پیام system از سمت کاربر پذیرفته نمی‌شود.', 400, 'system_message');
  }

  const lastMessage = messages.at(-1);
  const isToolContinuation =
    lastMessage?.role === 'assistant' &&
    (lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
      lastAssistantMessageIsCompleteWithToolCalls({ messages }));
  if (lastMessage?.role !== 'user' && !isToolContinuation) {
    return fail(
      'گفتگو باید با پیام کاربر یا پاسخ معتبر ابزار ادامه پیدا کند.',
      400,
      'invalid_continuation',
    );
  }

  const conversationTextChars = messages.reduce(
    (total, message) =>
      total +
      message.parts.reduce(
        (messageTotal, part) =>
          messageTotal + (part.type === 'text' ? part.text.length : 0),
        0,
      ),
    0,
  );
  if (conversationTextChars > MAX_CONVERSATION_TEXT_CHARS) {
    return fail('متن گفتگو بیش از حد مجاز است.', 413, 'conversation_too_large');
  }

  const userText = latestUserText(messages);
  if (!userText) return fail('یک پیام متنی لازم است.', 400, 'text_missing');
  if (userText.length > MAX_USER_MESSAGE_CHARS) {
    return fail('پیام بیش از ۴۰۰۰ نویسه است.', 413, 'message_too_large');
  }
  if (anonymous && clearlyNeedsLiaraAccount(userText)) {
    return fail(
      'برای بررسی منابع و وضعیت حساب، ابتدا حساب Liara خود را متصل کنید.',
      401,
      'account_required',
    );
  }

  const clientKey = clientFingerprint(request);
  const approvalScope = connection.ctx
    ? createHash('sha256')
      .update('liara-copilot:account:v1\0')
      .update(connection.ctx.token)
      .update('\0')
      .update(connection.ctx.teamId ?? '')
      .digest('base64url')
    : `anonymous-docs:${clientKey}`;
  const release = takeConcurrencySlot(`chat:${approvalScope}`, 1);
  if (!release) {
    return fail('یک پاسخ دیگر برای این نشست هنوز در حال اجراست.', 429, 'concurrency_limit', {
      'Retry-After': '2',
    });
  }

  const deadlineSignal = withRequestDeadline(request.signal, REQUEST_DEADLINE_MS);
  try {
    const response = await streamAgentResponse({
      messages,
      tools,
      collector,
      approvalScope,
      abortSignal: deadlineSignal,
      allowedTools: anonymous ? ['searchDocs'] : undefined,
      operatingModeInstructions: anonymous
        ? ANONYMOUS_DOCS_INSTRUCTIONS
        : undefined,
      acceptToolHistory: !anonymous,
    });
    return releaseWhenFinished(
      response,
      (outcome) => {
        release();
        const completedOutcome =
          outcome === 'ok' && collector.streamFailed ? 'stream_error' : outcome;
        const deadlineExpired =
          deadlineSignal.aborted && !request.signal.aborted;
        finishTelemetry(
          response.status,
          completedOutcome,
          deadlineExpired
            ? 'request_deadline'
            : completedOutcome === 'ok'
              ? undefined
              : 'stream_interrupted',
        );
      },
      requestId,
    );
  } catch {
    release();
    const timedOut = deadlineSignal.aborted && !request.signal.aborted;
    return fail(
      timedOut
        ? 'پاسخ بیش از حد طول کشید؛ دوباره تلاش کنید.'
        : 'سرویس هوش مصنوعی در دسترس نیست یا درست تنظیم نشده است.',
      timedOut ? 504 : 503,
      timedOut ? 'request_deadline' : 'ai_unavailable',
    );
  }
}
