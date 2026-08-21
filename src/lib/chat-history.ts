"use client";

import { openDB, type DBSchema } from "idb";
import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

const DATABASE_NAME = "liara-copilot";
const STORE_NAME = "chat-history";
const CURRENT_CHAT_KEY = "current" as const;
const MAX_STORED_MESSAGES = 80;
const WRITE_DELAY_MS = 350;

type StoredChat = {
  version: 1;
  updatedAt: string;
  messages: UIMessage[];
};

interface ChatHistoryDatabase extends DBSchema {
  "chat-history": {
    key: typeof CURRENT_CHAT_KEY;
    value: StoredChat;
  };
}

export type ChatHistorySnapshot = {
  ready: boolean;
  messages: UIMessage[];
};

const INITIAL_SNAPSHOT: ChatHistorySnapshot = {
  ready: false,
  messages: [],
};

let snapshot = INITIAL_SNAPSHOT;
let loadPromise: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMessages: UIMessage[] = [];
let writeQueue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function database() {
  return openDB<ChatHistoryDatabase>(DATABASE_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedMessage(value: unknown): value is UIMessage {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    !Array.isArray(value.parts)
  ) {
    return false;
  }

  return value.parts.every((part) => {
    if (!isRecord(part) || typeof part.type !== "string") return false;
    if (part.type === "text") return typeof part.text === "string";
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      return (
        typeof part.toolCallId === "string" && typeof part.state === "string"
      );
    }
    return true;
  });
}

function isCompletedAssistantMessage(message: UIMessage): boolean {
  if (message.role !== "assistant") return false;

  if (
    message.parts.some(
      (part) =>
        (part.type === "text" && part.state === "streaming") ||
        (isToolUIPart(part) &&
          [
            "input-streaming",
            "input-available",
            "approval-requested",
            "approval-responded",
          ].includes(part.state)),
    )
  ) {
    return false;
  }

  // These are exactly the predicates used by ChatSession's automatic
  // continuation. Never mount useChat with a trailing message that satisfies
  // either predicate, even if the browser database was edited manually.
  const singleton = [message];
  return !(
    lastAssistantMessageIsCompleteWithApprovalResponses({
      messages: singleton,
    }) ||
    lastAssistantMessageIsCompleteWithToolCalls({ messages: singleton })
  );
}

function withoutApprovalArtifacts(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part) || !("approval" in part)) return part;
      const safePart = { ...part } as Record<string, unknown>;
      delete safePart.approval;
      return safePart as typeof part;
    }),
  };
}

/**
 * Keep complete user/assistant turns only. System messages, dangling prompts,
 * partial streams and approval/tool states that could auto-continue are dropped.
 */
export function messagesSafeForPersistence(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) return [];
  const messages = value.filter(isPersistedMessage);
  const completed: UIMessage[] = [];
  let pendingUser: UIMessage | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }

    if (pendingUser && isCompletedAssistantMessage(message)) {
      completed.push(pendingUser, withoutApprovalArtifacts(message));
    }
    pendingUser = null;
  }

  return completed.slice(-MAX_STORED_MESSAGES);
}

function publish(messages: UIMessage[]) {
  snapshot = { ready: true, messages };
  for (const listener of listeners) listener();
}

export function subscribeToChatHistory(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatHistorySnapshot() {
  return snapshot;
}

export function getServerChatHistorySnapshot() {
  return INITIAL_SNAPSHOT;
}

/** Load once, falling back to an empty chat when IndexedDB is unavailable. */
export function loadChatHistory(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const db = await database();
      const stored = await db.get(STORE_NAME, CURRENT_CHAT_KEY);
      publish(
        stored?.version === 1
          ? messagesSafeForPersistence(stored.messages)
          : [],
      );
    } catch {
      publish([]);
    }
  })();

  return loadPromise;
}

/** Debounce writes so streaming tokens do not cause one IndexedDB write each. */
export function scheduleChatHistorySave(messages: UIMessage[]) {
  pendingMessages = messagesSafeForPersistence(messages);
  if (writeTimer) clearTimeout(writeTimer);

  writeTimer = setTimeout(() => {
    writeTimer = null;
    const messagesToSave = pendingMessages;

    writeQueue = writeQueue.then(async () => {
      try {
        const db = await database();
        if (messagesToSave.length === 0) {
          await db.delete(STORE_NAME, CURRENT_CHAT_KEY);
        } else {
          await db.put(
            STORE_NAME,
            {
              version: 1,
              updatedAt: new Date().toISOString(),
              messages: messagesToSave,
            },
            CURRENT_CHAT_KEY,
          );
        }
        if (messagesToSave === pendingMessages) publish(messagesToSave);
      } catch {
        // Storage can be blocked in private mode; the in-memory chat still works.
      }
    });
  }, WRITE_DELAY_MS);
}

export async function clearChatHistory() {
  pendingMessages = [];
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }

  writeQueue = writeQueue.then(async () => {
    try {
      const db = await database();
      await db.delete(STORE_NAME, CURRENT_CHAT_KEY);
    } catch {
      // Keep clearing the visible in-memory chat even when storage is unavailable.
    }
  });
  await writeQueue;
  publish([]);
}
