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
import { createUsageCollector } from '@/lib/ai/provider';
import { createLiaraTools } from '@/lib/ai/tools';
import {
  getLiaraConnection,
  isLiaraSessionConfigured,
} from '@/lib/auth/liara-session';
import {
  isSameOriginRequest,
  takeConcurrencySlot,
  takeRateLimit,
} from '@/lib/server/request-guard';

export const maxDuration = 120;
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 256_000;
const MAX_MESSAGES = 80;
const MAX_CONVERSATION_TEXT_CHARS = 64_000;

function jsonError(message: string, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return Response.json({ error: message }, { status, headers: responseHeaders });
}

function releaseWhenFinished(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonError('مبدأ درخواست مجاز نیست.', 403);
  }
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return jsonError('بدنهٔ درخواست باید JSON باشد.', 415);
  }
  const rate = takeRateLimit(request, 'chat', 30, 5 * 60_000);
  if (!rate.allowed) {
    return jsonError('تعداد درخواست‌ها بیش از حد است؛ کمی بعد تلاش کنید.', 429, {
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }
  const advertisedLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_BODY_BYTES) {
    return jsonError('گفتگو بیش از حد بزرگ است.', 413);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return jsonError('گفتگو بیش از حد بزرگ است.', 413);
    }
    body = JSON.parse(raw);
  } catch {
    return jsonError('درخواست گفتگو معتبر نیست.', 400);
  }

  const rawMessages =
    body && typeof body === 'object' && 'messages' in body
      ? (body as { messages?: unknown }).messages
      : undefined;

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return jsonError('حداقل یک پیام لازم است.', 400);
  }
  if (rawMessages.length > MAX_MESSAGES) {
    return jsonError('تعداد پیام‌های گفتگو بیش از حد مجاز است.', 413);
  }

  const connection = getLiaraConnection(request.headers.get('cookie'));
  if (!connection.ctx) {
    if (!isLiaraSessionConfigured()) {
      return jsonError('اتصال امن سرور به Liara تنظیم نشده است.', 503);
    }
    return jsonError('ابتدا حساب Liara خود را متصل کنید.', 401);
  }

  const collector = createUsageCollector();
  const tools = createLiaraTools(connection.ctx, { collector });

  let messages: ChatMessage[];
  try {
    messages = await validateUIMessages<ChatMessage>({
      messages: rawMessages,
      tools,
    });
  } catch {
    return jsonError('ساختار پیام‌ها یا ابزارها معتبر نیست.', 400);
  }

  if (messages.some((message) => message.role === 'system')) {
    return jsonError('پیام system از سمت کاربر پذیرفته نمی‌شود.', 400);
  }

  const lastMessage = messages.at(-1);
  const isToolContinuation =
    lastMessage?.role === 'assistant' &&
    (lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
      lastAssistantMessageIsCompleteWithToolCalls({ messages }));
  if (lastMessage?.role !== 'user' && !isToolContinuation) {
    return jsonError('گفتگو باید با پیام کاربر یا پاسخ معتبر ابزار ادامه پیدا کند.', 400);
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
    return jsonError('متن گفتگو بیش از حد مجاز است.', 413);
  }

  const userText = latestUserText(messages);
  if (!userText) return jsonError('یک پیام متنی لازم است.', 400);
  if (userText.length > MAX_USER_MESSAGE_CHARS) {
    return jsonError('پیام بیش از ۴۰۰۰ نویسه است.', 413);
  }

  const approvalScope = createHash('sha256')
    .update('liara-copilot:account:v1\0')
    .update(connection.ctx.token)
    .update('\0')
    .update(connection.ctx.teamId ?? '')
    .digest('base64url');
  const release = takeConcurrencySlot(`chat:${approvalScope}`, 1);
  if (!release) {
    return jsonError('یک پاسخ دیگر برای این حساب هنوز در حال اجراست.', 429, {
      'Retry-After': '2',
    });
  }

  try {
    const response = await streamAgentResponse({
      messages,
      tools,
      collector,
      approvalScope,
      abortSignal: request.signal,
    });
    return releaseWhenFinished(response, release);
  } catch {
    release();
    return jsonError('سرویس هوش مصنوعی در دسترس نیست یا درست تنظیم نشده است.', 503);
  }
}
