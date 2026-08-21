/**
 * Persistence safety tests. Run with:
 *   node --import ./scripts/register-ts.mjs --test src/lib/chat-history.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";

const { messagesSafeForPersistence } = (await import(
  new URL("chat-history.ts", import.meta.url).href
)) as typeof import("./chat-history");

const user = (id: string, text = "سلام"): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistant = (id: string, text = "پاسخ"): UIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text, state: "done" }],
});

test("stores completed turns and drops system or dangling user messages", () => {
  const result = messagesSafeForPersistence([
    { id: "system", role: "system", parts: [{ type: "text", text: "secret" }] },
    user("user-1"),
    assistant("assistant-1"),
    user("user-2", "هنوز پاسخی نیست"),
  ]);

  assert.deepEqual(
    result.map((message) => message.id),
    ["user-1", "assistant-1"],
  );
});

test("drops a turn with a pending write approval", () => {
  const pendingWrite = {
    id: "assistant-write",
    role: "assistant",
    parts: [
      {
        type: "tool-restartApp",
        toolCallId: "restart-1",
        state: "approval-requested",
        input: { appName: "demo" },
        approval: { id: "signed-approval" },
      },
    ],
  } satisfies UIMessage;

  assert.deepEqual(
    messagesSafeForPersistence([user("user-write"), pendingWrite]),
    [],
  );
});

test("drops a trailing tool result that would auto-continue on interaction", () => {
  const waitingForModel = {
    id: "assistant-tool",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-listApps",
        toolCallId: "list-1",
        state: "output-available",
        input: {},
        output: { ok: true },
      },
    ],
  } satisfies UIMessage;

  assert.deepEqual(
    messagesSafeForPersistence([user("user-tool"), waitingForModel]),
    [],
  );
});

test("keeps a completed tool turn whose last step is final text", () => {
  const completedToolTurn = {
    id: "assistant-complete",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-listApps",
        toolCallId: "list-1",
        state: "output-available",
        input: {},
        output: { ok: true },
      },
      { type: "step-start" },
      { type: "text", text: "دو اپلیکیشن پیدا شد.", state: "done" },
    ],
  } satisfies UIMessage;

  assert.deepEqual(
    messagesSafeForPersistence([user("user-complete"), completedToolTurn]).map(
      (message) => message.id,
    ),
    ["user-complete", "assistant-complete"],
  );
});

test("removes approval ids and signatures from an otherwise completed turn", () => {
  const completedWrite = {
    id: "assistant-write-complete",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-restartApp",
        toolCallId: "restart-complete",
        state: "output-available",
        input: { appName: "demo" },
        output: { ok: true },
        approval: {
          id: "approval-secret-id",
          approved: true,
          signature: "signed-value-must-not-persist",
        },
      },
      { type: "step-start" },
      { type: "text", text: "اپلیکیشن ری‌استارت شد.", state: "done" },
    ],
  } satisfies UIMessage;

  const result = messagesSafeForPersistence([user("user-write-done"), completedWrite]);
  const toolPart = result[1]?.parts.find((part) => part.type === "tool-restartApp");
  assert.ok(toolPart);
  assert.equal("approval" in toolPart, false);
});
