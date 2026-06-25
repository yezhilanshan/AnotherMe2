import {
  GATEWAY_URL,
  BEARER_TOKEN,
  TUNNEL_HEADERS,
  DEFAULT_MODEL,
  API_TIMEOUT,
} from "./config";
import { normalizeCapability, CAPABILITY_IDS } from "./config";
import {
  streamingCircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit-breaker";
import type { MessageAttachment } from "./types";

export type StreamEvent =
  | {
      type: "agent_start";
      data: { messageId: string; agentId: string; agentName: string };
    }
  | {
      type: "thinking";
      data: { stage: string; agentId: string; reasoning: string };
    }
  | { type: "text_delta"; data: { content: string; messageId: string } }
  | { type: "final_markdown"; data: { content: string; messageId: string } }
  | {
      type: "capability_result";
      data: {
        messageId: string;
        content: string;
        output_mode: string;
        render_type?: string;
        artifacts: Array<{
          type: string;
          url: string;
          filename: string;
          label: string;
        }>;
        code: { language: string; content: string };
        analysis?: Record<string, unknown>;
        review?: Record<string, unknown>;
        summary: Record<string, unknown>;
      };
    }
  | {
      type: "done";
      data: {
        totalActions: number;
        totalAgents: number;
        agentHadContent: boolean;
      };
    }
  | { type: "error"; data: { message: string } }
  | {
      type: "extraction_results";
      data: {
        results: Array<{
          filename: string;
          status: string;
          text_length?: number;
          truncated?: boolean;
          error?: string;
          note?: string;
          document_id?: string;
        }>;
        document_ids: string[];
      };
    }
  | {
      type: "retrieval_results";
      data: {
        query: string;
        chunks: Array<{
          chunk_id: string;
          filename: string;
          page: number | null;
          sheet_name: string | null;
          score: number;
          preview: string;
        }>;
      };
    };

export interface StreamChatOptions {
  message: string;
  systemPrompt?: string;
  conversationId?: string;
  model?: string;
  capability?: string;
  userId?: string;
  /** 图片附件 */
  attachments?: MessageAttachment[];
  onEvent: (event: StreamEvent) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

function parseSSELine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (!trimmed.startsWith("data: ")) return null;
  try {
    return JSON.parse(trimmed.slice(6)) as StreamEvent;
  } catch {
    return null;
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.message.toLowerCase().includes("aborted")
  );
}

function toGatewayAttachments(attachments?: MessageAttachment[]) {
  return (attachments ?? [])
    .filter((a) => a.objectKey || a.object_key || a.base64)
    .map((a) => ({
      type: a.type,
      object_key: a.objectKey || a.object_key,
      url: a.url || a.file_url,
      base64: a.objectKey || a.object_key ? undefined : a.base64,
      filename: a.name || a.file_name || (a.type === "image" ? "image.jpg" : "file"),
      mime_type:
        a.mimeType ||
        a.mime_type ||
        (a.type === "image" ? "image/jpeg" : "application/octet-stream"),
      size: a.size || a.file_size,
      metadata: a.metadata,
    }));
}

async function uploadAttachmentIfNeeded(
  attachment: MessageAttachment,
): Promise<MessageAttachment> {
  if (attachment.objectKey || attachment.object_key || !attachment.uri) return attachment;

  const formData = new FormData();
  formData.append("file", {
    uri: attachment.uri,
    name: attachment.name || (attachment.type === "image" ? "image.jpg" : "file"),
    type:
      attachment.mimeType ||
      (attachment.type === "image" ? "image/jpeg" : "application/octet-stream"),
  } as unknown as Blob);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/uploads`, {
      method: "POST",
      headers: {
        ...(BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}),
        ...TUNNEL_HEADERS,
      },
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`上传附件失败: HTTP ${response.status} ${body}`);
    }
    const payload = (await response.json()) as {
      object_key?: string;
      url?: string;
      size?: number;
      content_type?: string;
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
    attachment.base64 = undefined;
    return attachment;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadAttachmentsIfNeeded(
  attachments?: MessageAttachment[],
): Promise<MessageAttachment[] | undefined> {
  if (!attachments?.length) return undefined;
  return Promise.all(attachments.map(uploadAttachmentIfNeeded));
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

    await streamChatWithFetch({
      ...options,
      onError: (error: Error) => {
        lastError = error;
        attempt++;
        if (attempt >= maxRetries) {
          options.onError(error);
        } else {
          shouldRetry = true;
        }
      },
    });

    if (!shouldRetry) {
      // Success or final failure — update breaker accordingly
      if (lastError) {
        streamingCircuitBreaker.recordFailure();
      } else {
        streamingCircuitBreaker.recordSuccess();
      }
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

const FETCH_TIMEOUT_MS = 30000; // 30 秒超时
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
    capability,
    userId,
    attachments,
    onEvent,
    onComplete,
    onError,
    signal,
  } = options;

  const token = BEARER_TOKEN;

  const uploadStartedAt = Date.now();
  const uploadedAttachments = await uploadAttachmentsIfNeeded(attachments);
  if (uploadedAttachments?.length) {
    console.log(
      "[streaming] 附件引用准备完成:",
      `attachments=${uploadedAttachments.length}`,
      `ms=${Date.now() - uploadStartedAt}`,
    );
  }
  const gatewayAttachments = toGatewayAttachments(uploadedAttachments);
  const hasImages = gatewayAttachments.some((a) => a.type === "image");
  const hasFiles = gatewayAttachments.some((a) => a.type === "file");
  const userContent =
    message || (hasImages ? "请分析这张图片" : hasFiles ? "请分析这个文件" : "");

  const messages: { role: string; content: unknown }[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userContent });

  const url = `${GATEWAY_URL}/v1/ai/chat`;

  const normalizedCap =
    normalizeCapability(capability) || CAPABILITY_IDS.ai_tutor_chat;
  const requestMode = FAST_CHAT_CAPABILITIES.has(normalizedCap) ? "fast" : "auto";

  const body = {
    messages,
    model: model || DEFAULT_MODEL,
    api_key: "",
    capability: normalizedCap,
    user_id: userId || "mobile-user",
    request_id: conversationId || `mobile-${Date.now()}`,
    streaming: true,
    mode: requestMode,
    attachments: gatewayAttachments,
  };

  if (gatewayAttachments.length) {
    const totalBytes = gatewayAttachments.reduce(
      (sum, item) => sum + (item.size || 0),
      0,
    );
    console.log(
      "[streaming] 发送附件流式请求:",
      `attachments=${gatewayAttachments.length}`,
      `bytes=${totalBytes}`,
    );
  }

  // 组合超时 + 用户取消信号
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    FETCH_TIMEOUT_MS,
  );
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
      timeoutController.signal.addEventListener("abort", onAbort, { once: true });
      combinedSignal = fallbackController.signal;
    } else {
      combinedSignal = timeoutController.signal;
    }
  }

  // 防止 onComplete 被调用多次
  let completed = false;
  const safeOnComplete = () => {
    if (completed) return;
    completed = true;
    onComplete();
  };
  const safeOnError = (err: Error) => {
    if (completed) return;
    completed = true;
    onError(err);
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...TUNNEL_HEADERS,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (isAbortLikeError(err)) {
      // 用户取消或超时
      if (signal?.aborted) {
        return;
      }
      if (timeoutController.signal.aborted) {
        safeOnError(new Error("请求超时，请检查网络连接"));
      }
      return;
    }
    safeOnError(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  clearTimeout(timeoutId);

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
  if (reader) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const ev = parseSSELine(line);
          if (!ev) continue;
          onEvent(ev);
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
        onEvent(ev);
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
        if (signal?.aborted) return;
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
      onEvent(ev);
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
      if (signal?.aborted) return;
      safeOnError(new Error("连接已中断，请重试"));
      return;
    }
    safeOnError(err instanceof Error ? err : new Error(String(err)));
  }
}
