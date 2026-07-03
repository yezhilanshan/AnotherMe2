import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createChatSlice, type ChatSlice } from './slices/chatSlice';
import { createSessionSlice, type SessionSlice } from './slices/sessionSlice';
import { createLearningSlice, type LearningSlice } from './slices/learningSlice';
import { getSafeStorage } from './safeStorage';
import type { Message } from './types';

// ── Persist 节流：流式对话期间每 90ms 触发一次 set()，
//    如果每次都写 AsyncStorage 会导致严重卡顿。
//    用 2 秒节流合并写入。 ──
const PERSIST_THROTTLE_MS = 2000;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Map<string, unknown>();
const MAX_STORED_MESSAGE_CHARS = 4000;
const MAX_RAW_PERSISTED_STATE_CHARS = 2_000_000;

function createThrottledStorage() {
  const rawStorage = getSafeStorage();
  const base = createJSONStorage(() => ({
    getItem: async (name: string) => sanitizePersistedState(await rawStorage.getItem(name)),
    setItem: rawStorage.setItem,
    removeItem: rawStorage.removeItem,
  }));
  if (!base) return undefined;
  return {
    getItem: base.getItem,
    setItem: (name: string, value: unknown) => {
      pendingWrites.set(name, value);
      if (!persistTimer) {
        persistTimer = setTimeout(() => {
          const writes = new Map(pendingWrites);
          pendingWrites.clear();
          persistTimer = null;
          writes.forEach((v, k) => base.setItem(k, v as any));
        }, PERSIST_THROTTLE_MS);
      }
    },
    removeItem: base.removeItem,
  };
}

export type StoreState = ChatSlice & SessionSlice & LearningSlice;

const MAX_PERSISTED_MESSAGE_SESSIONS = 5;
const MAX_PERSISTED_MESSAGES_PER_SESSION = 30;

function compactMessageForStorage(message: Message): Message {
  const storagePreviewOnly =
    message.storagePreviewOnly ||
    message.content.length > MAX_STORED_MESSAGE_CHARS;
  const storagePreview = storagePreviewOnly
    ? `${message.content.slice(0, MAX_STORED_MESSAGE_CHARS)}\n\n[本地缓存仅保存预览，打开会话后会从服务器加载完整内容]`
    : undefined;
  const contentPreview = storagePreview || message.contentPreview;
  return {
    ...message,
    content: storagePreview || message.content,
    contentPreview,
    fullContentRef:
      message.fullContentRef || message.serverMessageId || undefined,
    storagePreviewOnly,
    clientPreviewOnly: false,
    contentTruncated:
      Boolean(message.modelIncomplete) ||
      Boolean(message.serverCutoff) ||
      Boolean(message.historyPreviewOnly) ||
      storagePreviewOnly,
    reasoning: message.reasoning
      ? message.reasoning.slice(-1200)
      : message.reasoning,
    capabilityResult: undefined,
    renderMetrics: undefined,
    isStreaming: false,
  };
}

function persistableMessagesBySession(state: StoreState): Record<string, Message[]> {
  const sessionIds = new Set(
    state.sessions
      .slice(0, MAX_PERSISTED_MESSAGE_SESSIONS)
      .map((session) => session.id),
  );
  if (state.activeSessionId) sessionIds.add(state.activeSessionId);

  return Object.fromEntries(
    Object.entries(state.messagesBySession)
      .filter(([sessionId]) => sessionIds.has(sessionId))
      .map(([sessionId, messages]) => [
        sessionId,
        messages
          .slice(-MAX_PERSISTED_MESSAGES_PER_SESSION)
          .map(compactMessageForStorage),
      ]),
  );
}

function sanitizePersistedState(raw: string | null): string | null {
  if (!raw) return raw;
  if (raw.length > MAX_RAW_PERSISTED_STATE_CHARS) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state;
    if (!state || typeof state !== "object") return raw;
    const sessions = Array.isArray(state.sessions) ? state.sessions : [];
    const sessionIds = new Set(
      sessions
        .slice(0, MAX_PERSISTED_MESSAGE_SESSIONS)
        .map((session: { id?: unknown }) => session.id)
        .filter((id: unknown): id is string => typeof id === "string"),
    );
    if (typeof state.activeSessionId === "string") {
      sessionIds.add(state.activeSessionId);
    }

    const source =
      state.messagesBySession && typeof state.messagesBySession === "object"
        ? state.messagesBySession
        : {};
    const compacted = Object.fromEntries(
      Object.entries(source as Record<string, Message[]>)
        .filter(([sessionId]) => sessionIds.has(sessionId))
        .map(([sessionId, messages]) => [
          sessionId,
          Array.isArray(messages)
            ? messages
                .slice(-MAX_PERSISTED_MESSAGES_PER_SESSION)
                .map(compactMessageForStorage)
            : [],
        ]),
    );
    const activeMessages =
      typeof state.activeSessionId === "string"
        ? compacted[state.activeSessionId] || []
        : [];
    parsed.state = {
      ...state,
      messages: activeMessages,
      messagesBySession: compacted,
      isStreaming: false,
      currentAgent: null,
      error: null,
    };
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

export const useChatStore = create<StoreState>()(
  persist(
    (...a) => ({
      ...createChatSlice(...a),
      ...createSessionSlice(...a),
      ...createLearningSlice(...a),
    }),
    {
      name: '@anotherme/store',
      storage: createThrottledStorage(),
      partialize: state => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        messagesBySession: persistableMessagesBySession(state),
        selectedModel: state.selectedModel,
        selectedCapability: state.selectedCapability,
        learningContext: {
          l1: state.learningContext.l1,
          l2: state.learningContext.l2,
          reviewPlan: state.learningContext.reviewPlan,
          l3: { records: [], stats: null },
        },
      }),
    },
  ),
);

export type { Message } from './types';
