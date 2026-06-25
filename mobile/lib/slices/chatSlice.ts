import type { StateCreator } from "zustand";
import { api } from "../api";
import { streamChatWithRetry, uploadAttachmentsIfNeeded } from "../streaming";
import type { StreamEvent } from "../streaming";
import type { Message, MessageAttachment } from "../types";
import { USER_ID, DEFAULT_MODEL } from "../config";
import { buildSystemPrompt } from "../learningContext";
import type { StoreState } from "../store";
import { offlineQueue } from "../offline-queue";
import {
  advanceSocraticStateAfterTurn,
  buildSocraticLearningSignal,
  buildSocraticSystemPrompt,
  getSocraticKnowledgePointIds,
  loadSocraticFollowupState,
  saveSocraticFollowupState,
  type SocraticFollowupState,
} from "../socratic-followup";

export interface ChatSlice {
  messages: Message[];
  messagesBySession: Record<string, Message[]>;
  isStreaming: boolean;
  isOnline: boolean;
  error: string | null;
  currentAgent: string | null;
  selectedModel: string;
  selectedCapability: string;

  sendMessage: (
    text: string,
    capability?: string,
    attachments?: MessageAttachment[],
  ) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;
  clearError: () => void;
  submitFeedback: (
    messageId: string,
    rating: "like" | "dislike",
  ) => Promise<void>;
  retryMessage: () => Promise<void>;
  editMessage: (messageId: string, newText: string) => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedCapability: (capability: string) => void;
  setOnline: (online: boolean) => void;
  flushOfflineQueue: () => Promise<{ succeeded: number; failed: number }>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function normalizeAttachment(raw: unknown): MessageAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const type = item.type === "image" ? "image" : "file";
  const objectKey =
    typeof item.object_key === "string"
      ? item.object_key
      : typeof item.objectKey === "string"
        ? item.objectKey
        : undefined;
  const url =
    typeof item.file_url === "string"
      ? item.file_url
      : typeof item.url === "string"
        ? item.url
        : undefined;
  const name =
    typeof item.file_name === "string"
      ? item.file_name
      : typeof item.name === "string"
        ? item.name
        : undefined;
  const mimeType =
    typeof item.mime_type === "string"
      ? item.mime_type
      : typeof item.mimeType === "string"
        ? item.mimeType
        : undefined;
  const size =
    typeof item.file_size === "number"
      ? item.file_size
      : typeof item.size === "number"
        ? item.size
        : undefined;
  const uri = typeof item.uri === "string" ? item.uri : undefined;

  return {
    type,
    ...(uri ? { uri } : {}),
    ...(name ? { name, file_name: name } : {}),
    ...(mimeType ? { mimeType, mime_type: mimeType } : {}),
    ...(objectKey ? { objectKey, object_key: objectKey } : {}),
    ...(url ? { url, file_url: url } : {}),
    ...(size !== undefined ? { size, file_size: size } : {}),
    ...(typeof item.metadata === "object" && item.metadata !== null
      ? { metadata: item.metadata as MessageAttachment["metadata"] }
      : {}),
  };
}

function attachmentRefs(
  attachments?: MessageAttachment[],
): MessageAttachment[] | undefined {
  if (!attachments?.length) return undefined;

  const refs = attachments
    .map((attachment) => {
      const normalized = normalizeAttachment(attachment);
      if (!normalized) return null;
      const objectKey = normalized.objectKey || normalized.object_key;
      const name = normalized.name || normalized.file_name;
      const mimeType = normalized.mimeType || normalized.mime_type;
      const url = normalized.url || normalized.file_url;
      const size = normalized.size || normalized.file_size;

      return {
        type: normalized.type,
        ...(objectKey ? { object_key: objectKey } : {}),
        ...(name ? { file_name: name } : {}),
        ...(mimeType ? { mime_type: mimeType } : {}),
        ...(url ? { file_url: url } : {}),
        ...(size !== undefined ? { file_size: size } : {}),
        ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
      } as MessageAttachment;
    })
    .filter((item): item is MessageAttachment => item !== null);

  return refs.length ? refs : undefined;
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
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments
          .map(normalizeAttachment)
          .filter((item): item is MessageAttachment => item !== null)
      : undefined,
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
    .map((m) => ({
      ...m,
      isStreaming: false,
      attachments: attachmentRefs(m.attachments),
    }));
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

// ── 节流配置 ──
const FLUSH_INTERVAL = 90; // ms — batch chunks to avoid Markdown/MathJax re-render jank

export const createChatSlice: StateCreator<StoreState, [], [], ChatSlice> = (
  set,
  get,
) => {
  // ── 实例级可变状态（避免模块级共享） ──
  let abortController: AbortController | null = null;
  let pendingContent = "";
  let pendingReasoning = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushInProgress = false;
  let activeSendKey: string | null = null;
  let activeSendStartedAt = 0;

  function buildSendKey(
    sessionId: string,
    text: string,
    capability?: string,
    attachments?: MessageAttachment[],
  ): string {
    const attachmentKey = (attachments ?? [])
      .map((a) =>
        [
          a.type,
          a.objectKey || a.object_key || a.uri,
          a.name || a.file_name,
          a.size || a.file_size,
          a.mimeType || a.mime_type,
        ]
          .filter((part) => part !== undefined && part !== null)
          .join(":"),
      )
      .join("|");
    return [sessionId, capability || "", text, attachmentKey].join("\x1f");
  }

  function flushPending() {
    if (flushInProgress) return; // 防重入：上一次 flush 未完成时跳过
    if (!pendingContent && !pendingReasoning) return;
    flushInProgress = true;
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
    flushInProgress = false;
  }

  return {
    messages: [],
    messagesBySession: {},
    isStreaming: false,
    isOnline: true,
    error: null,
    currentAgent: null,
    selectedModel: DEFAULT_MODEL,
    selectedCapability: "",

    sendMessage: async (
      text: string,
      capability?: string,
      attachments?: MessageAttachment[],
    ) => {
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
        if (attachments?.length) {
          set({ error: "带附件消息需要联网上传，请恢复网络后再发送" });
          return;
        }

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

      let preparedAttachments: MessageAttachment[] | undefined;
      try {
        preparedAttachments = await uploadAttachmentsIfNeeded(attachments);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[chat] 附件上传失败:", message);
        set({ error: message || "附件上传失败" });
        return;
      }

      const sendKey = buildSendKey(
        activeSessionId,
        text,
        effectiveCapability || undefined,
        preparedAttachments,
      );
      const now = Date.now();
      if (
        get().isStreaming &&
        activeSendKey === sendKey &&
        now - activeSendStartedAt < 1500
      ) {
        console.warn("[chat] 忽略重复发送");
        return;
      }
      activeSendKey = sendKey;
      activeSendStartedAt = now;

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
        attachments: attachmentRefs(preparedAttachments),
      };
      const persistedUserContent =
        text ||
        (preparedAttachments?.some((a) => a.type === "image")
          ? "请分析这张图片"
          : preparedAttachments?.length
            ? "请分析这个文件"
            : "");

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
          content: persistedUserContent,
          user_id: USER_ID,
          model_name: selectedModel,
          request_id: userMessage.id,
          attachments: attachmentRefs(preparedAttachments),
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

      let socraticState: SocraticFollowupState | null = null;
      try {
        socraticState = await loadSocraticFollowupState(activeSessionId);
      } catch {
        socraticState = null;
      }
      const systemPromptParts = [
        buildSystemPrompt(learningContext),
        buildSocraticSystemPrompt(socraticState),
      ].filter((part): part is string => Boolean(part));
      const systemPrompt = systemPromptParts.length
        ? systemPromptParts.join("\n\n")
        : undefined;

      // 启动定时刷新
      flushTimer = setInterval(() => flushPending(), FLUSH_INTERVAL);

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
          attachments: preparedAttachments?.length ? preparedAttachments : undefined,
          signal: abortController.signal,
          onEvent: (event: StreamEvent) => {
            if (event.type === "text_delta") {
              pendingContent += event.data?.content || "";
            } else if (event.type === "final_markdown") {
              flushPending();
              const finalContent = event.data?.content || "";
              if (finalContent) {
                set((state: any) => {
                  const msgs = state.messages;
                  const last = msgs[msgs.length - 1];
                  if (!last || last.role !== "assistant") return state;
                  return {
                    messages: [
                      ...msgs.slice(0, -1),
                      { ...last, content: finalContent },
                    ],
                  };
                });
              }
            } else if (event.type === "thinking") {
              const r = event.data?.reasoning || "";
              if (r) pendingReasoning += r;
            } else if (event.type === "agent_start") {
              set({
                currentAgent: event.data?.agentName || event.data?.agentId,
              });
            } else if (event.type === "capability_result") {
              flushPending();
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
            } else if (event.type === "retrieval_results") {
              const retrievalData = event.data;
              set((state: any) => {
                const msgs = state.messages;
                const last = msgs[msgs.length - 1];
                if (!last || last.role !== "assistant") return state;
                const updated = {
                  ...last,
                  retrievalResults: retrievalData,
                };
                return { messages: [...msgs.slice(0, -1), updated] };
              });
            }
          },
          onComplete: () => {
            // 先刷新剩余缓冲
            flushPending();
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

            if (socraticState && lastUser && lastAi?.content.trim()) {
              const nextSocraticState = advanceSocraticStateAfterTurn(
                socraticState,
                lastUser.content,
                lastAi.content,
              );
              const learningSignal = buildSocraticLearningSignal({
                previousState: socraticState,
                nextState: nextSocraticState,
                userText: lastUser.content,
                assistantText: lastAi.content,
              });
              socraticState = nextSocraticState;
              saveSocraticFollowupState(nextSocraticState).catch(() => {});
              api.learningEvents
                .createForUser(USER_ID, {
                  event_type: learningSignal.eventType,
                  session_id: activeSessionId,
                  block_id: nextSocraticState.sourceFollowupId,
                  knowledge_points: learningSignal.knowledgePointIds,
                  payload: learningSignal.payload,
                  weight: learningSignal.weight,
                })
                .catch(() => {});
              const knowledgePointIds = getSocraticKnowledgePointIds(nextSocraticState);
              if (learningSignal.isCorrectEvidence && knowledgePointIds.length) {
                api.knowledge
                  .processQuizAnswer(USER_ID, {
                    question_id: `socratic-${nextSocraticState.sourceFollowupId}`,
                    is_correct: true,
                    knowledge_point_ids: knowledgePointIds,
                    payload: {
                      source: "mobile_socratic_followup",
                      followup_id: nextSocraticState.sourceFollowupId,
                      step_title: nextSocraticState.stepTitle,
                      target_concept: nextSocraticState.targetConcept,
                      phase: nextSocraticState.phase,
                    },
                  })
                  .then(() => get().refreshLearningContext())
                  .catch(() => {});
              }
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
                    !(
                      m.role === "assistant" &&
                      m.content === "" &&
                      !m.reasoning
                    ),
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
      } finally {
        if (activeSendKey === sendKey) {
          activeSendKey = null;
          activeSendStartedAt = 0;
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
      flushPending();
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

    retryMessage: async () => {
      const { messages, activeSessionId } = get();
      if (!activeSessionId || messages.length === 0) return;

      // Find the last user message
      let lastUserIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserIndex = i;
          break;
        }
      }
      if (lastUserIndex === -1) return;

      const lastUserMsg = messages[lastUserIndex];

      // Remove everything from the last user message onwards
      const remainingMessages = messages.slice(0, lastUserIndex);

      set((state) => ({
        messages: remainingMessages,
        ...saveMessagesForActiveSession(state, remainingMessages),
      }));

      // Re-send the last user message
      await get().sendMessage(
        lastUserMsg.content,
        lastUserMsg.capability,
        lastUserMsg.attachments,
      );
    },

    editMessage: async (messageId: string, newText: string) => {
      const { messages, activeSessionId } = get();
      if (!activeSessionId) return;

      // Find the message index
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      // 保留原消息的 capability 和 attachments 上下文
      const originalMsg = messages[msgIndex];

      // Remove this message and everything after it
      const remainingMessages = messages.slice(0, msgIndex);

      set((state) => ({
        messages: remainingMessages,
        ...saveMessagesForActiveSession(state, remainingMessages),
      }));

      // Re-send with new text, preserving original context
      await get().sendMessage(
        newText,
        originalMsg.capability,
        originalMsg.attachments,
      );
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
  };
};
