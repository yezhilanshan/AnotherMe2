import {
  GATEWAY_URL,
  BEARER_TOKEN,
  TUNNEL_HEADERS,
  DEFAULT_MODEL,
  getDefaultModelForCapability,
  getDefaultVisionModel,
  API_TIMEOUT,
  modelSupportsVision,
} from "./config";
import { normalizeCapability, CAPABILITY_IDS } from "./config";
import { File, UploadType } from "expo-file-system";
import { Platform } from "react-native";
import {
  streamingCircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit-breaker";
import { debugError, debugLog, debugWarn } from "./debug";
import type { MessageAttachment } from "./types";
import {
  StreamEvent,
  extractJsonStringField,
  parseSSELine,
  parseOversizedSSEPayload,
  isAbortLikeError,
  isRetryableStreamError,
  isNetworkError,
  splitTextDeltaContent,
  TEXT_DELTA_CHUNK_SIZE,
  SSE_JSON_PARSE_MAX_CHARS,
  OVERSIZED_SSE_NOTICE,
} from "./streaming-pure";

export { StreamEvent };

export interface StreamChatOptions {
  message: string;
  systemPrompt?: string;
  conversationId?: string;
  model?: string;
  maxTokens?: number;
  capability?: string;
  userId?: string;
  /** 图片附件 */
  attachments?: MessageAttachment[];
  /** Cached problem context id for follow-up questions */
  problemContextId?: string;
  /** 历史对话上下文，用于多轮记忆 */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  onEvent: (event: StreamEvent) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

function toGatewayAttachments(attachments?: MessageAttachment[]) {
  return (attachments ?? [])
    .filter((a) => a.objectKey || a.object_key || a.base64)
    .map((a) => {
      const objectKey = a.objectKey || a.object_key;
      return {
        type: a.type,
        object_key: objectKey,
        url: a.url || a.file_url,
        // Once an attachment is in object storage, only send the lightweight
        // reference. Re-sending base64 duplicates memory and request payload.
        base64: objectKey ? undefined : a.base64,
        filename:
          a.name || a.file_name || (a.type === "image" ? "image.jpg" : "file"),
        mime_type:
          a.mimeType ||
          a.mime_type ||
          (a.type === "image" ? "image/jpeg" : "application/octet-stream"),
        size: a.size || a.file_size,
        sha256: a.sha256,
        metadata: a.metadata,
      };
    });
}

async function uploadAttachmentIfNeeded(
  attachment: MessageAttachment,
  requestId?: string,
): Promise<MessageAttachment> {
  if (attachment.objectKey || attachment.object_key || !attachment.uri)
    return attachment;

  const controller = new AbortController();
  const uploadTimeoutMs =
    attachment.type === "image" ? IMAGE_UPLOAD_TIMEOUT_MS : API_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), uploadTimeoutMs);
  const startedAt = Date.now();
  const fileName =
    attachment.name || (attachment.type === "image" ? "image.jpg" : "file");
  const mimeType =
    attachment.mimeType ||
    (attachment.type === "image" ? "image/jpeg" : "application/octet-stream");
  const headers = {
    ...(BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}),
    ...(requestId ? { "X-Request-ID": requestId } : {}),
    ...TUNNEL_HEADERS,
  };

  try {
    let status = 0;
    let responseBody = "";

    if (Platform.OS === "web") {
      const source = await fetch(attachment.uri);
      const blob = await source.blob();
      const formData = new FormData();
      formData.append("file", blob, fileName);
      const response = await fetch(`${GATEWAY_URL}/v1/uploads`, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
      });
      status = response.status;
      responseBody = await response.text().catch(() => "");
    } else {
      const result = await new File(attachment.uri).upload(
        `${GATEWAY_URL}/v1/uploads`,
        {
          httpMethod: "POST",
          uploadType: UploadType.MULTIPART,
          fieldName: "file",
          mimeType,
          headers,
          parameters: { filename: fileName },
          signal: controller.signal,
          sessionType: "foreground",
        },
      );
      status = result.status;
      responseBody = result.body || "";
    }

    if (status < 200 || status >= 300) {
      throw new Error(`上传附件失败: HTTP ${status} ${responseBody}`);
    }

    const payload = JSON.parse(responseBody) as {
      object_key?: string;
      url?: string;
      size?: number;
      content_type?: string;
      sha256?: string;
    };
    if (!payload.object_key) {
      throw new Error("上传附件失败: Gateway 未返回 object_key");
    }
    console.log(
      "[streaming] 附件上传完成:",
      `type=${attachment.type}`,
      `bytes=${payload.size || attachment.size || 0}`,
      `ms=${Date.now() - startedAt}`,
    );
    attachment.objectKey = payload.object_key;
    attachment.url = payload.url;
    attachment.size = payload.size || attachment.size;
    attachment.mimeType = payload.content_type || attachment.mimeType;
    attachment.sha256 = payload.sha256 || attachment.sha256;
    delete attachment.base64;
    return attachment;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadAttachmentsIfNeeded(
  attachments?: MessageAttachment[],
  options?: { requestId?: string },
): Promise<MessageAttachment[] | undefined> {
  if (!attachments?.length) return undefined;
  return Promise.all(
    attachments.map((attachment) =>
      uploadAttachmentIfNeeded(attachment, options?.requestId),
    ),
  );
}

/**
 * Stream chat with automatic retry on transient failures
 * and circuit breaker protection against cascading failures.
 */
export async function streamChatWithRetry(
  options: StreamChatOptions,
  maxRetries = 3,
): Promise<void> {
  // Circuit breaker check — fast-fail when network is unstable
  if (!streamingCircuitBreaker.canRequest()) {
    const status = streamingCircuitBreaker.getStatus();
    const retryAfterSec = Math.ceil((status.nextRetryTime - Date.now()) / 1000);
    options.onError(new CircuitBreakerOpenError(retryAfterSec * 1000));
    return;
  }

  let attempt = 0;

  while (attempt < maxRetries) {
    let shouldRetry = false;
    let lastError: Error | null = null;
    let sawAnyEvent = false;

    await streamChatWithFetch({
      ...options,
      onEvent: (event) => {
        sawAnyEvent = true;
        options.onEvent(event);
      },
      onError: (error: Error) => {
        lastError = error;
        attempt++;
        if (
          attempt >= maxRetries ||
          sawAnyEvent ||
          !isRetryableStreamError(error)
        ) {
          options.onError(error);
        } else {
          shouldRetry = true;
        }
      },
    });

    if (!shouldRetry) {
      // User-initiated cancellation — don't affect circuit breaker
      if (options.signal?.aborted) return;

      // Success or final failure — update breaker accordingly
      // 只对网络层失败（HTTP 5xx / 连接失败）计入熔断器；
      // 服务端输出限制、模型 length 停止、客户端渲染截断等不应触发熔断保护。
      if (lastError) {
        if (isNetworkError(lastError)) {
          streamingCircuitBreaker.recordFailure();
        } else {
          // 非网络错误（语义终止、参数错误等）重置失败计数
          streamingCircuitBreaker.recordSuccess();
        }
      } else {
        streamingCircuitBreaker.recordSuccess();
      }
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

const IMAGE_UPLOAD_TIMEOUT_MS = 120000; // 图片经过压缩后仍可能在真机/隧道网络下上传较慢
const FETCH_TIMEOUT_MS = 30000; // 30 秒建连超时
const STREAM_IDLE_TIMEOUT_MS = 45000; // SSE 建立后，超过该时间无任何字节活动才判定超时
const STREAM_VISIBLE_IDLE_TIMEOUT_MS = 15000; // heartbeat 不算可见内容，避免 UI 一直流式重渲染
const STREAM_NO_VISIBLE_CONTENT_TIMEOUT_MS = 60000; // 只有 thinking/heartbeat 时，不能无限等待正文
const STREAM_MAX_DURATION_MS = 180000; // 防止 heartbeat 持续但服务端永远不发送 done
const FINAL_MARKDOWN_DONE_GRACE_MS = 1500; // final_markdown 已是完整答案，done 被后置工作拖住时本地收束
const CLIENT_TEXT_EVENT_MAX_CHARS = 12000;
const CLIENT_CODE_EVENT_MAX_CHARS = 8000;
const SSE_BUFFER_MAX_CHARS = 128000;

const CAPABILITY_STREAM_MAX_DURATION_MS: Record<string, number> = {
  [CAPABILITY_IDS.visual_solve_fast]: 480000,
  [CAPABILITY_IDS.deep_solve]: 480000,
  [CAPABILITY_IDS.deep_question]: 300000,
  [CAPABILITY_IDS.deep_research]: 420000,
  [CAPABILITY_IDS.math_animator]: 660000,
  [CAPABILITY_IDS.visualize]: 360000,
};

function streamMaxDurationMsForCapability(capability: string): number {
  return (
    CAPABILITY_STREAM_MAX_DURATION_MS[capability] || STREAM_MAX_DURATION_MS
  );
}

// 移动端渲染预算：超过后停止将事件转发给 UI 渲染，但仍继续接收流
// 以确保 final_markdown / done 等收束事件能被完整处理。
const STREAM_CLIENT_VISIBLE_CHAR_LIMIT = 8000;
const FAST_CHAT_CAPABILITIES = new Set<string>([
  CAPABILITY_IDS.ai_tutor_chat,
  CAPABILITY_IDS.auto,
]);

export async function streamChatWithFetch(
  options: StreamChatOptions,
): Promise<void> {
  const {
    message,
    systemPrompt,
    conversationId,
    model,
    maxTokens,
    capability,
    userId,
    attachments,
    problemContextId,
    onEvent,
    onComplete,
    onError,
    signal,
  } = options;

  const token = BEARER_TOKEN;
  const requestId = conversationId || `mobile-${Date.now()}`;

  // === STAGE-0: 开始处理 ===
  const streamOverallStart = Date.now();
  console.log(
    "[STAGE-0-start] 开始流式请求",
    `requestId=${requestId}`,
    `model=${model}`,
    `capability=${capability}`,
    `msgLen=${message.length}`,
    `hasAttachments=${Boolean(attachments?.length)}`,
    `attachmentCount=${attachments?.length || 0}`,
  );

  const uploadStartedAt = Date.now();
  const uploadedAttachments = await uploadAttachmentsIfNeeded(attachments, {
    requestId,
  });
  const clientUploadMs = Date.now() - uploadStartedAt;
  const gatewayAttachments = toGatewayAttachments(uploadedAttachments);
  const hasImages = gatewayAttachments.some((a) => a.type === "image");
  const hasFiles = gatewayAttachments.some((a) => a.type === "file");
  const totalBytes = gatewayAttachments.reduce(
    (sum, item) => sum + (item.size || 0),
    0,
  );
  console.log(
    "[STAGE-1-upload] 附件准备完成",
    `requestId=${requestId}`,
    `uploadedCount=${uploadedAttachments?.length || 0}`,
    `hasImages=${hasImages}`,
    `hasFiles=${hasFiles}`,
    `totalBytes=${totalBytes}`,
    `uploadMs=${clientUploadMs}`,
    `elapsedMs=${Date.now() - streamOverallStart}`,
  );
  if (gatewayAttachments.length) {
    onEvent({
      type: "upload_status",
      data: {
        status: "uploaded",
        request_id: requestId,
        attachment_count: gatewayAttachments.length,
        image_count: hasImages
          ? gatewayAttachments.filter((item) => item.type === "image").length
          : 0,
        file_count: hasFiles
          ? gatewayAttachments.filter((item) => item.type === "file").length
          : 0,
        upload_ms: clientUploadMs,
        total_bytes: totalBytes,
      },
    });
  }
  const userContent =
    message ||
    (hasImages ? "请分析这张图片" : hasFiles ? "请分析这个文件" : "");

  const messages: { role: string; content: unknown }[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  if (options.history?.length) {
    messages.push(...options.history);
  }
  messages.push({ role: "user", content: userContent });

  const url = `${GATEWAY_URL}/v1/ai/chat`;

  const normalizedCap =
    normalizeCapability(capability) || CAPABILITY_IDS.ai_tutor_chat;
  const requestMode = FAST_CHAT_CAPABILITIES.has(normalizedCap)
    ? "fast"
    : "auto";
  const resolvedModel =
    model && (!hasImages || modelSupportsVision(model))
      ? model
      : hasImages
        ? getDefaultVisionModel(normalizedCap)
        : getDefaultModelForCapability(normalizedCap) || DEFAULT_MODEL;
  const streamMaxDurationMs = streamMaxDurationMsForCapability(normalizedCap);

  const body = {
    messages,
    model: resolvedModel,
    api_key: "",
    capability: normalizedCap,
    user_id: userId || "mobile-user",
    request_id: requestId,
    streaming: true,
    max_tokens: maxTokens,
    mode: requestMode,
    attachments: gatewayAttachments,
    problem_context_id: problemContextId,
  };

  if (gatewayAttachments.length) {
    console.log(
      "[STAGE-2-send] 发送请求到网关",
      `requestId=${requestId}`,
      `url=${url}`,
      `attachments=${gatewayAttachments.length}`,
      `bytes=${totalBytes}`,
      `capability=${normalizedCap}`,
      `mode=${requestMode}`,
      `elapsedMs=${Date.now() - streamOverallStart}`,
    );
  } else {
    console.log(
      "[STAGE-2-send] 发送请求到网关",
      `requestId=${requestId}`,
      `capability=${normalizedCap}`,
      `mode=${requestMode}`,
      `elapsedMs=${Date.now() - streamOverallStart}`,
    );
  }

  // 组合超时 + 用户取消信号
  const timeoutController = new AbortController();
  let timeoutReason: "connect" | "idle" = "connect";
  let timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const armTimeout = (ms: number, reason: "connect" | "idle") => {
    clearTimeout(timeoutId);
    timeoutReason = reason;
    timeoutId = setTimeout(() => timeoutController.abort(), ms);
  };

  // 显式跟踪 abort 状态：某些运行时下 AbortSignal 不会立刻阻止后续事件回调，
  // 用本地标志作为第二道防线，确保 abort 后的事件不再进入 UI 累积。
  let aborted = false;
  const markAborted = () => {
    aborted = true;
  };
  if (signal) {
    if (signal.aborted) {
      markAborted();
    } else {
      signal.addEventListener("abort", markAborted, { once: true });
    }
  }
  timeoutController.signal.addEventListener("abort", markAborted, {
    once: true,
  });

  let combinedSignal: AbortSignal;
  try {
    combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
  } catch {
    // AbortSignal.any 不可用时降级：手动组合两个信号
    if (signal) {
      const fallbackController = new AbortController();
      const onAbort = () => fallbackController.abort();
      if (signal.aborted) {
        fallbackController.abort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      timeoutController.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      combinedSignal = fallbackController.signal;
    } else {
      combinedSignal = timeoutController.signal;
    }
  }

  // 防止 onComplete 被调用多次
  let completed = false;
  let sawAnyEvent = false;
  let sawUserVisibleEvent = false;
  let visibleContentChars = 0;
  let rawBytesRead = 0;
  let sseEventCount = 0;
  let textDeltaCount = 0;
  let finalMarkdownChars = 0;
  let lastEventLogAt = Date.now();
  let visibleIdleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let noVisibleContentTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let finalMarkdownGraceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const clearVisibleIdleTimeout = () => {
    if (visibleIdleTimeoutId) {
      clearTimeout(visibleIdleTimeoutId);
      visibleIdleTimeoutId = null;
    }
  };
  const clearNoVisibleContentTimeout = () => {
    if (noVisibleContentTimeoutId) {
      clearTimeout(noVisibleContentTimeoutId);
      noVisibleContentTimeoutId = null;
    }
  };
  const clearFinalMarkdownGraceTimeout = () => {
    if (finalMarkdownGraceTimeoutId) {
      clearTimeout(finalMarkdownGraceTimeoutId);
      finalMarkdownGraceTimeoutId = null;
    }
  };
  const cleanupStreamTimers = () => {
    clearTimeout(timeoutId);
    clearTimeout(hardTimeoutId);
    clearVisibleIdleTimeout();
    clearNoVisibleContentTimeout();
    clearFinalMarkdownGraceTimeout();
  };
  const safeOnComplete = () => {
    if (completed) return;
    completed = true;
    cleanupStreamTimers();
    const totalElapsed = Date.now() - streamOverallStart;
    console.log(
      "[STAGE-COMPLETE] stream completed",
      `requestId=${requestId}`,
      `totalElapsedMs=${totalElapsed}`,
      `visibleContentChars=${visibleContentChars}`,
      `sawUserVisibleEvent=${sawUserVisibleEvent}`,
      `firstSseEventMs=${firstSseEventMs}`,
      `maxDurationReached=${maxDurationReached}`,
      `uiRenderSuspended=${uiRenderSuspended}`,
      `streamConnectMs=${streamConnectMs}`,
    );
    debugLog("streaming", "complete", {
      requestId,
      totalElapsedMs: totalElapsed,
      rawBytesRead,
      sseEventCount,
      textDeltaCount,
      visibleContentChars,
      finalMarkdownChars,
      uiRenderSuspended,
      streamConnectMs,
    });
    onComplete();
  };
  const safeOnError = (err: Error) => {
    if (completed) return;
    completed = true;
    cleanupStreamTimers();
    const totalElapsed = Date.now() - streamOverallStart;
    console.error(
      "[STAGE-ERROR] stream error",
      `requestId=${requestId}`,
      `totalElapsedMs=${totalElapsed}`,
      `visibleContentChars=${visibleContentChars}`,
      `sawUserVisibleEvent=${sawUserVisibleEvent}`,
      `firstSseEventMs=${firstSseEventMs}`,
      `error=${err.message}`,
    );
    debugError("streaming", "error", {
      requestId,
      totalElapsedMs: totalElapsed,
      rawBytesRead,
      sseEventCount,
      textDeltaCount,
      visibleContentChars,
      finalMarkdownChars,
      error: err.message,
    });
    onError(err);
  };
  const completeOrErrorOnIdleTimeout = () => {
    if (sawUserVisibleEvent) {
      safeOnComplete();
    } else {
      safeOnError(new Error("响应超时，请重试"));
    }
  };
  let maxDurationReached = false;
  let completeLocallyAfterAbort = false;
  const armFinalMarkdownGraceTimeout = () => {
    clearFinalMarkdownGraceTimeout();
    finalMarkdownGraceTimeoutId = setTimeout(() => {
      if (completed) return;
      completeLocallyAfterAbort = true;
      console.warn(
        "[STAGE-FINAL-GRACE] done not received after final_markdown",
        {
          requestId,
          graceMs: FINAL_MARKDOWN_DONE_GRACE_MS,
          totalElapsedMs: Date.now() - streamOverallStart,
          sseEventCount,
          finalMarkdownChars,
        },
      );
      timeoutController.abort();
      safeOnComplete();
    }, FINAL_MARKDOWN_DONE_GRACE_MS);
  };
  // 当可见内容超过预算时，不再向 UI 推送渲染事件，但仍继续读取流
  let uiRenderSuspended = false;
  const hardTimeoutId = setTimeout(() => {
    maxDurationReached = true;
    completeLocallyAfterAbort = true;
    timeoutController.abort();
    const totalElapsed = Date.now() - streamOverallStart;
    console.warn("[STAGE-TIMEOUT] max duration timeout", {
      requestId,
      maxDurationMs: streamMaxDurationMs,
      totalElapsedMs: totalElapsed,
      sawUserVisibleEvent,
      visibleContentChars,
    });
    if (sawUserVisibleEvent) {
      safeOnComplete();
    } else {
      safeOnError(new Error("响应超时，请重试"));
    }
  }, streamMaxDurationMs);
  const armVisibleIdleTimeout = () => {
    clearVisibleIdleTimeout();
    visibleIdleTimeoutId = setTimeout(() => {
      if (completed || !sawUserVisibleEvent) return;
      console.warn(
        "[STAGE-TIMEOUT] visible idle timeout - no visible content updates",
        {
          requestId,
          visibleIdleMs: STREAM_VISIBLE_IDLE_TIMEOUT_MS,
          totalElapsedMs: Date.now() - streamOverallStart,
        },
      );
      completeLocallyAfterAbort = true;
      timeoutController.abort();
      safeOnComplete();
    }, STREAM_VISIBLE_IDLE_TIMEOUT_MS);
  };
  noVisibleContentTimeoutId = setTimeout(() => {
    if (completed || sawUserVisibleEvent) return;
    console.warn(
      "[STAGE-TIMEOUT] no visible content timeout - no text received",
      {
        requestId,
        noVisibleContentMs: STREAM_NO_VISIBLE_CONTENT_TIMEOUT_MS,
        totalElapsedMs: Date.now() - streamOverallStart,
        sawAnyEvent,
        firstSseEventMs,
      },
    );
    timeoutController.abort();
    safeOnError(new Error("AI长时间没有返回正文，请重试或切换快速解题"));
  }, STREAM_NO_VISIBLE_CONTENT_TIMEOUT_MS);

  let response: Response;
  const fetchStartedAt = Date.now();
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Request-ID": requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...TUNNEL_HEADERS,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    if (isAbortLikeError(err)) {
      // 用户取消或超时
      if (signal?.aborted) {
        cleanupStreamTimers();
        return;
      }
      if (timeoutController.signal.aborted) {
        safeOnError(
          new Error(
            timeoutReason === "connect"
              ? "请求超时，请检查网络连接"
              : "响应超时，请重试",
          ),
        );
      }
      return;
    }
    safeOnError(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  armTimeout(STREAM_IDLE_TIMEOUT_MS, "idle");
  const streamConnectMs = Date.now() - fetchStartedAt;

  console.log(
    "[STAGE-3-connected] connected to gateway",
    `requestId=${requestId}`,
    `httpStatus=${response.status}`,
    `connectMs=${streamConnectMs}`,
    `elapsedMs=${Date.now() - streamOverallStart}`,
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    safeOnError(
      new Error(
        `HTTP ${response.status}: ${responseBody || response.statusText}`,
      ),
    );
    return;
  }

  const reader = response.body?.getReader?.();
  let firstSseEventMs: number | null = null;
  let sawRenderMetrics = false;

  const truncateForMobile = (text: string | undefined, maxChars: number) => {
    if (!text || text.length <= maxChars) return text || "";
    return (
      text.slice(0, maxChars) +
      `\n\n[内容过长，移动端已截断显示，原始长度 ${text.length} 字符]`
    );
  };

  const sanitizeEventForMobile = (event: StreamEvent): StreamEvent => {
    if (event.type === "text_delta") {
      return {
        ...event,
        data: {
          ...event.data,
          content: truncateForMobile(
            event.data.content,
            CLIENT_TEXT_EVENT_MAX_CHARS,
          ),
        },
      };
    }
    if (event.type === "final_markdown") {
      const originalLength = event.data.content?.length || 0;
      const content = truncateForMobile(
        event.data.content,
        CLIENT_TEXT_EVENT_MAX_CHARS,
      );
      return {
        ...event,
        data: {
          ...event.data,
          content,
          partial: event.data.partial || originalLength > content.length,
          finish_reason:
            originalLength > content.length
              ? "server_char_limit"
              : event.data.finish_reason,
        },
      };
    }
    if (event.type === "capability_result") {
      return {
        ...event,
        data: {
          ...event.data,
          content: truncateForMobile(
            event.data.content,
            CLIENT_TEXT_EVENT_MAX_CHARS,
          ),
          code: event.data.code
            ? {
                ...event.data.code,
                content: truncateForMobile(
                  event.data.code.content,
                  CLIENT_CODE_EVENT_MAX_CHARS,
                ),
              }
            : event.data.code,
        },
      };
    }
    return event;
  };

  const visibleContentLengthForEvent = (event: StreamEvent): number => {
    if (event.type === "text_delta") {
      return event.data.content.length;
    }
    if (event.type === "capability_result") {
      return (
        (event.data.content?.length || 0) +
        (event.data.code?.content?.length || 0) +
        (event.data.artifacts?.length ? 1 : 0)
      );
    }
    if (event.type === "final_markdown") {
      return event.data.content?.length || 0;
    }
    return 0;
  };

  const emitSingleEvent = (rawEvent: StreamEvent) => {
    const event = sanitizeEventForMobile(rawEvent);
    if (completed || aborted) {
      if (aborted && !completed) {
        debugWarn("streaming", "event_after_abort", {
          requestId,
          type: event.type,
          sseEventCount,
          textDeltaCount,
        });
      }
      return;
    }
    sawAnyEvent = true;
    sseEventCount += 1;
    if (event.type === "text_delta") textDeltaCount += 1;
    if (event.type === "final_markdown") {
      finalMarkdownChars = event.data.content?.length || 0;
    }
    if (firstSseEventMs === null) {
      firstSseEventMs = Date.now() - fetchStartedAt;
      console.log(
        "[STAGE-4-first-event] first SSE event received",
        `requestId=${requestId}`,
        `firstEventMs=${firstSseEventMs}`,
        `eventType=${event.type}`,
        `elapsedMs=${Date.now() - streamOverallStart}`,
      );
      debugLog("streaming", "first_event", {
        requestId,
        eventType: event.type,
        firstEventMs: firstSseEventMs,
        streamConnectMs,
      });
    }
    const visibleContentDelta = visibleContentLengthForEvent(event);
    const now = Date.now();
    if (
      event.type !== "heartbeat" &&
      (event.type !== "text_delta" ||
        textDeltaCount <= 5 ||
        now - lastEventLogAt > 1500)
    ) {
      lastEventLogAt = now;
      debugLog("streaming", "event", {
        requestId,
        type: event.type,
        count: sseEventCount,
        textDeltaCount,
        deltaChars: visibleContentDelta,
        visibleContentChars,
        rawBytesRead,
      });
    }
    // 任何 SSE 事件（包括 thinking/heartbeat/vision_status）都说明连接存活，
    // 应重置"无内容"超时。正文卡住由 armVisibleIdleTimeout（15s）保护，
    // 总时长由 STREAM_MAX_DURATION_MS（180s）保护。
    clearNoVisibleContentTimeout();
    if (visibleContentDelta > 0) {
      sawUserVisibleEvent = true;
      armVisibleIdleTimeout();
    }
    armTimeout(STREAM_IDLE_TIMEOUT_MS, "idle");
    if (event.type === "render_metrics") {
      sawRenderMetrics = true;
      onEvent({
        ...event,
        data: {
          ...event.data,
          request_id:
            typeof event.data.request_id === "string"
              ? event.data.request_id
              : requestId,
          client_upload_ms: clientUploadMs,
          client_total_bytes: totalBytes,
          stream_connect_ms: streamConnectMs,
          first_sse_event_ms: firstSseEventMs,
        },
      });
      return;
    }
    // 超过渲染预算后，暂停向 UI 推送内容型事件，但继续静默读取流
    // 收束型事件（final_markdown / done / error）始终正常转发，确保状态同步。
    if (
      !uiRenderSuspended &&
      visibleContentChars >= STREAM_CLIENT_VISIBLE_CHAR_LIMIT &&
      event.type !== "final_markdown" &&
      event.type !== "done" &&
      event.type !== "error"
    ) {
      uiRenderSuspended = true;
      console.warn(
        "[streaming] 移动端可见内容超过渲染预算，暂停 UI 推送但继续接收流",
        {
          requestId,
          visibleContentChars,
          limit: STREAM_CLIENT_VISIBLE_CHAR_LIMIT,
        },
      );
      debugWarn("streaming", "ui_render_suspended", {
        requestId,
        visibleContentChars,
        limit: STREAM_CLIENT_VISIBLE_CHAR_LIMIT,
        sseEventCount,
        textDeltaCount,
      });
      // 发送一个合成事件通知 UI 内容已截断
      onEvent({
        type: "text_delta",
        data: {
          content: "\n\n[内容较长，完整内容仍在生成和保存]",
          messageId: requestId,
        },
      });
      return;
    }
    if (uiRenderSuspended) {
      // 静默阶段：只转发收束事件（final_markdown / done / error），
      // 跳过 text_delta 等纯渲染事件
      const isCompletionEvent =
        event.type === "final_markdown" ||
        event.type === "done" ||
        event.type === "error";
      if (isCompletionEvent) {
        onEvent(event);
      }
      visibleContentChars += visibleContentDelta;
      armTimeout(STREAM_IDLE_TIMEOUT_MS, "idle");
      return;
    }
    onEvent(event);
    visibleContentChars += visibleContentDelta;
  };

  /**
   * 借鉴 Open WebUI：单个大 text_delta 拆成小块后依次 emit，
   * 让上层（chatSlice / MessageContentRenderer）可以按更细粒度渐进渲染。
   */
  const emitEvent = (rawEvent: StreamEvent) => {
    if (
      rawEvent.type === "text_delta" &&
      rawEvent.data.content.length > TEXT_DELTA_CHUNK_SIZE
    ) {
      for (const chunk of splitTextDeltaContent(rawEvent.data.content)) {
        emitSingleEvent({
          ...rawEvent,
          data: { ...rawEvent.data, content: chunk },
        });
      }
      return;
    }
    emitSingleEvent(rawEvent);
  };

  const emitSyntheticMetrics = () => {
    if (sawRenderMetrics) return;
    sawRenderMetrics = true;
    onEvent({
      type: "render_metrics",
      data: {
        request_id: requestId,
        client_upload_ms: clientUploadMs,
        client_total_bytes: totalBytes,
        stream_connect_ms: streamConnectMs,
        first_sse_event_ms:
          firstSseEventMs === null
            ? Date.now() - fetchStartedAt
            : firstSseEventMs,
        done_received_ms: Date.now() - fetchStartedAt,
      },
    });
  };

  if (reader) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armTimeout(STREAM_IDLE_TIMEOUT_MS, "idle");
        rawBytesRead += value?.byteLength || 0;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > SSE_BUFFER_MAX_CHARS && !buffer.includes("\n")) {
          const ev = parseSSELine(buffer);
          buffer = "";
          if (ev) {
            if (ev.type === "done") {
              emitSyntheticMetrics();
            }
            emitEvent(ev);
            if (completed) {
              return;
            }
            if (ev.type === "final_markdown") {
              armFinalMarkdownGraceTimeout();
            }
            if (ev.type === "done") {
              safeOnComplete();
              return;
            }
            if (ev.type === "error") {
              safeOnError(new Error(ev.data?.message || "Unknown error"));
              return;
            }
          }
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const ev = parseSSELine(line);
          if (!ev) continue;
          if (ev.type === "done") {
            emitSyntheticMetrics();
          }
          emitEvent(ev);
          if (completed) {
            return;
          }
          if (ev.type === "final_markdown") {
            armFinalMarkdownGraceTimeout();
          }
          if (ev.type === "done") {
            safeOnComplete();
            return;
          }
          if (ev.type === "error") {
            safeOnError(new Error(ev.data?.message || "Unknown error"));
            return;
          }
        }
      }
      // 处理剩余 buffer
      for (const line of buffer.split("\n")) {
        const ev = parseSSELine(line);
        if (!ev) continue;
        if (ev.type === "done") {
          emitSyntheticMetrics();
        }
        emitEvent(ev);
        if (completed) {
          return;
        }
        if (ev.type === "final_markdown") {
          armFinalMarkdownGraceTimeout();
        }
        if (ev.type === "done") {
          safeOnComplete();
          return;
        }
        if (ev.type === "error") {
          safeOnError(new Error(ev.data?.message || "Unknown error"));
          return;
        }
      }
      safeOnComplete();
    } catch (err) {
      if (isAbortLikeError(err)) {
        if (signal?.aborted) {
          cleanupStreamTimers();
          return;
        }
        if (timeoutController.signal.aborted) {
          if (maxDurationReached || completeLocallyAfterAbort) {
            safeOnComplete();
            return;
          }
          console.warn("[streaming] 空闲超时中断", {
            requestId,
            sawAnyEvent,
            sawUserVisibleEvent,
            firstSseEventMs,
          });
          completeOrErrorOnIdleTimeout();
          return;
        }
        safeOnError(new Error("连接已中断，请重试"));
        return;
      }
      safeOnError(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }

  // Fallback: 读取完整响应
  try {
    const text = await response.text();
    for (const line of text.split("\n")) {
      const ev = parseSSELine(line);
      if (!ev) continue;
      if (ev.type === "done") {
        emitSyntheticMetrics();
      }
      emitEvent(ev);
      if (completed) {
        return;
      }
      if (ev.type === "final_markdown") {
        armFinalMarkdownGraceTimeout();
      }
      if (ev.type === "done") {
        safeOnComplete();
        return;
      }
      if (ev.type === "error") {
        safeOnError(new Error(ev.data?.message || "Unknown error"));
        return;
      }
    }
    safeOnComplete();
  } catch (err) {
    if (isAbortLikeError(err)) {
      if (signal?.aborted) {
        cleanupStreamTimers();
        return;
      }
      if (timeoutController.signal.aborted) {
        if (maxDurationReached || completeLocallyAfterAbort) {
          safeOnComplete();
          return;
        }
        console.warn("[streaming] 空闲超时中断", {
          requestId,
          sawAnyEvent,
          sawUserVisibleEvent,
          firstSseEventMs,
        });
        completeOrErrorOnIdleTimeout();
        return;
      }
      safeOnError(new Error("连接已中断，请重试"));
      return;
    }
    safeOnError(err instanceof Error ? err : new Error(String(err)));
  }
}
