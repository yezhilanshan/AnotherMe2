import type { StateCreator } from "zustand";
import { api } from "../api";
import { streamChatWithRetry } from "../streaming";
import type { StreamEvent } from "../streaming";
import type { Message } from "../types";
import { USER_ID, DEFAULT_MODEL } from "../config";
import { buildSystemPrompt } from "../learningContext";
import type { StoreState } from "../store";
import { offlineQueue } from "../offline-queue";

export interface ChatSlice {
  messages: Message[];
  messagesBySession: Record<string, Message[]>;
  isStreaming: boolean;
  isOnline: boolean;
  error: string | null;
  currentAgent: string | null;
  selectedModel: string;
  selectedCapability: string;

  sendMessage: (text: string, capability?: string) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;
  clearError: () => void;
  submitFeedback: (
    messageId: string,
    rating: "like" | "dislike",
  ) => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedCapability: (capability: string) => void;
  setOnline: (online: boolean) => void;
  flushOfflineQueue: () => Promise<{ succeeded: number; failed: number }>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function messageFromRemote(raw: Record<string, unknown>): Message {
  return {
    id: (raw.message_id as string) || generateId(),
    serverMessageId: raw.message_id as string | undefined,
    role: raw.role === "user" ? "user" : "assistant",
    content: (raw.content as string) || "",
    timestamp: raw.created_at
      ? new Date(raw.created_at as string).getTime()
      : Date.now(),
  };
}

function persistableMessages(messages: Message[]): Message[] {
  return messages
    .filter(
      (m) =>
        m.role !== "assistant" ||
        m.content.trim() ||
        m.reasoning?.trim() ||
        m.capabilityResult,
    )
    .map((m) => ({ ...m, isStreaming: false }));
}

function saveMessagesForActiveSession(state: StoreState, messages: Message[]) {
  if (!state.activeSessionId) return {};
  const saved = persistableMessages(messages);
  return {
    messagesBySession: {
      ...state.messagesBySession,
      [state.activeSessionId]: saved,
    },
    sessions: state.sessions.map((s) =>
      s.id === state.activeSessionId
        ? { ...s, updated_at: new Date().toISOString() }
        : s,
    ),
  };
}

let abortController: AbortController | null = null;

// ── 节流：将高频 text_delta 合并后批量刷新 ──
let pendingContent = "";
let pendingReasoning = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 50; // ms — 50ms 刷新一次，平衡流畅度与性能

function flushPending(set: any) {
  if (!pendingContent && !pendingReasoning) return;
  const contentChunk = pendingContent;
  const reasoningChunk = pendingReasoning;
  pendingContent = "";
  pendingReasoning = "";

  set((state: any) => {
    const msgs = state.messages;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") return state;

    // 创建新的 message 对象（不可变）
    const updated = { ...last, content: last.content + contentChunk };
    if (reasoningChunk) {
      updated.reasoning = (updated.reasoning || "") + reasoningChunk;
    }
    return { messages: [...msgs.slice(0, -1), updated] };
  });
}

export const createChatSlice: StateCreator<StoreState, [], [], ChatSlice> = (
  set,
  get,
) => ({
  messages: [],
  messagesBySession: {},
  isStreaming: false,
  isOnline: true,
  error: null,
  currentAgent: null,
  selectedModel: DEFAULT_MODEL,
  selectedCapability: "",

  sendMessage: async (text: string, capability?: string) => {
    const {
      activeSessionId,
      learningContext,
      selectedModel,
      selectedCapability: storeCapability,
    } = get();
    const effectiveCapability = capability ?? storeCapability;

    if (!activeSessionId) {
      console.warn("[chat] 没有活跃会话，无法发送消息");
      set({ error: "请先创建一个对话" });
      return;
    }

    // Offline: queue the message and show it in UI as queued
    if (!get().isOnline) {
      offlineQueue.enqueue({
        type: "send_message",
        payload: {
          sessionId: activeSessionId,
          text,
          model: selectedModel,
          capability: effectiveCapability || undefined,
        },
      });

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        capability: effectiveCapability || undefined,
        queued: true,
      };

      set((state) => ({
        messages: [...state.messages, userMessage],
        error: null,
        ...saveMessagesForActiveSession(state, [
          ...state.messages,
          userMessage,
        ]),
      }));
      return;
    }

    // 自动命名
    const { sessions } = get();
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (activeSession && activeSession.title === "新对话") {
      const autoTitle = text.slice(0, 20) + (text.length > 20 ? "..." : "");
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === activeSessionId
            ? { ...s, title: autoTitle, updated_at: new Date().toISOString() }
            : s,
        ),
      }));
    }

    abortController?.abort();
    abortController = new AbortController();

    // 重置节流缓冲
    pendingContent = "";
    pendingReasoning = "";
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      capability: effectiveCapability || undefined,
    };

    const aiMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      isStreaming: true,
      timestamp: Date.now(),
      reasoning: "",
    };

    set((state) => ({
      messages: [...state.messages, userMessage, aiMessage],
      isStreaming: true,
      error: null,
      currentAgent: null,
    }));

    api.aiLearning
      .createSessionMessage(activeSessionId, {
        role: "user",
        content: text,
        user_id: USER_ID,
        model_name: selectedModel,
        request_id: userMessage.id,
      })
      .then((remote) => {
        const serverMessageId = (remote as Record<string, unknown>)
          .message_id as string | undefined;
        if (!serverMessageId) return;
        set((state) => {
          const nextMessages = state.messages.map((m) =>
            m.id === userMessage.id ? { ...m, serverMessageId } : m,
          );
          return {
            messages: nextMessages,
            ...saveMessagesForActiveSession(state, nextMessages),
          };
        });
      })
      .catch(() => {});

    const systemPrompt = buildSystemPrompt(learningContext);

    // 启动定时刷新
    flushTimer = setInterval(() => flushPending(set), FLUSH_INTERVAL);

    try {
      console.log(
        "[chat] 开始流式对话，capability:",
        effectiveCapability,
        "model:",
        selectedModel,
        "消息:",
        text.slice(0, 50),
      );
      await streamChatWithRetry({
        message: text,
        systemPrompt,
        model: selectedModel,
        capability: effectiveCapability || undefined,
        signal: abortController.signal,
        onEvent: (event: StreamEvent) => {
          if (event.type === "text_delta") {
            pendingContent += event.data?.content || "";
          } else if (event.type === "thinking") {
            const r = event.data?.reasoning || "";
            if (r) pendingReasoning += r;
          } else if (event.type === "agent_start") {
            set({ currentAgent: event.data?.agentName || event.data?.agentId });
          } else if (event.type === "capability_result") {
            flushPending(set);
            const resultData = event.data;
            set((state: any) => {
              const msgs = state.messages;
              const last = msgs[msgs.length - 1];
              if (!last || last.role !== "assistant") return state;
              const updated = {
                ...last,
                capabilityResult: {
                  output_mode: resultData.output_mode,
                  render_type: resultData.render_type,
                  artifacts: resultData.artifacts,
                  code: resultData.code,
                  analysis: resultData.analysis,
                  review: resultData.review,
                },
              };
              return { messages: [...msgs.slice(0, -1), updated] };
            });
          }
        },
        onComplete: () => {
          // 先刷新剩余缓冲
          flushPending(set);
          if (flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
          }

          // 标记流式结束 — 创建新的 message 对象
          set((state) => {
            const msgs = state.messages;
            const last = msgs[msgs.length - 1];
            if (!last || last.role !== "assistant") {
              return {
                isStreaming: false,
                currentAgent: null,
                ...saveMessagesForActiveSession(state, msgs),
              };
            }
            const updated = { ...last, isStreaming: false };
            const nextMessages = [...msgs.slice(0, -1), updated];
            return {
              messages: nextMessages,
              isStreaming: false,
              currentAgent: null,
              ...saveMessagesForActiveSession(state, nextMessages),
            };
          });

          // 更新 L1 工作记忆（用 get() 拿最新消息，避免数组拷贝）
          const msgs = get().messages;
          let lastUser: Message | undefined;
          let lastAi: Message | undefined;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (!lastAi && msgs[i].role === "assistant") lastAi = msgs[i];
            else if (!lastUser && msgs[i].role === "user") lastUser = msgs[i];
            if (lastUser && lastAi) break;
          }
          if (lastUser && lastAi) {
            const summary = `User: ${lastUser.content.slice(0, 100)} | AI: ${lastAi.content.slice(0, 200)}`;
            get().updateL1Summary(summary);
          }

          if (lastAi?.content.trim()) {
            api.aiLearning
              .createSessionMessage(activeSessionId, {
                role: "assistant",
                content: lastAi.content,
                user_id: USER_ID,
                model_name: selectedModel,
                request_id: lastAi.id,
                parent_message_id: lastUser?.serverMessageId,
              })
              .then((remote) => {
                const serverMessageId = (remote as Record<string, unknown>)
                  .message_id as string | undefined;
                if (!serverMessageId) return;
                set((state) => {
                  const nextMessages = state.messages.map((m) =>
                    m.id === lastAi.id ? { ...m, serverMessageId } : m,
                  );
                  return {
                    messages: nextMessages,
                    ...saveMessagesForActiveSession(state, nextMessages),
                  };
                });
              })
              .catch(() => {});
          }
        },
        onError: (error: Error) => {
          console.error("[chat] 流式对话错误:", error.message);
          if (flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
          }
          pendingContent = "";
          pendingReasoning = "";

          // 合并为单次 set
          set((state) => ({
            error: error.message,
            isStreaming: false,
            currentAgent: null,
            ...(() => {
              const nextMessages = state.messages.filter(
                (m) =>
                  !(m.role === "assistant" && m.content === "" && !m.reasoning),
              );
              return {
                messages: nextMessages,
                ...saveMessagesForActiveSession(state, nextMessages),
              };
            })(),
          }));
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("[chat] 对话异常:", error.message);
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = null;
        }
        pendingContent = "";
        pendingReasoning = "";
        set((state) => ({
          error: error.message,
          isStreaming: false,
          currentAgent: null,
          ...(() => {
            const nextMessages = state.messages.filter(
              (m) =>
                !(m.role === "assistant" && m.content === "" && !m.reasoning),
            );
            return {
              messages: nextMessages,
              ...saveMessagesForActiveSession(state, nextMessages),
            };
          })(),
        }));
      }
    }
  },

  loadMessages: async (sessionId: string) => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    pendingContent = "";
    pendingReasoning = "";
    const localMessages = get().messagesBySession[sessionId] || [];
    set({
      messages: localMessages,
      isStreaming: false,
      error: null,
      currentAgent: null,
    });
    try {
      const remote = await api.aiLearning.getSessionMessages(sessionId, 200);
      const remoteMessages = (remote as Record<string, unknown>[]).map(
        messageFromRemote,
      );
      if (remoteMessages.length > 0 || localMessages.length === 0) {
        set((state) => ({
          messages: remoteMessages,
          isStreaming: false,
          error: null,
          currentAgent: null,
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: persistableMessages(remoteMessages),
          },
        }));
      }
    } catch {
      // Gateway sync is best-effort; local messages remain usable.
    }
  },

  stopStreaming: () => {
    abortController?.abort();
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flushPending(set);
    pendingContent = "";
    pendingReasoning = "";

    set((state) => {
      const msgs = state.messages;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") {
        return {
          isStreaming: false,
          currentAgent: null,
          ...saveMessagesForActiveSession(state, msgs),
        };
      }
      const updated = { ...last, isStreaming: false };
      const nextMessages = [...msgs.slice(0, -1), updated];
      return {
        messages: nextMessages,
        isStreaming: false,
        currentAgent: null,
        ...saveMessagesForActiveSession(state, nextMessages),
      };
    });
  },

  clearMessages: () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    set((state) => ({
      messages: [],
      error: null,
      messagesBySession: state.activeSessionId
        ? { ...state.messagesBySession, [state.activeSessionId]: [] }
        : state.messagesBySession,
    }));
  },
  clearError: () => set({ error: null }),

  setSelectedModel: (model: string) => set({ selectedModel: model }),
  setSelectedCapability: (capability: string) =>
    set({ selectedCapability: capability }),

  submitFeedback: async (messageId: string, rating: "like" | "dislike") => {
    const target = get().messages.find((m) => m.id === messageId);
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: rating } : m,
      ),
      messagesBySession: state.activeSessionId
        ? {
            ...state.messagesBySession,
            [state.activeSessionId]: persistableMessages(
              state.messages.map((m) =>
                m.id === messageId ? { ...m, feedback: rating } : m,
              ),
            ),
          }
        : state.messagesBySession,
    }));
    if (target?.serverMessageId) {
      api.aiLearning
        .submitFeedback(target.serverMessageId, {
          user_id: USER_ID,
          rating,
        })
        .catch(() => {});
    }
  },

  setOnline: (online: boolean) => {
    set({ isOnline: online });
  },

  flushOfflineQueue: async () => {
    const { activeSessionId } = get();
    const result = await offlineQueue.flush(async (action) => {
      if (action.type === "send_message") {
        const payload = action.payload as {
          sessionId: string;
          text: string;
          model?: string;
          capability?: string;
        };
        if (!payload?.sessionId || !payload?.text) {
          throw new Error("Invalid send_message payload");
        }
        await api.aiLearning.createSessionMessage(payload.sessionId, {
          role: "user",
          content: payload.text,
          user_id: USER_ID,
          model_name: payload.model || "default",
        });
      }
    });

    // Remove queued flags from messages after successful flush
    if (result.succeeded > 0) {
      set((state) => {
        const updatedMessages = state.messages.map((m) =>
          m.queued ? { ...m, queued: false } : m,
        );
        return {
          messages: updatedMessages,
          ...saveMessagesForActiveSession(state, updatedMessages),
        };
      });
    }

    return result;
  },
});
