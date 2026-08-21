import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isToolUIPart,
  isStepCount,
  smoothStream,
  streamText,
  toUIMessageStream,
  type InferUITools,
  type InferUIMessageChunk,
  type UIDataTypes,
  type UIMessage,
} from 'ai';

import type { DocsTools, LiaraTools } from './tools';
import { activeToolsForTurn, type ToolName } from './capability';
import { compactModelContext } from './context';
import { summarize, type UsageMeta } from './cost';
import { createToolApprovalPolicy, getScopedToolApprovalSecret } from './approval';
import { systemPromptFor } from './prompts';
import { createUsageCollector, modelFor, type UsageCollector } from './provider';
import { isContinuationMessage, route, type RouteDecision } from './router';

export type ChatMessageMetadata = {
  createdAt: string;
  route: Pick<RouteDecision, 'escalation' | 'tier' | 'routingReason' | 'decidedBy'>;
  usage?: UsageMeta;
  baselineToman?: number;
};

export type ChatMessage = UIMessage<
  ChatMessageMetadata,
  UIDataTypes,
  InferUITools<LiaraTools>
>;
type ChatChunk = InferUIMessageChunk<ChatMessage>;

export const MAX_USER_MESSAGE_CHARS = 4_000;

export const GENERATION_BUDGETS = {
  1: { reasoning: 'none' as const, maxOutputTokens: 1_600 },
  2: { reasoning: 'low' as const, maxOutputTokens: 2_400 },
  3: { reasoning: 'medium' as const, maxOutputTokens: 4_096 },
} satisfies Record<RouteDecision['escalation'], {
  reasoning: 'none' | 'low' | 'medium';
  maxOutputTokens: number;
}>;

/** Pace fast provider bursts into a calm, readable word-by-word stream. */
export const STREAM_SMOOTHING = {
  delayInMs: 30,
  chunking: 'word',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A docs lookup is reusable only when it actually returned evidence. */
export function usefulToolOutput(toolName: string, output: unknown): boolean {
  if (toolName !== 'searchDocs') {
    return output !== undefined && (!isRecord(output) || output.ok !== false);
  }
  if (!isRecord(output) || output.ok !== true || !isRecord(output.data)) return false;
  const sources = Array.isArray(output.data.sources)
    ? output.data.sources
    : Array.isArray(output.data.hits)
      ? output.data.hits
      : [];
  return sources.length > 0;
}

/** Same-request counterpart to `completedToolSinceLatestUser`. */
export function completedUsefulToolInSteps(
  steps: readonly {
    toolResults: readonly { toolName: string; output: unknown }[];
  }[],
  expectedToolName: string,
): boolean {
  return steps.some((step) =>
    step.toolResults.some(
      (result) =>
        result.toolName === expectedToolName &&
        usefulToolOutput(result.toolName, result.output),
    ),
  );
}

/**
 * Automatic tool continuations can arrive in a fresh HTTP request. Check the
 * complete current user turn, not only `streamText`'s in-request step array,
 * before paying for the same successful lookup again.
 */
export function completedToolSinceLatestUser(
  messages: readonly ChatMessage[],
  expectedToolName: string,
): boolean {
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  if (latestUserIndex < 0) return false;

  return messages.slice(latestUserIndex + 1).some((message) =>
    message.parts.some((part) => {
      if (!isToolUIPart(part) || part.state !== 'output-available') return false;
      const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5);
      return name === expectedToolName && usefulToolOutput(name, part.output);
    }),
  );
}

/** Extract text without trusting client-supplied message metadata. */
export function latestUserText(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;

    const text = message.parts
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    return text || null;
  }
  return null;
}

function previousUserText(messages: readonly ChatMessage[]): string | null {
  let seenLatest = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    if (!seenLatest) {
      seenLatest = true;
      continue;
    }
    return message.parts
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim() || null;
  }
  return null;
}

function approvalSecret(scope: string): string | undefined {
  try {
    return getScopedToolApprovalSecret(scope);
  } catch {
    // The approval policy independently sees the invalid value and denies all
    // writes. Omitting it here also prevents unsigned approvals being trusted.
    return undefined;
  }
}

const safeStreamError = () =>
  'پاسخ کامل نشد. اتصال مدل را بررسی کنید و دوباره تلاش کنید.';

export type StreamAgentOptions = {
  messages: ChatMessage[];
  tools: LiaraTools | DocsTools;
  approvalScope: string;
  abortSignal?: AbortSignal;
  collector?: UsageCollector;
  /** Additional hard ceiling, used by anonymous sessions to expose docs only. */
  allowedTools?: readonly ToolName[];
  /** Trusted server-authored mode context; never populated from request text. */
  operatingModeInstructions?: string;
  /** Public sessions discard client-returned tool evidence before model use. */
  acceptToolHistory?: boolean;
};

export function textOnlyMessageHistory(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    const parts = message.parts.filter(
      (part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text',
    );
    return parts.length > 0 ? [{ ...message, parts }] : [];
  });
}

export function narrowToolsForRequest(
  level: RouteDecision['escalation'],
  userText: string,
  registeredToolNames: readonly string[],
  allowedTools?: readonly ToolName[],
): ToolName[] {
  const registered = new Set(registeredToolNames);
  const allowed = allowedTools ? new Set<ToolName>(allowedTools) : null;
  return [...activeToolsForTurn(level, userText)].filter(
    (name) => registered.has(name) && (allowed === null || allowed.has(name)),
  );
}

/**
 * Run one routed turn and return the AI SDK v7 UI-message stream response.
 * `streamText` is used directly because ToolLoopAgent does not expose the HMAC
 * approval secret in the installed SDK version.
 */
export async function streamAgentResponse({
  messages,
  tools,
  approvalScope,
  abortSignal,
  collector = createUsageCollector(),
  allowedTools,
  operatingModeInstructions,
  acceptToolHistory = true,
}: StreamAgentOptions): Promise<Response> {
  // AI SDK validation accepts unknown historical tool parts for forward
  // compatibility. In a public docs session those parts are client-controlled,
  // so keep conversational text but never treat returned tool payloads as fact.
  const trustedMessages = acceptToolHistory ? messages : textOnlyMessageHistory(messages);
  const userText = latestUserText(trustedMessages);
  if (!userText) throw new TypeError('A text user message is required');
  if (userText.length > MAX_USER_MESSAGE_CHARS) {
    throw new RangeError(`User message exceeds ${MAX_USER_MESSAGE_CHARS} characters`);
  }

  // Continuity is reconstructed from the prior user text, never from
  // client-supplied assistant metadata. Most prior turns route heuristically
  // for zero tokens, and we only reroute one when the new message is terse.
  const priorText = isContinuationMessage(userText) ? previousUserText(trustedMessages) : null;
  const priorDecision = priorText
    ? await route(priorText.slice(0, MAX_USER_MESSAGE_CHARS), { collector })
    : undefined;
  const decision = await route(userText, {
    collector,
    previousLevel: priorDecision?.escalation,
  });
  // Make the chosen route observable even if the answer stream later aborts.
  // Tool count is replaced with the final value by summarize().
  collector.summary = {
    tier: decision.tier,
    escalation: decision.escalation,
    toolCalls: 0,
  };
  const docsAlreadySearched = completedToolSinceLatestUser(trustedMessages, 'searchDocs');
  const diagnosisAlreadyReported = completedToolSinceLatestUser(
    trustedMessages,
    'reportDiagnosis',
  );
  const activeTools = narrowToolsForRequest(
    decision.escalation,
    userText,
    Object.keys(tools),
    allowedTools,
  ).filter(
    (name) =>
      !(docsAlreadySearched && name === 'searchDocs') &&
      !(diagnosisAlreadyReported && name === 'reportDiagnosis'),
  );
  const createdAt = new Date().toISOString();
  const routeMetadata: ChatMessageMetadata = {
    createdAt,
    route: {
      escalation: decision.escalation,
      tier: decision.tier,
      routingReason: decision.routingReason,
      decidedBy: decision.decidedBy,
    },
  };
  const generationBudget = GENERATION_BUDGETS[decision.escalation];

  // ChatMessage carries the full connected-session UI tool vocabulary so a
  // saved conversation remains type-stable. Anonymous runtime registries are a
  // strict subset, and `activeTools` below is intersected with their real keys
  // before the SDK sees them; this assertion never adds a missing runtime tool.
  const runtimeTools = tools as LiaraTools;

  const modelMessages = compactModelContext(await convertToModelMessages(trustedMessages, {
    tools: runtimeTools,
  }));
  const result = streamText({
    model: modelFor(decision.tier, collector),
    instructions: [
      systemPromptFor(decision.escalation, userText),
      operatingModeInstructions,
    ].filter(Boolean).join('\n\n'),
    messages: modelMessages,
    ...generationBudget,
    tools: runtimeTools,
    activeTools,
    prepareStep: ({ steps }) => {
      const alreadySearchedDocs = completedUsefulToolInSteps(steps, 'searchDocs');
      const alreadyReportedDiagnosis = completedUsefulToolInSteps(
        steps,
        'reportDiagnosis',
      );
      return {
        activeTools: activeTools.filter(
          (name) =>
            !(alreadySearchedDocs && name === 'searchDocs') &&
            !(alreadyReportedDiagnosis && name === 'reportDiagnosis'),
        ),
      };
    },
    stopWhen: isStepCount(decision.maxSteps),
    toolApproval: createToolApprovalPolicy(process.env, activeTools, approvalScope),
    experimental_toolApprovalSecret: approvalSecret(approvalScope),
    abortSignal,
    maxRetries: 1,
    experimental_transform: smoothStream(STREAM_SMOOTHING),
    // The SDK default logs raw provider errors. Keep credentials and upstream
    // bodies out of server logs; the UI stream gets a fixed safe message below.
    onError: () => {
      collector.streamFailed = true;
    },
  });

  const baseStream = toUIMessageStream<LiaraTools, ChatMessage>({
    stream: result.stream,
    tools: runtimeTools,
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
    sendReasoning: false,
    sendSources: true,
    sendFinish: false,
    onError: safeStreamError,
    messageMetadata: ({ part }) => (part.type === 'start' ? routeMetadata : undefined),
  });

  // Append final accounting only after both the model stream and Liara's
  // separately observed billing SSE have completed. This keeps cost real while
  // preserving token-by-token streaming.
  const enrichedStream = baseStream.pipeThrough(
    new TransformStream<ChatChunk, ChatChunk>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      async flush(controller) {
        try {
          const toolCalls = await result.toolCalls;
          const usage = await summarize(collector, {
            tier: decision.tier,
            escalation: decision.escalation,
            routingReason: decision.routingReason,
            toolCalls: toolCalls.length,
          });
          const metadata: ChatMessageMetadata = {
            ...routeMetadata,
            usage,
            baselineToman: usage.baselineToman || undefined,
          };

          controller.enqueue({ type: 'message-metadata', messageMetadata: metadata });
          controller.enqueue({
            type: 'finish',
            finishReason: await result.finishReason,
            messageMetadata: metadata,
          });
        } catch {
          // The answer is still useful if accounting failed. Close with the
          // already-sent routing metadata and never expose provider errors.
          controller.enqueue({ type: 'finish', messageMetadata: routeMetadata });
        }
      },
    }),
  );

  return createUIMessageStreamResponse({
    stream: enrichedStream,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
