/**
 *   node --import ./scripts/register-ts.mjs --test src/lib/ai/context.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage } from 'ai';

const { compactModelContext, MAX_MODEL_CONTEXT_TURNS } = (await import(
  new URL('context.ts', import.meta.url).href
)) as typeof import('./context');

function user(text: string): ModelMessage {
  return { role: 'user', content: text };
}

function assistant(text: string): ModelMessage {
  return { role: 'assistant', content: text };
}

function toolExchange(id: string, output: string): ModelMessage[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: id, toolName: 'searchDocs', input: {} }],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: id, toolName: 'searchDocs', output }],
    },
  ] as ModelMessage[];
}

test('old tool payloads are pruned while the latest two turns stay usable', () => {
  const messages: ModelMessage[] = [
    user('old'),
    ...toolExchange('old-tool', 'large old logs'),
    assistant('old summary'),
    user('previous'),
    ...toolExchange('previous-tool', 'needed previous state'),
    assistant('previous summary'),
    user('current'),
    ...toolExchange('current-tool', 'fresh state'),
  ];

  const compacted = compactModelContext(messages);
  const json = JSON.stringify(compacted);
  assert.doesNotMatch(json, /large old logs|old-tool/);
  assert.match(json, /needed previous state|previous-tool/);
  assert.match(json, /fresh state|current-tool/);
  assert.match(json, /old summary/);
});

test('text history is limited by recent user turns', () => {
  const messages = Array.from({ length: MAX_MODEL_CONTEXT_TURNS + 5 }, (_, index) => [
    user(`user-${index}`),
    assistant(`assistant-${index}`),
  ]).flat();
  const compacted = compactModelContext(messages);
  const userMessages = compacted.filter((message) => message.role === 'user');

  assert.equal(userMessages.length, MAX_MODEL_CONTEXT_TURNS);
  assert.doesNotMatch(JSON.stringify(compacted), /user-0/);
  assert.match(JSON.stringify(compacted), new RegExp(`user-${MAX_MODEL_CONTEXT_TURNS + 4}`));
});

test('the newest turn is retained even when it exceeds the soft character budget', () => {
  const huge = 'x'.repeat(40_000);
  const compacted = compactModelContext([user('old'), assistant('old'), user(huge)]);
  assert.equal(compacted.length, 1);
  assert.equal(compacted[0].role, 'user');
  assert.equal(compacted[0].content, huge);
});
