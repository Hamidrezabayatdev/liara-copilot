/**
 * Layer 2 of the tool security model: default-deny approval policy.
 *
 * AI SDK v7 treats an absent/undefined approval decision as
 * `not-applicable`, which executes an executable tool immediately. This module
 * therefore returns an explicit object decision on every path and catches all
 * policy errors. The HTTP allow-list remains the final security boundary, but
 * this layer independently feeds every Liara probe back through `classify()`.
 */

import { createHmac } from 'node:crypto';

import type {
  GenericToolApprovalFunction,
  ToolApprovalStatus,
  ToolSet,
} from 'ai';
import { classify } from '../liara/allowlist';
import type { OpKind, Product } from '../liara/types';

export type ToolProbe =
  | {
      scope: 'liara';
      product: Product;
      method: string;
      path: string;
    }
  | { scope: 'local'; operation: 'searchDocs' | 'reportDiagnosis' }
  | { scope: 'client'; operation: 'askUser' };

/** Minimal structural contract expected on every trusted tool definition. */
export type ApprovalToolMetadata<INPUT = unknown> = {
  readonly kind: OpKind;
  readonly probe: (input: INPUT) => ToolProbe | Promise<ToolProbe>;
};

/** `never` permits a heterogeneous registry whose probes have typed inputs. */
export type ApprovalToolRegistry = Readonly<
  Record<string, ApprovalToolMetadata<never>>
>;

export type ApprovalSecretEnvironment = Readonly<
  Record<string, string | undefined>
>;

type ApprovalDecision = Exclude<ToolApprovalStatus, string | undefined>;

type ApprovalPolicyOptions = {
  toolCall: {
    toolCallId?: string;
    toolName: string;
    input: unknown;
    dynamic?: boolean;
    providerExecuted?: boolean;
  };
  tools: Readonly<Record<string, unknown>> | undefined;
  messages?: readonly unknown[];
};

export type ToolApprovalPolicy = (
  options: ApprovalPolicyOptions,
) => Promise<ApprovalDecision>;

const VALID_KINDS = new Set<OpKind>([
  'read',
  'reversible-write',
  'destructive',
  'unknown',
]);

const PRODUCTS = new Set<Product>(['paas', 'dbaas', 'dns', 'storage']);
const CONSUMED_APPROVAL_TTL_MS = 8 * 60 * 60 * 1_000;
const MAX_CONSUMED_APPROVALS = 10_000;
const consumedApprovals = new Map<string, number>();

// Unknown is ranked above destructive because neither is executable and an
// unmatched operation must never be made less strict by a declared label.
const RISK_RANK: Record<OpKind, number> = {
  read: 0,
  'reversible-write': 1,
  destructive: 2,
  unknown: 3,
};

const deny = (reason: string): ApprovalDecision => ({
  type: 'denied',
  reason,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isKind(value: unknown): value is OpKind {
  return typeof value === 'string' && VALID_KINDS.has(value as OpKind);
}

function isProduct(value: unknown): value is Product {
  return typeof value === 'string' && PRODUCTS.has(value as Product);
}

function stricterKind(declared: OpKind, derived: OpKind): OpKind {
  return RISK_RANK[declared] >= RISK_RANK[derived] ? declared : derived;
}

/**
 * Read and validate the secret passed to AI SDK v7's
 * `experimental_toolApprovalSecret` option.
 *
 * A missing value is returned as `undefined` so the caller can still serve
 * read-only turns. A configured but undersized value is a configuration error;
 * the approval policy catches it and denies every write.
 */
export function getToolApprovalSecret(
  env: ApprovalSecretEnvironment = process.env,
): string | undefined {
  const secret = env.TOOL_APPROVAL_SECRET;
  if (secret == null || secret.length === 0) return undefined;

  if (typeof secret !== 'string') {
    throw new Error('TOOL_APPROVAL_SECRET must be a string');
  }

  const byteLength = new TextEncoder().encode(secret).byteLength;
  if (byteLength < 32) {
    throw new Error('TOOL_APPROVAL_SECRET must contain at least 32 bytes');
  }

  return secret;
}

/**
 * Scope AI SDK approval signatures to one Liara account. A signature captured
 * from one account therefore fails verification for every other account even
 * when resource names and tool input happen to match.
 */
export function getScopedToolApprovalSecret(
  scope: string,
  env: ApprovalSecretEnvironment = process.env,
): string | undefined {
  const secret = getToolApprovalSecret(env);
  if (secret === undefined) return undefined;
  if (!scope) throw new TypeError('an approval account scope is required');
  return createHmac('sha256', secret)
    .update('liara-copilot:tool-approval:v1\0')
    .update(scope)
    .digest('base64url');
}

function approvedResponseId(
  messages: readonly unknown[] | undefined,
  toolCallId: string | undefined,
): string | null {
  if (!messages || !toolCallId) return null;
  const approvalIds = new Set<string>();

  for (const value of messages) {
    if (!isRecord(value) || value.role !== 'assistant' || !Array.isArray(value.content)) {
      continue;
    }
    for (const part of value.content) {
      if (
        isRecord(part) &&
        part.type === 'tool-approval-request' &&
        part.toolCallId === toolCallId &&
        typeof part.approvalId === 'string'
      ) {
        approvalIds.add(part.approvalId);
      }
    }
  }

  for (const value of messages) {
    if (!isRecord(value) || value.role !== 'tool' || !Array.isArray(value.content)) {
      continue;
    }
    for (const part of value.content) {
      if (
        isRecord(part) &&
        part.type === 'tool-approval-response' &&
        part.approved === true &&
        typeof part.approvalId === 'string' &&
        approvalIds.has(part.approvalId)
      ) {
        return part.approvalId;
      }
    }
  }
  return null;
}

function consumeApprovalOnce(scope: string, approvalId: string, toolCallId: string): boolean {
  const now = Date.now();
  for (const [key, expiresAt] of consumedApprovals) {
    if (expiresAt <= now) consumedApprovals.delete(key);
  }
  while (consumedApprovals.size >= MAX_CONSUMED_APPROVALS) {
    const oldest = consumedApprovals.keys().next().value;
    if (typeof oldest !== 'string') break;
    consumedApprovals.delete(oldest);
  }

  const key = `${scope}\0${approvalId}\0${toolCallId}`;
  if (consumedApprovals.has(key)) return false;
  consumedApprovals.set(key, now + CONSUMED_APPROVAL_TTL_MS);
  return true;
}

function deriveKind(toolName: string, probe: unknown): OpKind | ApprovalDecision {
  if (!isRecord(probe) || !hasOwn(probe, 'scope')) {
    return deny(`Tool "${toolName}" returned malformed approval metadata.`);
  }

  if (probe.scope === 'liara') {
    if (
      !isProduct(probe.product) ||
      typeof probe.method !== 'string' ||
      typeof probe.path !== 'string'
    ) {
      return deny(`Tool "${toolName}" returned malformed Liara probe metadata.`);
    }

    return classify(probe.product, probe.method, probe.path);
  }

  // These are the only operations that do not go through the Liara HTTP
  // client. Bind both the name and operation so another tool cannot borrow a
  // trusted local/client probe.
  if (probe.scope === 'local') {
    const matches =
      (toolName === 'searchDocs' && probe.operation === 'searchDocs') ||
      (toolName === 'reportDiagnosis' && probe.operation === 'reportDiagnosis');
    return matches
      ? 'read'
      : deny(`Tool "${toolName}" does not match its local probe metadata.`);
  }

  if (probe.scope === 'client') {
    return toolName === 'askUser' && probe.operation === 'askUser'
      ? 'read'
      : deny(`Tool "${toolName}" does not match its client probe metadata.`);
  }

  return deny(`Tool "${toolName}" returned an unmatched approval probe.`);
}

/**
 * Build the AI SDK generic `toolApproval` callback. Supplying an environment is
 * useful for deterministic tests; production uses the live server environment.
 */
export function createToolApprovalPolicy(
  env: ApprovalSecretEnvironment = process.env,
  allowedToolNames?: readonly string[],
  approvalScope?: string,
): ToolApprovalPolicy {
  const allowed = allowedToolNames ? new Set(allowedToolNames) : null;

  return async options => {
    let toolName = '<unknown>';
    try {
      const { toolCall, tools } = options;
      if (!toolCall || typeof toolCall.toolName !== 'string') {
        return deny('Malformed tool call is not allowed.');
      }
      toolName = toolCall.toolName;

      // Approval responses arrive in client-controlled history and are
      // revalidated before prepareStep runs. Re-assert this turn's capability
      // ceiling here so an old L3 approval cannot execute during an L1 turn.
      if (allowed && !allowed.has(toolName)) {
        return deny(`Tool "${toolName}" is outside this turn's capability set.`);
      }

      if (toolCall.dynamic) {
        return deny(`Dynamic tool call "${toolName}" is not allowed.`);
      }

      if (toolCall.providerExecuted) {
        return deny(`Provider-executed tool "${toolName}" is not allowed.`);
      }

      if (!tools || !hasOwn(tools, toolName)) {
        return deny(`Unknown tool "${toolName}" is not allowed.`);
      }

      const tool = tools[toolName];
      if (
        !isRecord(tool) ||
        !hasOwn(tool, 'kind') ||
        !hasOwn(tool, 'probe')
      ) {
        return deny(`Tool "${toolName}" has invalid approval metadata.`);
      }

      // Snapshot both own properties so accessors or a probe that mutates its
      // tool definition cannot create a check/use discrepancy.
      const declaredKind = tool.kind;
      const probeTool = tool.probe;
      if (!isKind(declaredKind) || typeof probeTool !== 'function') {
        return deny(`Tool "${toolName}" has invalid approval metadata.`);
      }

      const probe = await probeTool(toolCall.input);
      const derived = deriveKind(toolName, probe);
      if (typeof derived !== 'string') return derived;

      // `askUser` is the one client-fulfilled tool and deliberately has no
      // execute function. Marking it approved would move AI SDK UI state to
      // `approval-responded`; not-applicable leaves it at `input-available` so
      // useChat can supply the user's answer with addToolOutput.
      if (
        toolName === 'askUser' &&
        isRecord(probe) &&
        probe.scope === 'client' &&
        probe.operation === 'askUser'
      ) {
        return declaredKind === 'read' && typeof tool.execute !== 'function'
          ? { type: 'not-applicable' }
          : deny('Client tool "askUser" must not have a server execute function.');
      }

      // Trust neither side by itself. A declared read whose probe is a write,
      // or a declared write whose probe is a read, is treated as a write.
      const effective = stricterKind(declaredKind, derived);

      if (effective === 'read') {
        return {
          type: 'approved',
          reason: `Tool "${toolName}" was independently verified as read-only.`,
        };
      }

      if (effective === 'reversible-write') {
        let secret: string | undefined;
        try {
          secret = getToolApprovalSecret(env);
        } catch {
          return deny(
            'TOOL_APPROVAL_SECRET is invalid; reversible writes are disabled (minimum 32 bytes).',
          );
        }

        if (secret === undefined) {
          return deny(
            'TOOL_APPROVAL_SECRET is not configured; reversible writes are disabled.',
          );
        }

        const approvalId = approvedResponseId(options.messages, toolCall.toolCallId);
        if (approvalId && approvalScope) {
          if (!consumeApprovalOnce(approvalScope, approvalId, toolCall.toolCallId!)) {
            return deny('This tool approval was already consumed and cannot be replayed.');
          }
        }

        return { type: 'user-approval' };
      }

      return deny(
        effective === 'destructive'
          ? `Tool "${toolName}" resolved to a destructive operation and is hard-blocked.`
          : `Tool "${toolName}" is not on the operation allow-list (default deny).`,
      );
    } catch {
      // Do not expose arbitrary probe exception messages: probes may include
      // request data, and approval reasons are returned to the client/model.
      return deny(`Approval policy failed closed while validating tool "${toolName}".`);
    }
  };
}

/** Ready to pass as AI SDK v7's `toolApproval` option. */
export const toolApproval = createToolApprovalPolicy() satisfies GenericToolApprovalFunction<
  ToolSet,
  never,
  unknown
>;
