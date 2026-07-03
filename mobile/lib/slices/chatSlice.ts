import type { StateCreator } from "zustand";
import { api } from "../api";
import { streamChatWithRetry, uploadAttachmentsIfNeeded } from "../streaming";
import type { StreamEvent } from "../streaming";
import type { Message, MessageAttachment } from "../types";
import {
  USER_ID,
  DEFAULT_MODEL,
  getDefaultModelForCapability,
  getDefaultVisionModel,
  getMaxOutputTokensForCapability,
  modelSupportsVision,
} from "../config";
import { buildSystemPrompt } from "../learningContext";
import { extractKnowledgePointsFromText } from "../knowledge-extract";
import type { StoreState } from "../store";
import {
  debugError,
  debugLog,
  debugWarn,
  reportDebugEvent,
} from "../debug";
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
  streamingVersion: number;
  messagesBySession: Record<string, Message[]>;
  isStreaming: boolean;
  isOnline: boolean;
  error: string | null;
  currentAgent: string | null;
  selectedModel: string;
  selectedCapability: string;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  hasOlderMessages: boolean;

  sendMessage: (
    text: string,
    capability?: string,
    attachments?: MessageAttachment[],
  ) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  loadFullMessageContent: (messageId: string) => Promise<void>;
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

// 最多携带多少轮历史消息，避免请求体过大和 token 超限。
const MAX_HISTORY_MESSAGES = 8;

function buildChatHistory(
  messages: Message[],
  currentUserMessageId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => {
      if (m.id === currentUserMessageId) return false;
      if (m.role !== "user" && m.role !== "assistant") return false;
      if (m.role === "assistant" && m.isStreaming) return false;
      if (
        m.role === "assistant" &&
        (m.clientPreviewOnly ||
          m.historyPreviewOnly ||
          m.storagePreviewOnly ||
          m.contentTruncated)
      ) {
        return false;
      }
      const content = (m.content || m.contentPreview || "").trim();
      return content.length > 0;
    })
    .map((m) => ({
      role: m.role,
      content: (m.content || m.contentPreview || "").trim().slice(0, 1200),
    }))
    .slice(-MAX_HISTORY_MESSAGES);
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
  const previewUri =
    typeof item.preview_uri === "string"
      ? item.preview_uri
      : typeof item.previewUri === "string"
        ? item.previewUri
        : undefined;
  const sha256 = typeof item.sha256 === "string" ? item.sha256 : undefined;

  return {
    type,
    ...(uri ? { uri } : {}),
    ...(previewUri ? { previewUri, preview_uri: previewUri } : {}),
    ...(name ? { name, file_name: name } : {}),
    ...(mimeType ? { mimeType, mime_type: mimeType } : {}),
    ...(objectKey ? { objectKey, object_key: objectKey } : {}),
    ...(url ? { url, file_url: url } : {}),
    ...(size !== undefined ? { size, file_size: size } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(typeof item.metadata === "object" && item.metadata !== null
      ? { metadata: item.metadata as MessageAttachment["metadata"] }
      : {}),
  };
}

function attachmentRefs(
  attachments?: MessageAttachment[],
  options?: { includeLocalPreview?: boolean },
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
      const previewUri =
        normalized.previewUri || normalized.preview_uri || normalized.uri;

      return {
        type: normalized.type,
        ...(objectKey ? { object_key: objectKey } : {}),
        ...(name ? { file_name: name } : {}),
        ...(mimeType ? { mime_type: mimeType } : {}),
        ...(url ? { file_url: url } : {}),
        ...(options?.includeLocalPreview && previewUri
          ? { previewUri, preview_uri: previewUri }
          : {}),
        ...(size !== undefined ? { file_size: size } : {}),
        ...(normalized.sha256 ? { sha256: normalized.sha256 } : {}),
        ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
      } as MessageAttachment;
    })
    .filter((item): item is MessageAttachment => item !== null);

  return refs.length ? refs : undefined;
}

function latestProblemContextId(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i].problemContext?.problem_context_id;
    if (id) return id;
  }
  return undefined;
}

function shouldReuseProblemContext(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /这题|这道题|上题|上一题|刚才|前面|图中|图片|照片|继续|再讲|再解|为什么|步骤|答案/.test(
    normalized,
  );
}

const REMOTE_HISTORY_CONTENT_LIMIT = 1000;
const REMOTE_HISTORY_FALLBACK_LIMIT = 1200;

function hasAnyPreviewFlag(
  message: Pick<
    Message,
    | "modelIncomplete"
    | "serverCutoff"
    | "clientPreviewOnly"
    | "historyPreviewOnly"
    | "storagePreviewOnly"
  >,
): boolean {
  return Boolean(
    message.modelIncomplete ||
    message.serverCutoff ||
    message.clientPreviewOnly ||
    message.historyPreviewOnly ||
    message.storagePreviewOnly,
  );
}

function contentRefFromRaw(raw: Record<string, unknown>): string | undefined {
  return typeof raw.full_content_ref === "string"
    ? raw.full_content_ref
    : typeof raw.message_id === "string"
      ? raw.message_id
      : undefined;
}

function safeRemoteContent(raw: Record<string, unknown>): {
  content: string;
  contentPreview?: string;
  contentLength: number;
  contentTruncated: boolean;
  fullContentRef?: string;
  historyPreviewOnly: boolean;
  storagePreviewOnly: boolean;
  modelIncomplete: boolean;
  serverCutoff: boolean;
} {
  const source = typeof raw.content === "string" ? raw.content : "";
  const serverPreview =
    typeof raw.content_preview === "string" ? raw.content_preview : undefined;
  const serverLength =
    typeof raw.content_length === "number" ? raw.content_length : source.length;
  const historyPreviewOnly =
    raw.history_preview_only === true || raw.content_truncated === true;
  const storagePreviewOnly = raw.storage_preview_only === true;
  const modelIncomplete = raw.model_incomplete === true;
  const serverCutoff = raw.server_cutoff === true;
  const fullContentRef =
    historyPreviewOnly || storagePreviewOnly
      ? contentRefFromRaw(raw)
      : undefined;
  if (source.length <= REMOTE_HISTORY_FALLBACK_LIMIT) {
    return {
      content: source,
      ...(serverPreview ? { contentPreview: serverPreview } : {}),
      contentLength: serverLength,
      contentTruncated:
        historyPreviewOnly ||
        storagePreviewOnly ||
        modelIncomplete ||
        serverCutoff,
      ...(fullContentRef ? { fullContentRef } : {}),
      historyPreviewOnly,
      storagePreviewOnly,
      modelIncomplete,
      serverCutoff,
    };
  }
  const contentPreview =
    serverPreview ||
    source.slice(0, REMOTE_HISTORY_FALLBACK_LIMIT) +
      "\n\n[历史消息过长，已显示预览；展开可加载完整内容]";
  return {
    content: contentPreview,
    contentPreview,
    contentLength: serverLength,
    contentTruncated: true,
    fullContentRef: fullContentRef || contentRefFromRaw(raw),
    historyPreviewOnly: true,
    storagePreviewOnly,
    modelIncomplete,
    serverCutoff,
  };
}

function messageFromRemote(raw: Record<string, unknown>): Message {
  const remoteContent = safeRemoteContent(raw);
  return {
    id: (raw.message_id as string) || generateId(),
    serverMessageId: raw.message_id as string | undefined,
    fullContentRef: remoteContent.fullContentRef,
    runtimeSeq:
      typeof raw.runtime_seq === "number" ? raw.runtime_seq : undefined,
    role: raw.role === "user" ? "user" : "assistant",
    content: remoteContent.content,
    contentPreview: remoteContent.contentPreview,
    contentLength: remoteContent.contentLength,
    contentTruncated: remoteContent.contentTruncated,
    historyPreviewOnly: remoteContent.historyPreviewOnly,
    storagePreviewOnly: remoteContent.storagePreviewOnly,
    modelIncomplete: remoteContent.modelIncomplete,
    serverCutoff: remoteContent.serverCutoff,
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

const SESSION_HISTORY_PAGE_SIZE = 4;
const SESSION_HISTORY_CACHE_LIMIT = 60;

function recentMessages(messages: Message[]): Message[] {
  return messages.length > SESSION_HISTORY_PAGE_SIZE
    ? messages.slice(-SESSION_HISTORY_PAGE_SIZE)
    : messages;
}

function messageMergeKey(message: Message): string {
  return message.serverMessageId || message.id;
}

function mergeMessagePair(base: Message, incoming: Message): Message {
  const baseContent = base.content || "";
  const incomingContent = incoming.content || "";
  const basePreviewOnly =
    base.historyPreviewOnly ||
    base.storagePreviewOnly ||
    base.clientPreviewOnly;
  const incomingPreviewOnly =
    incoming.historyPreviewOnly ||
    incoming.storagePreviewOnly ||
    incoming.clientPreviewOnly;
  const preferIncomingContent =
    incoming.isStreaming ||
    (!incomingPreviewOnly &&
      (basePreviewOnly ||
        !incoming.contentTruncated ||
        base.contentTruncated) &&
      incomingContent.length >= baseContent.length);
  const content = preferIncomingContent ? incomingContent : baseContent;
  const contentPreview =
    incoming.contentPreview || base.contentPreview || undefined;
  const contentLength = Math.max(
    base.contentLength || baseContent.length,
    incoming.contentLength || incomingContent.length,
  );
  const mergedFlags = {
    modelIncomplete: incoming.modelIncomplete ?? base.modelIncomplete,
    serverCutoff: incoming.serverCutoff ?? base.serverCutoff,
    clientPreviewOnly:
      incoming.clientPreviewOnly ??
      (!preferIncomingContent ? base.clientPreviewOnly : undefined),
    historyPreviewOnly:
      incoming.historyPreviewOnly ??
      (!preferIncomingContent ? base.historyPreviewOnly : undefined),
    storagePreviewOnly:
      incoming.storagePreviewOnly ??
      (!preferIncomingContent ? base.storagePreviewOnly : undefined),
  };
  const contentTruncated =
    hasAnyPreviewFlag(mergedFlags) || content.length < contentLength;

  return {
    ...base,
    ...incoming,
    content,
    contentPreview,
    contentLength,
    contentTruncated,
    ...mergedFlags,
    timestamp: incoming.timestamp || base.timestamp,
    runtimeSeq: incoming.runtimeSeq ?? base.runtimeSeq,
    serverMessageId: incoming.serverMessageId || base.serverMessageId,
    fullContentRef:
      incoming.fullContentRef ||
      base.fullContentRef ||
      incoming.serverMessageId ||
      base.serverMessageId,
    reasoning: incoming.reasoning || base.reasoning,
    capabilityResult: incoming.capabilityResult || base.capabilityResult,
    sources: incoming.sources || base.sources,
    toolCalls: incoming.toolCalls || base.toolCalls,
    attachments: incoming.attachments || base.attachments,
    renderMetrics: incoming.renderMetrics || base.renderMetrics,
    problemContext: incoming.problemContext || base.problemContext,
    continuationToken: incoming.continuationToken || base.continuationToken,
    nextPromptSuggestion:
      incoming.nextPromptSuggestion || base.nextPromptSuggestion,
    finishReason: incoming.finishReason || base.finishReason,
    partial: incoming.partial ?? base.partial,
    feedback: incoming.feedback || base.feedback,
    queued: incoming.queued ?? base.queued,
  };
}

function compareMessages(a: Message, b: Message): number {
  if (a.runtimeSeq !== undefined && b.runtimeSeq !== undefined) {
    return a.runtimeSeq - b.runtimeSeq;
  }
  if (a.runtimeSeq !== undefined) return -1;
  if (b.runtimeSeq !== undefined) return 1;
  return a.timestamp - b.timestamp;
}

// 内存中保留完整内容的历史消息数量。超过此数的旧消息截断 content
// 为预览，减少 JS 堆内存占用。完整内容可通过 fullContentRef 按需加载。
const HISTORY_FULL_CONTENT_KEEP = 15;

function mergeMessagesById(messages: Message[]): Message[] {
  const byKey = new Map<string, Message>();
  for (const message of messages) {
    const key = messageMergeKey(message);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeMessagePair(existing, message) : message);
  }
  const sorted = Array.from(byKey.values()).sort(compareMessages);
  // 旧消息截断 content：只保留最近 HISTORY_FULL_CONTENT_KEEP 条的完整内容
  if (sorted.length > HISTORY_FULL_CONTENT_KEEP) {
    const cutoff = sorted.length - HISTORY_FULL_CONTENT_KEEP;
    for (let i = 0; i < cutoff; i++) {
      const m = sorted[i];
      if (m.role === "assistant" && m.content.length > 2000 && !m.isStreaming) {
        sorted[i] = {
          ...m,
          content:
            m.content.slice(0, 1000) +
            "\n\n...[历史内容已截断]...\n\n" +
            m.content.slice(-500),
          contentLength: m.contentLength || m.content.length,
          historyPreviewOnly: true,
        };
      }
    }
  }
  return sorted;
}

function persistableMessages(messages: Message[]): Message[] {
  return messages
    .slice(-SESSION_HISTORY_CACHE_LIMIT)
    .filter(
      (m) =>
        m.role !== "assistant" ||
        m.content.trim() ||
        m.reasoning?.trim() ||
        m.capabilityResult,
    )
    .map((m) => {
      // 持久化时截断过长内容：保留前 2000 字预览 + 后 1000 字结尾，
      // 完整内容可通过 fullContentRef 按需从服务端加载。
      const truncatedContent =
        m.content.length > 6000
          ? m.content.slice(0, 2000) +
            "\n\n…[中间内容已截断]…\n\n" +
            m.content.slice(-1000)
          : m.content;
      return {
        ...m,
        content: truncatedContent,
        contentLength: m.contentLength || m.content.length,
        historyPreviewOnly:
          m.content.length > 6000 ? true : m.historyPreviewOnly,
        storagePreviewOnly:
          m.content.length > 6000 ? true : m.storagePreviewOnly,
        isStreaming: false,
        attachments: attachmentRefs(m.attachments),
        renderMetrics: undefined,
      };
    });
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
// 移动端流式渲染是大头开销：文本回答频繁触发 re-render，
// 加上 LaTeX 正则解析（splitByMath）成本非线性增长，导致 JS 线程阻塞甚至闪退。
// 措施：① 降低预览截断阈值，让长回答走轻量 preview 路径；② 使用适中的 flush 间隔保持流式体感。
const FLUSH_INTERVAL = 220;
const STREAM_REASONING_MAX_CHARS = 4000;
const STREAM_REASONING_EVENT_MIN_INTERVAL_MS = 0;
const STREAM_REASONING_REPEAT_MIN_INTERVAL_MS = 1200;
// 流式渲染现在由 WebView 增量排版承载，因此不再用很短的 600 字预览止血。
// 预览阈值与移动端硬上限对齐：正常回复尽量完整展示，真正过长时才截断。
const MOBILE_ASSISTANT_CONTENT_MAX_CHARS = 16000;
const LIVE_ASSISTANT_PREVIEW_CHARS = MOBILE_ASSISTANT_CONTENT_MAX_CHARS;
const STREAMING_ACC_MAX_CHARS = MOBILE_ASSISTANT_CONTENT_MAX_CHARS;
const STORAGE_CONTENT_TRUNCATE_CHARS = MOBILE_ASSISTANT_CONTENT_MAX_CHARS;
const LIVE_ASSISTANT_PREVIEW_NOTICE =
  "\n\n[内容较长，当前仅渲染预览，完整内容仍在生成和保存]";
const MOBILE_CONTENT_TRUNCATED_NOTICE =
  "\n\n[内容过长，移动端已截断显示，避免占用过多内存导致卡死]";

function appendTail(existing: string, chunk: string, maxChars: number): string {
  const next = `${existing}${chunk}`;
  if (next.length <= maxChars) return next;
  return next.slice(next.length - maxChars);
}

function appendHeadLimit(existing: string, chunk: string, maxChars: number): string {
  if (!chunk || existing.length >= maxChars) return existing;
  const remaining = maxChars - existing.length;
  return existing + chunk.slice(0, remaining);
}

function truncateAssistantContentForMobile(content: string): {
  content: string;
  originalLength: number;
  truncated: boolean;
} {
  const originalLength = content.length;
  if (originalLength <= STORAGE_CONTENT_TRUNCATE_CHARS) {
    return { content, originalLength, truncated: false };
  }
  return {
    content:
      content.slice(0, STORAGE_CONTENT_TRUNCATE_CHARS) +
      MOBILE_CONTENT_TRUNCATED_NOTICE,
    originalLength,
    truncated: true,
  };
}

function projectLiveAssistantContent(
  content: string,
  options: { live?: boolean } = {},
): {
  contentPreview?: string;
  clientPreviewOnly: boolean;
} {
  if (content.length <= LIVE_ASSISTANT_PREVIEW_CHARS) {
    return {
      contentPreview: options.live ? content : undefined,
      clientPreviewOnly: false,
    };
  }
  return {
    contentPreview:
      content.slice(0, LIVE_ASSISTANT_PREVIEW_CHARS) +
      LIVE_ASSISTANT_PREVIEW_NOTICE,
    clientPreviewOnly: true,
  };
}

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
  let lastReasoningEventAt = 0;
  let lastReasoningText = "";
  let activeSendKey: string | null = null;
  let activeSendStartedAt = 0;
  // Promise 级并发锁：防止快速双击/Effect 重入导致同时存在多个 sendMessage 任务。
  // 当旧任务仍在附件上传或流式接收中时，新调用会被直接丢弃。
  let activeSendPromise: Promise<void> | null = null;
  let flushCount = 0;
  let skippedFlushCount = 0;
  let streamEventCounts: Record<string, number> = {};
  let lastStateLogAt = 0;
  // 流式期间不更新 state.content（会导致每条消息每 280ms 重建对象 → React.memo 失败），
  // 改为本地累积，到 final_markdown / onComplete 时才一次性写回。
  let streamingContentAcc = "";
  let streamingContentSourceChars = 0;
  // null = 从未 flush 过，作为 sentinel 与 undefined（contentPreview 未设置）区分
  let lastFlushedPreview: string | undefined | null = null;

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
    if (!pendingContent && !pendingReasoning) {
      skippedFlushCount += 1;
      return;
    }
    flushInProgress = true;
    const contentChunk = pendingContent;
    const reasoningChunk = pendingReasoning;
    pendingContent = "";
    pendingReasoning = "";

    // 本地只保留移动端可渲染的前 N 字符，避免长回答把 Hermes/RN 状态树撑爆。
    streamingContentSourceChars += contentChunk.length;
    streamingContentAcc = appendHeadLimit(
      streamingContentAcc,
      contentChunk,
      STREAMING_ACC_MAX_CHARS,
    );
    const projectedContent = projectLiveAssistantContent(streamingContentAcc, {
      live: true,
    });
    // 只有 live preview 发生变化时才触发 state 更新；超过预览阈值后 preview 固定，
    // 后续继续接收流但不再推动 UI 解析更长文本。
    const previewChanged =
      lastFlushedPreview === null ||
      projectedContent.contentPreview !== lastFlushedPreview;
    if (!previewChanged && !reasoningChunk) {
      skippedFlushCount += 1;
      flushInProgress = false;
      return;
    }
    lastFlushedPreview = projectedContent.contentPreview; // undefined or string
    flushCount += 1;
    const now = Date.now();
    if (
      flushCount <= 5 ||
      projectedContent.clientPreviewOnly ||
      now - lastStateLogAt > 3000
    ) {
      lastStateLogAt = now;
      debugLog("chatSlice", "flush", {
        flushCount,
        skippedFlushCount,
        contentChunkChars: contentChunk.length,
        accChars: streamingContentAcc.length,
        sourceChars: streamingContentSourceChars,
        reasoningChunkChars: reasoningChunk.length,
        previewChars: projectedContent.contentPreview?.length || 0,
        clientPreviewOnly: projectedContent.clientPreviewOnly,
      });
    }

    set((state: any) => {
      const msgs = state.messages;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant" || last.isStreaming === false) {
        return state;
      }

      const updated = {
        ...last,
        // content 不更新，避免每次 flush 都创建新对象引用破坏 React.memo
        contentPreview: projectedContent.contentPreview,
        clientPreviewOnly: projectedContent.clientPreviewOnly,
        contentLength: Math.max(
          last.contentLength || 0,
          streamingContentSourceChars,
          streamingContentAcc.length,
        ),
        contentTruncated:
          last.modelIncomplete ||
          last.serverCutoff ||
          streamingContentSourceChars > streamingContentAcc.length ||
          projectedContent.clientPreviewOnly ||
          last.historyPreviewOnly ||
          last.storagePreviewOnly,
      };
      if (reasoningChunk) {
        updated.reasoning = appendTail(
          updated.reasoning || "",
          reasoningChunk,
          STREAM_REASONING_MAX_CHARS,
        );
      }
      return patchLastMessage(state, updated);
    });
    flushInProgress = false;
  }

  // 稳定更新：原地替换 messages 最后一个元素，不重建数组。
  // 配合 FlatList extraData=streamingVersion 实现精确更新。
  let streamingVersion = 0;

  function patchLastMessage(
    state: StoreState,
    updated: Message,
  ): Pick<StoreState, "messages" | "streamingVersion"> {
    const msgs = state.messages;
    if (msgs.length === 0) return { messages: [updated], streamingVersion: 0 };
    const nextMessages = [...msgs.slice(0, -1), updated];
    streamingVersion++;
    return { messages: nextMessages, streamingVersion };
  }

  function finalizeStreamingMessage(
    state: StoreState,
    options?: { preserveReasoning?: boolean },
  ) {
    const msgs = state.messages;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") {
      streamingVersion++;
      return {
        messages: msgs,
        streamingVersion,
        ...saveMessagesForActiveSession(state, msgs),
      };
    }
    const updated: Message = {
      ...last,
      isStreaming: false,
      // 结束流式时清除 preview 标记，直接渲染完整 content。
      contentPreview: undefined,
      clientPreviewOnly: false,
      historyPreviewOnly: false,
    };
    if (!updated.content.trim() && streamingContentAcc) {
      // 优先使用流式期间累积的完整内容
      const stored = truncateAssistantContentForMobile(streamingContentAcc);
      updated.content = stored.content;
      updated.contentLength = Math.max(
        stored.originalLength,
        streamingContentSourceChars,
      );
      updated.storagePreviewOnly =
        updated.storagePreviewOnly || stored.truncated;
      updated.contentTruncated =
        updated.modelIncomplete ||
        updated.serverCutoff ||
        updated.storagePreviewOnly ||
        updated.contentLength > updated.content.length;
    }
    if (!options?.preserveReasoning && !updated.content.trim()) {
      updated.reasoning = updated.reasoning?.slice(-STREAM_REASONING_MAX_CHARS);
    }
    const nextMessages = [...msgs.slice(0, -1), updated];
    streamingVersion++;
    return {
      messages: nextMessages,
      streamingVersion,
      ...saveMessagesForActiveSession(state, nextMessages),
    };
  }

  return {
    messages: [],
    streamingVersion: 0,
    messagesBySession: {},
    isStreaming: false,
    isOnline: true,
    error: null,
    currentAgent: null,
    selectedModel: DEFAULT_MODEL,
    selectedCapability: "",
    isLoadingMessages: false,
    isLoadingOlderMessages: false,
    hasOlderMessages: false,

    sendMessage: async (
      text: string,
      capability?: string,
      attachments?: MessageAttachment[],
    ) => {
      // 用于通知并发锁本次任务已结束。
      let finishTask: (() => void) | undefined;
      const taskPromise = new Promise<void>((resolve) => {
        finishTask = resolve;
      });

      try {
        const {
          activeSessionId,
          learningContext,
          selectedModel,
          selectedCapability: storeCapability,
          isStreaming: wasStreaming,
          streamingVersion: prevStreamingVersion,
        } = get();
        // #region debug-point A/D/E:send-start
        debugLog("chatSlice", "sendMessage:start", {
          messageCount: get().messages.length,
          lastMessageRole: get().messages.at(-1)?.role,
          lastMessageIsStreaming: get().messages.at(-1)?.isStreaming,
          wasStreaming,
          prevStreamingVersion,
          hasAbortController: Boolean(abortController),
          hasActiveSendPromise: Boolean(activeSendPromise),
          activeSendKey,
        });
        reportDebugEvent(
          "A/D/E",
          "chatSlice.ts:sendMessage:start",
          "sendMessage started",
          {
            messageCount: get().messages.length,
            lastMessageRole: get().messages.at(-1)?.role,
            lastMessageIsStreaming: get().messages.at(-1)?.isStreaming,
            wasStreaming,
            prevStreamingVersion,
            hasAbortController: Boolean(abortController),
            hasActiveSendPromise: Boolean(activeSendPromise),
            activeSendKey,
          },
        );
        // #endregion
        const effectiveCapability = capability ?? storeCapability;
      const hasImageAttachments = Boolean(
        attachments?.some((item) => item.type === "image"),
      );
      const selectedModelForRequest =
        selectedModel &&
        selectedModel !== DEFAULT_MODEL &&
        (!hasImageAttachments || modelSupportsVision(selectedModel))
          ? selectedModel
          : hasImageAttachments
            ? getDefaultVisionModel(effectiveCapability)
            : getDefaultModelForCapability(effectiveCapability);

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
            model: selectedModelForRequest,
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

      // Promise 级并发锁：如果上一次发送任务仍在执行（包括附件上传或流式接收），
      // 先 abort 旧流并等待其清理，避免旧流事件污染新流状态。
      if (activeSendPromise) {
        console.warn("[chat] 旧发送任务仍在执行，尝试中止并等待清理", {
          activeSendStartedAt,
          elapsedMs: Date.now() - activeSendStartedAt,
        });
        if (abortController && !abortController.signal.aborted) {
          abortController.abort();
        }
        // 最多等待 800ms，让旧任务的 reader/flush 回调有机会退出；
        // 若超时仍没结束，也继续启动新任务，后续用 abortController 版本隔离兜底。
        const cleanupTimeout = new Promise<void>((resolve) =>
          setTimeout(resolve, 800),
        );
        await Promise.race([activeSendPromise.catch(() => {}), cleanupTimeout]);
      }

      // 在附件上传前即生成 sendKey 并占用锁，避免上传期间重复调用绕过防重。
      // 只要同一条消息的上一次发送任务还没结束（activeSendKey 未释放），就丢弃后续重复请求。
      const sendKey = buildSendKey(
        activeSessionId,
        text,
        effectiveCapability || undefined,
        attachments,
      );
      if (activeSendKey === sendKey) {
        console.warn("[chat] 忽略重复发送", {
          sendKey,
          activeSendStartedAt,
          elapsedMs: Date.now() - activeSendStartedAt,
        });
        return;
      }
      activeSendKey = sendKey;
      activeSendStartedAt = Date.now();
      activeSendPromise = taskPromise;

      let preparedAttachments: MessageAttachment[] | undefined;
      let clientUploadMs = 0;
      const uploadRequestId = generateId();
      try {
        const uploadStartedAt = Date.now();
        preparedAttachments = await uploadAttachmentsIfNeeded(attachments, {
          requestId: uploadRequestId,
        });
        clientUploadMs = Date.now() - uploadStartedAt;
      } catch (error) {
        activeSendKey = null;
        activeSendStartedAt = 0;
        const message = error instanceof Error ? error.message : String(error);
        console.error("[chat] 附件上传失败:", message);
        set({ error: message || "附件上传失败" });
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

      if (abortController) {
        console.warn("[chat] 中止旧的流式请求并启动新请求", {
          oldAborted: abortController.signal.aborted,
          newRequestId: uploadRequestId,
          sendKey,
        });
        abortController.abort();
      }
      abortController = new AbortController();

      // 重置节流缓冲
      pendingContent = "";
      pendingReasoning = "";
      flushCount = 0;
      skippedFlushCount = 0;
      streamEventCounts = {};
      lastStateLogAt = 0;
      lastReasoningEventAt = 0;
      lastReasoningText = "";
      streamingContentAcc = "";
      streamingContentSourceChars = 0;
      lastFlushedPreview = null;
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }

      const userMessage: Message = {
        id: uploadRequestId,
        role: "user",
        content: text,
        timestamp: Date.now(),
        capability: effectiveCapability || undefined,
        attachments: attachmentRefs(preparedAttachments, {
          includeLocalPreview: true,
        }),
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
        capability: effectiveCapability || undefined,
        reasoning: "",
        renderMetrics:
          clientUploadMs > 0
            ? { request_id: uploadRequestId, client_upload_ms: clientUploadMs }
            : undefined,
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
          model_name: selectedModelForRequest,
          request_id: userMessage.id,
          attachments: attachmentRefs(preparedAttachments),
        })
        .then((remote) => {
          const serverMessageId = (remote as Record<string, unknown>)
            .message_id as string | undefined;
          if (!serverMessageId) return;
          set((state) => {
            const nextMessages = state.messages.map((m) =>
              m.id === userMessage.id
                ? { ...m, serverMessageId, fullContentRef: serverMessageId }
                : m,
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
        // 固定本次流式请求使用的 abortController，防止新请求替换后旧请求的事件仍被处理。
        const streamAbortController = abortController;
        const isCurrentStream = () => abortController === streamAbortController;
        const problemContextId =
          preparedAttachments?.length || !shouldReuseProblemContext(text)
            ? undefined
            : latestProblemContextId(get().messages);
        await streamChatWithRetry({
          message: text,
          systemPrompt,
          conversationId: uploadRequestId,
          model: selectedModelForRequest,
          maxTokens: getMaxOutputTokensForCapability(effectiveCapability),
          capability: effectiveCapability || undefined,
          attachments: preparedAttachments?.length
            ? preparedAttachments
            : undefined,
          problemContextId,
          history: buildChatHistory(get().messages, userMessage.id),
          signal: abortController.signal,
          onEvent: (event: StreamEvent) => {
            // 如果 abortController 已被新请求替换，说明这是旧流的迟到事件，直接丢弃。
            if (!isCurrentStream()) {
              debugWarn("chatSlice", "stale_stream_event_dropped", {
                sendKey,
                expected: streamAbortController?.signal?.aborted,
                type: event.type,
              });
              return;
            }
            streamEventCounts[event.type] =
              (streamEventCounts[event.type] || 0) + 1;
            if (event.type === "text_delta") {
              pendingContent += event.data?.content || "";
              if (streamEventCounts.text_delta === 1) {
                flushPending();
              }
            } else if (event.type === "final_markdown") {
              flushPending();
              const finalContent = event.data?.content || "";
              // 使用本地累积的完整内容（state.content 在流式期间不再更新以稳定 React.memo）
              const fullContent = finalContent || streamingContentAcc;
              debugLog("chatSlice", "final_markdown", {
                finalChars: finalContent.length,
                accChars: streamingContentAcc.length,
                sourceChars: streamingContentSourceChars,
                fullChars: fullContent.length,
                flushCount,
                skippedFlushCount,
                eventCounts: streamEventCounts,
                finishReason: event.data?.finish_reason || "stop",
                partial: Boolean(event.data?.partial),
              });
              set((state: any) => {
                const msgs = state.messages;
                const last = msgs[msgs.length - 1];
                if (!last || last.role !== "assistant") return state;
                const fallbackSource = fullContent || "";
                const stored = truncateAssistantContentForMobile(fallbackSource);
                const fallbackContent = stored.content;
                const finishReason = event.data?.finish_reason || "stop";
                const partial = Boolean(event.data?.partial);
                const serverCutoff =
                  partial &&
                  (finishReason === "duration" ||
                    finishReason === "server_char_limit");
                const modelIncomplete = partial && finishReason === "length";
                const sourceLength = Math.max(
                  stored.originalLength,
                  streamingContentSourceChars,
                );
                const exceedsStorageLimit = stored.truncated;
                debugLog("chatSlice", "final_store", {
                  fallbackChars: stored.originalLength,
                  storedChars: fallbackContent.length,
                  sourceChars: sourceLength,
                  previewChars: 0,
                  clientPreviewOnly: false,
                  exceedsStorageLimit,
                  finishReason,
                  modelIncomplete,
                  serverCutoff,
                });
                streamingVersion++;
                return {
                  messages: [
                    ...msgs.slice(0, -1),
                    {
                      ...last,
                      content: fallbackContent,
                      contentLength: sourceLength,
                      // final_markdown 是最终完整答案，不再使用流式 preview 模式。
                      // contentPreview 仅保留服务端明确下发的预览（历史消息场景），
                      // 否则直接渲染完整 content，避免用户点击展开。
                      contentPreview: undefined,
                      clientPreviewOnly: false,
                      modelIncomplete,
                      serverCutoff,
                      historyPreviewOnly: false,
                      storagePreviewOnly:
                        stored.truncated || last.storagePreviewOnly || false,
                      contentTruncated:
                        modelIncomplete ||
                        serverCutoff ||
                        stored.truncated ||
                        sourceLength > fallbackContent.length,
                      finishReason,
                      partial,
                      continuationToken:
                        event.data?.continuation_token || undefined,
                      nextPromptSuggestion:
                        event.data?.next_prompt_suggestion || undefined,
                      // 保持 isStreaming: true，避免渲染器从 StreamingLightweightRenderer
                      // 突然切换到 FinalMarkdownRenderer 导致内容从头重新渲染。
                      // isStreaming 的最终关闭由 onComplete 回调统一处理。
                    },
                  ],
                  streamingVersion,
                };
              });
              // 同步闭包累积变量，确保 onComplete 可正确回退
              const storedFullContent =
                truncateAssistantContentForMobile(fullContent);
              streamingContentAcc = storedFullContent.content;
              streamingContentSourceChars = Math.max(
                streamingContentSourceChars,
                storedFullContent.originalLength,
              );
            } else if (event.type === "problem_context") {
              const contextData = event.data;
              set((state: any) => {
                const msgs = state.messages;
                const last = msgs[msgs.length - 1];
                if (!last || last.role !== "assistant") return state;
                return {
                  messages: [
                    ...msgs.slice(0, -1),
                    { ...last, problemContext: contextData },
                  ],
                };
              });
            } else if (event.type === "render_metrics") {
              set((state: any) => {
                const msgs = state.messages;
                const last = msgs[msgs.length - 1];
                if (!last || last.role !== "assistant") return state;
                return {
                  messages: [
                    ...msgs.slice(0, -1),
                    {
                      ...last,
                      renderMetrics: {
                        ...(last.renderMetrics || {}),
                        ...event.data,
                      },
                    },
                  ],
                };
              });
            } else if (event.type === "thinking") {
              const r = event.data?.reasoning || "";
              if (r) {
                const now = Date.now();
                const minInterval =
                  r === lastReasoningText
                    ? STREAM_REASONING_REPEAT_MIN_INTERVAL_MS
                    : STREAM_REASONING_EVENT_MIN_INTERVAL_MS;
                if (now - lastReasoningEventAt >= minInterval) {
                  pendingReasoning = appendTail(
                    pendingReasoning,
                    r.endsWith("\n") ? r : `${r}\n`,
                    STREAM_REASONING_MAX_CHARS,
                  );
                  lastReasoningEventAt = now;
                  lastReasoningText = r;
                }
              }
            } else if (event.type === "agent_start") {
              set({
                currentAgent: event.data?.agentName || event.data?.agentId,
              });
            } else if (event.type === "capability_result") {
              flushPending();
              const resultData = event.data;
              const resultContent = resultData.content || "";
              if (resultContent && !streamingContentAcc.trim()) {
                const stored = truncateAssistantContentForMobile(resultContent);
                streamingContentAcc = stored.content;
                streamingContentSourceChars = Math.max(
                  streamingContentSourceChars,
                  stored.originalLength,
                );
              }
              set((state: any) => {
                const msgs = state.messages;
                const last = msgs[msgs.length - 1];
                if (!last || last.role !== "assistant") return state;
                const updated = {
                  ...last,
                  content:
                    !last.content.trim() && resultContent
                      ? truncateAssistantContentForMobile(resultContent).content
                      : last.content,
                  capabilityResult: {
                    content: resultContent,
                    output_mode: resultData.output_mode,
                    render_type: resultData.render_type,
                    artifacts: resultData.artifacts,
                    code: resultData.code,
                    analysis: resultData.analysis,
                    review: resultData.review,
                    summary: resultData.summary,
                  },
                };
                return patchLastMessage(state, updated);
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
                return patchLastMessage(state, updated);
              });
            } else if (event.type === "upload_status") {
              // 附件水合失败警告 — 追加到助手消息的 warning 字段
              const uploadData = event.data;
              if (uploadData?.status === "hydration_failed") {
                const warningMsg =
                  uploadData.message ||
                  `以下附件加载失败: ${(uploadData.filenames || []).join(", ")}`;
                console.warn("[chat] hydration_failed:", warningMsg);
                set((state: any) => {
                  const msgs = state.messages;
                  const last = msgs[msgs.length - 1];
                  if (!last || last.role !== "assistant") return state;
                  const warnings = [
                    ...(last.warnings || []),
                    { type: "hydration_failed", message: warningMsg },
                  ];
                  return {
                    messages: [...msgs.slice(0, -1), { ...last, warnings }],
                  };
                });
              }
            }
          },
          onComplete: () => {
            // 如果这是旧流的完成回调，直接丢弃。
            if (!isCurrentStream()) {
              debugWarn("chatSlice", "stale_stream_complete_dropped", {
                sendKey,
              });
              return;
            }
            // #region debug-point A:complete-start
            const preCompleteState = get();
            const preCompleteLast = preCompleteState.messages.at(-1);
            debugLog("chatSlice", "onComplete:start", {
              messageCount: preCompleteState.messages.length,
              lastMessageRole: preCompleteLast?.role,
              lastMessageIsStreaming: preCompleteLast?.isStreaming,
              isStreamingState: preCompleteState.isStreaming,
              streamingVersion: preCompleteState.streamingVersion,
              streamingContentAccChars: streamingContentAcc.length,
              streamingContentSourceChars,
              flushCount,
              eventCounts: streamEventCounts,
            });
            reportDebugEvent(
              "A",
              "chatSlice.ts:onComplete:start",
              "onComplete started",
              {
                messageCount: preCompleteState.messages.length,
                lastMessageRole: preCompleteLast?.role,
                lastMessageIsStreaming: preCompleteLast?.isStreaming,
                isStreamingState: preCompleteState.isStreaming,
                streamingVersion: preCompleteState.streamingVersion,
                streamingContentAccChars: streamingContentAcc.length,
                streamingContentSourceChars,
                flushCount,
                eventCounts: streamEventCounts,
              },
            );
            // #endregion
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
                streamingVersion++;
                return {
                  isStreaming: false,
                  currentAgent: null,
                  streamingVersion,
                  ...saveMessagesForActiveSession(state, msgs),
                };
              }
              const updated: Message = {
                ...last,
                isStreaming: false,
                // 流已结束，清除流式 preview 标记，直接渲染完整 content。
                contentPreview: undefined,
                clientPreviewOnly: false,
                historyPreviewOnly: false,
              };
              // 将流式期间本地累积的内容写回 state.content。
              // 流已结束，直接渲染完整 content，不再保留 preview 标记。
              if (!updated.content.trim() && streamingContentAcc) {
                const stored = truncateAssistantContentForMobile(streamingContentAcc);
                updated.content = stored.content;
                updated.contentLength = Math.max(
                  stored.originalLength,
                  streamingContentSourceChars,
                );
                updated.contentPreview = undefined;
                updated.clientPreviewOnly = false;
                updated.historyPreviewOnly = false;
                updated.storagePreviewOnly =
                  updated.storagePreviewOnly || stored.truncated;
                updated.contentTruncated =
                  updated.modelIncomplete ||
                  updated.serverCutoff ||
                  updated.storagePreviewOnly ||
                  updated.contentLength > updated.content.length;
              }
              const nextMessages = [...msgs.slice(0, -1), updated];
              debugLog("chatSlice", "complete_state", {
                contentChars: updated.content.length,
                contentLength: updated.contentLength,
                sourceChars: streamingContentSourceChars,
                previewChars: updated.contentPreview?.length || 0,
                clientPreviewOnly: updated.clientPreviewOnly,
                flushCount,
                skippedFlushCount,
                eventCounts: streamEventCounts,
              });
              streamingVersion++;
              // #region debug-point A:complete-end
              debugLog("chatSlice", "onComplete:end", {
                messageCount: nextMessages.length,
                lastMessageRole: updated.role,
                lastMessageIsStreaming: updated.isStreaming,
                newIsStreaming: false,
                newStreamingVersion: streamingVersion,
                contentChars: updated.content.length,
                contentLength: updated.contentLength,
                streamingContentSourceChars,
              });
              reportDebugEvent(
                "A",
                "chatSlice.ts:onComplete:end",
                "onComplete state updated",
                {
                  messageCount: nextMessages.length,
                  lastMessageRole: updated.role,
                  lastMessageIsStreaming: updated.isStreaming,
                  newIsStreaming: false,
                  newStreamingVersion: streamingVersion,
                  contentChars: updated.content.length,
                  contentLength: updated.contentLength,
                  streamingContentSourceChars,
                },
              );
              // #endregion
              return {
                messages: nextMessages,
                isStreaming: false,
                currentAgent: null,
                streamingVersion,
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
              const knowledgePointIds =
                getSocraticKnowledgePointIds(nextSocraticState);
              if (
                learningSignal.isCorrectEvidence &&
                knowledgePointIds.length
              ) {
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

            // ── Post-turn learning events (non-socratic) ──
            // Fire asked_question + confusion_detected with extracted knowledge
            // points so the BKT pipeline can update StudentKnowledgeState.
            // Skip when socratic state is active — it has its own signal pipeline.
            if (lastUser?.content.trim() && !socraticState) {
              const userText = lastUser.content;
              const kps = extractKnowledgePointsFromText(userText);

              api.learningEvents
                .createForUser(USER_ID, {
                  event_type: "asked_question",
                  session_id: activeSessionId,
                  knowledge_points: kps,
                  payload: {
                    question_text: userText.slice(0, 500),
                    question_category: "chat",
                    is_follow_up: msgs.length > 2,
                  },
                  weight: 0.8,
                })
                .catch(() => {});

              // Detect confusion signals in user message
              const confusionPattern =
                /不懂|不理解|听不懂|还是不会|没明白|什么意思|太难了|看不懂|不明白|搞不清|晕了|为什么|不会|疑惑|卡住/;
              if (confusionPattern.test(userText)) {
                api.learningEvents
                  .createForUser(USER_ID, {
                    event_type: "confusion_detected",
                    session_id: activeSessionId,
                    knowledge_points: kps,
                    payload: {
                      detection_method: "explicit",
                      context: userText.slice(0, 200),
                      confidence_score: 0.9,
                    },
                    weight: 1.5,
                  })
                  .catch(() => {});
              }
            }

            if (lastAi?.content.trim()) {
              api.aiLearning
                .createSessionMessage(activeSessionId, {
                  role: "assistant",
                  content: lastAi.content,
                  user_id: USER_ID,
                  model_name: selectedModelForRequest,
                  request_id: lastAi.id,
                  parent_message_id: lastUser?.serverMessageId,
                })
                .then((remote) => {
                  const serverMessageId = (remote as Record<string, unknown>)
                    .message_id as string | undefined;
                  if (!serverMessageId) return;
                  set((state) => {
                    const nextMessages = state.messages.map((m) =>
                      m.id === lastAi.id
                        ? {
                            ...m,
                            serverMessageId,
                            fullContentRef: serverMessageId,
                          }
                        : m,
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
            // 如果这是旧流的错误回调，直接丢弃，避免把旧流错误状态写入新消息。
            if (!isCurrentStream()) {
              debugWarn("chatSlice", "stale_stream_error_dropped", {
                sendKey,
                error: error.message,
              });
              return;
            }
            // #region debug-point A/B:error-start
            const preErrorState = get();
            debugLog("chatSlice", "onError:start", {
              messageCount: preErrorState.messages.length,
              lastMessageRole: preErrorState.messages.at(-1)?.role,
              lastMessageIsStreaming: preErrorState.messages.at(-1)?.isStreaming,
              isStreamingState: preErrorState.isStreaming,
              streamingVersion: preErrorState.streamingVersion,
              error: error.message,
              accChars: streamingContentAcc.length,
              flushCount,
              eventCounts: streamEventCounts,
            });
            reportDebugEvent(
              "A/B",
              "chatSlice.ts:onError:start",
              "onError triggered",
              {
                messageCount: preErrorState.messages.length,
                lastMessageRole: preErrorState.messages.at(-1)?.role,
                lastMessageIsStreaming: preErrorState.messages.at(-1)
                  ?.isStreaming,
                isStreamingState: preErrorState.isStreaming,
                streamingVersion: preErrorState.streamingVersion,
                error: error.message,
                accChars: streamingContentAcc.length,
                flushCount,
                eventCounts: streamEventCounts,
              },
            );
            // #endregion
            console.error("[chat] 流式对话错误:", error.message);
            if (flushTimer) {
              clearInterval(flushTimer);
              flushTimer = null;
            }
            pendingContent = "";
            pendingReasoning = "";
            debugError("chatSlice", "stream_error", {
              error: error.message,
              accChars: streamingContentAcc.length,
              flushCount,
              skippedFlushCount,
              eventCounts: streamEventCounts,
            });
            lastReasoningEventAt = 0;
            lastReasoningText = "";
            streamingContentAcc = "";
            streamingContentSourceChars = 0;
            lastFlushedPreview = null;

            // 合并为单次 set
            set((state) => {
              const finalized = finalizeStreamingMessage(state, {
                preserveReasoning: true,
              });
              const nextMessages = finalized.messages.filter(
                (m) =>
                  !(
                    m.role === "assistant" &&
                    m.content === "" &&
                    !m.reasoning
                  ),
              );
              return {
                error: error.message,
                isStreaming: false,
                currentAgent: null,
                messages: nextMessages,
                streamingVersion: finalized.streamingVersion,
                ...saveMessagesForActiveSession(state, nextMessages),
              };
            });
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("[chat] 对话异常:", error.message);
          debugError("chatSlice", "send_exception", {
            error: error.message,
            accChars: streamingContentAcc.length,
            flushCount,
            skippedFlushCount,
            eventCounts: streamEventCounts,
          });
          if (flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
          }
          pendingContent = "";
          pendingReasoning = "";
          lastReasoningEventAt = 0;
          lastReasoningText = "";
          streamingContentAcc = "";
          streamingContentSourceChars = 0;
          lastFlushedPreview = null;
          set((state) => {
            const finalized = finalizeStreamingMessage(state, {
              preserveReasoning: true,
            });
            const nextMessages = finalized.messages.filter(
              (m) =>
                !(m.role === "assistant" && m.content === "" && !m.reasoning),
            );
            return {
              error: error.message,
              isStreaming: false,
              currentAgent: null,
              messages: nextMessages,
              streamingVersion: finalized.streamingVersion,
              ...saveMessagesForActiveSession(state, nextMessages),
            };
          });
        }
      } finally {
        if (activeSendKey === sendKey) {
          activeSendKey = null;
          activeSendStartedAt = 0;
        }
      }
      } finally {
        finishTask?.();
        if (activeSendPromise === taskPromise) {
          activeSendPromise = null;
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
      lastReasoningEventAt = 0;
      lastReasoningText = "";
      streamingContentAcc = "";
      streamingContentSourceChars = 0;
      lastFlushedPreview = null;
      const localMessages = recentMessages(
        get().messagesBySession[sessionId] || [],
      );
      set({
        messages: localMessages,
        isLoadingMessages: true,
        isStreaming: false,
        error: null,
        currentAgent: null,
        hasOlderMessages: localMessages.length >= SESSION_HISTORY_PAGE_SIZE,
      });
      try {
        const remote = await api.aiLearning.getSessionMessages(sessionId, {
          limit: SESSION_HISTORY_PAGE_SIZE,
          max_content_chars: REMOTE_HISTORY_CONTENT_LIMIT,
        });
        const remoteMessages = (remote as Record<string, unknown>[]).map(
          messageFromRemote,
        );
        console.log(
          "[chat] loaded history",
          sessionId,
          "count",
          remoteMessages.length,
          "maxChars",
          Math.max(0, ...remoteMessages.map((m) => m.content.length)),
          "truncated",
          remoteMessages.filter((m) => m.contentTruncated).length,
        );
        if (remoteMessages.length > 0 || localMessages.length === 0) {
          set((state) => {
            const currentSessionMessages =
              state.activeSessionId === sessionId
                ? state.messages
                : state.messagesBySession[sessionId] || [];
            const mergedHistory = mergeMessagesById([
              ...remoteMessages,
              ...currentSessionMessages,
            ]);
            const saved = persistableMessages(mergedHistory);
            const isActive = state.activeSessionId === sessionId;
            const localHasActiveStream = currentSessionMessages.some(
              (message) => message.isStreaming,
            );
            return {
              ...(isActive
                ? {
                    messages: mergedHistory,
                    isLoadingMessages: false,
                    isStreaming: localHasActiveStream
                      ? state.isStreaming
                      : false,
                    error: localHasActiveStream ? state.error : null,
                    currentAgent: localHasActiveStream
                      ? state.currentAgent
                      : null,
                    hasOlderMessages:
                      remoteMessages.length >= SESSION_HISTORY_PAGE_SIZE,
                  }
                : {}),
              messagesBySession: {
                ...state.messagesBySession,
                [sessionId]: saved,
              },
            };
          });
        } else {
          set((state) =>
            state.activeSessionId === sessionId
              ? { isLoadingMessages: false, hasOlderMessages: false }
              : {},
          );
        }
      } catch {
        // Gateway sync is best-effort; local messages remain usable.
        set((state) =>
          state.activeSessionId === sessionId
            ? { isLoadingMessages: false }
            : {},
        );
      }
    },

    loadOlderMessages: async () => {
      const {
        activeSessionId,
        messages,
        isLoadingMessages,
        isLoadingOlderMessages,
        hasOlderMessages,
      } = get();
      if (
        !activeSessionId ||
        isLoadingMessages ||
        isLoadingOlderMessages ||
        !hasOlderMessages
      ) {
        return;
      }

      const oldestSeq = messages.find(
        (message) => message.runtimeSeq !== undefined,
      )?.runtimeSeq;
      if (!oldestSeq) {
        set({ hasOlderMessages: false });
        return;
      }

      set({ isLoadingOlderMessages: true });
      try {
        const remote = await api.aiLearning.getSessionMessages(
          activeSessionId,
          {
            limit: SESSION_HISTORY_PAGE_SIZE,
            before_seq: oldestSeq,
            max_content_chars: REMOTE_HISTORY_CONTENT_LIMIT,
          },
        );
        const olderMessages = (remote as Record<string, unknown>[]).map(
          messageFromRemote,
        );
        console.log(
          "[chat] loaded older history",
          activeSessionId,
          "count",
          olderMessages.length,
          "maxChars",
          Math.max(0, ...olderMessages.map((m) => m.content.length)),
          "truncated",
          olderMessages.filter((m) => m.contentTruncated).length,
        );
        set((state) => {
          if (state.activeSessionId !== activeSessionId) {
            return { isLoadingOlderMessages: false };
          }
          const merged = mergeMessagesById([
            ...olderMessages,
            ...state.messages,
          ]);
          return {
            messages: merged,
            isLoadingOlderMessages: false,
            hasOlderMessages: olderMessages.length >= SESSION_HISTORY_PAGE_SIZE,
            messagesBySession: {
              ...state.messagesBySession,
              [activeSessionId]: persistableMessages(merged),
            },
          };
        });
      } catch {
        set({ isLoadingOlderMessages: false });
      }
    },

    loadFullMessageContent: async (messageId: string) => {
      const target = get().messages.find((message) => message.id === messageId);
      const fullContentRef =
        target?.fullContentRef || target?.serverMessageId || messageId;
      if (!target || !fullContentRef) return;

      try {
        const remote = await api.aiLearning.getMessage(fullContentRef);
        const hydrated = messageFromRemote({
          ...(remote as Record<string, unknown>),
          content_truncated: false,
          history_preview_only: false,
          storage_preview_only: false,
        });
        const updated: Message = {
          ...target,
          ...hydrated,
          id: target.id,
          serverMessageId: hydrated.serverMessageId || target.serverMessageId,
          fullContentRef: hydrated.serverMessageId || target.fullContentRef,
          content: hydrated.content,
          contentPreview: undefined,
          contentLength: hydrated.contentLength || hydrated.content.length,
          contentTruncated:
            Boolean(hydrated.modelIncomplete) || Boolean(hydrated.serverCutoff),
          clientPreviewOnly: false,
          historyPreviewOnly: false,
          storagePreviewOnly: false,
        };
        set((state) => {
          const nextMessages = state.messages.map((message) =>
            message.id === messageId ? updated : message,
          );
          return {
            messages: nextMessages,
            ...saveMessagesForActiveSession(state, nextMessages),
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ error: message || "加载完整消息失败" });
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
      lastReasoningEventAt = 0;
      lastReasoningText = "";
      streamingContentAcc = "";
      streamingContentSourceChars = 0;
      lastFlushedPreview = null;

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
        streamingVersion++;
        return {
          messages: nextMessages,
          isStreaming: false,
          currentAgent: null,
          streamingVersion,
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

      // 先中止可能仍在进行的旧流式请求，避免旧事件写入已被移除的消息
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
      abortController = new AbortController();
      activeSendKey = null;
      activeSendStartedAt = 0;

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

      // 先中止可能仍在进行的旧流式请求，避免旧事件写入已被移除的消息
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
      abortController = new AbortController();
      activeSendKey = null;
      activeSendStartedAt = 0;

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
