/**
 * Model-context budgeting that leaves the persisted UI conversation untouched.
 * The browser can still render the complete history; only redundant material in
 * the provider request is removed.
 */
import { pruneMessages, type ModelMessage } from 'ai';

export const MAX_MODEL_CONTEXT_TURNS = 12;
export const MAX_MODEL_CONTEXT_CHARS = 32_000;

function serializedLength(message: ModelMessage): number {
  try {
    return JSON.stringify(message).length;
  } catch {
    return MAX_MODEL_CONTEXT_CHARS;
  }
}

function recentTurnBlocks(messages: readonly ModelMessage[]): ModelMessage[][] {
  const blocks: ModelMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || blocks.length === 0) blocks.push([]);
    blocks.at(-1)!.push(message);
  }
  return blocks;
}

/**
 * Keep tool observations for the latest two user turns and text for a bounded
 * recent history. Current approval/tool chains remain intact, while old logs,
 * metrics and documentation excerpts stop being re-billed on every message.
 */
export function compactModelContext(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return [];

  const userIndexes = messages
    .map((message, index) => (message.role === 'user' ? index : -1))
    .filter((index) => index >= 0);
  const keepToolsFrom = userIndexes.at(-2) ?? userIndexes.at(-1) ?? messages.length - 1;
  const keepMessageCount = Math.max(1, messages.length - keepToolsFrom);

  const withoutOldTraces = pruneMessages({
    messages,
    reasoning: 'all',
    toolCalls: `before-last-${keepMessageCount}-messages`,
  });
  const blocks = recentTurnBlocks(withoutOldTraces);
  const selected: ModelMessage[][] = [];
  let chars = 0;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (selected.length >= MAX_MODEL_CONTEXT_TURNS) break;
    const block = blocks[index];
    const blockChars = block.reduce((sum, message) => sum + serializedLength(message), 0);
    // The newest turn is mandatory even when a single fresh tool result exceeds
    // the soft budget. Older context is admitted only while it fits.
    if (selected.length > 0 && chars + blockChars > MAX_MODEL_CONTEXT_CHARS) break;
    selected.unshift(block);
    chars += blockChars;
  }

  return selected.flat();
}
