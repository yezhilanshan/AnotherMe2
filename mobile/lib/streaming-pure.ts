// streaming.ts 的纯逻辑子集：SSE 解析、错误分类、大 delta 拆分。
// 单独抽出，避免单元测试加载 react-native / expo-file-system。

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
  | {
      type: "final_markdown";
      data: {
        content: string;
        messageId: string;
        finish_reason?:
          | "stop"
          | "length"
          | "duration"
          | "server_char_limit"
          | "error"
          | "cancelled";
        partial?: boolean;
        continuation_token?: string | null;
        next_prompt_suggestion?: string | null;
        auto_continuations?: number;
        auto_continuation_reasons?: string[];
      };
    }
  | {
      type: "heartbeat";
      data: { request_id?: string; ts?: number };
    }
  | {
      type: "upload_status";
      data: {
        status: string;
        request_id?: string;
        attachment_count?: number;
        image_count?: number;
        file_count?: number;
        upload_ms?: number;
        total_bytes?: number;
        message?: string;
        filenames?: string[];
      };
    }
  | {
      type: "vision_status";
      data: {
        status: string;
        cache_hit?: boolean;
        problem_context_id?: string;
        message?: string;
      };
    }
  | {
      type: "problem_context";
      data: {
        problem_context_id: string;
        sha256?: string;
        object_key?: string;
        cache_hit?: boolean;
      };
    }
  | { type: "render_metrics"; data: Record<string, unknown> }
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
        finish_reason?:
          | "stop"
          | "length"
          | "duration"
          | "server_char_limit"
          | "error"
          | "cancelled";
        partial?: boolean;
        continuation_token?: string | null;
        auto_continuations?: number;
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

// 借鉴 Open WebUI：把单个大 text_delta 拆成小块转发，
// 让上层 flush/Markdown 解析可以按更细的粒度渐进更新，避免突发大 chunk 卡顿。
export const TEXT_DELTA_CHUNK_SIZE = 120;

export const SSE_JSON_PARSE_MAX_CHARS = 64000;
export const OVERSIZED_SSE_NOTICE =
  "\n\n[内容过长，移动端已停止解析完整响应，已保留前面流式预览]";

export function extractJsonStringField(
  source: string,
  field: string,
): string | undefined {
  const match = source.match(
    new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`),
  );
  if (!match?.[1]) return undefined;
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function parseOversizedSSEPayload(
  payloadPrefix: string,
): StreamEvent | null {
  const type = extractJsonStringField(payloadPrefix, "type");
  const messageId = extractJsonStringField(payloadPrefix, "messageId") || "";
  if (type === "final_markdown") {
    return {
      type: "final_markdown",
      data: {
        content: OVERSIZED_SSE_NOTICE,
        messageId,
        partial: true,
        finish_reason: "server_char_limit",
      },
    };
  }
  if (type === "text_delta") {
    return {
      type: "text_delta",
      data: {
        content: OVERSIZED_SSE_NOTICE,
        messageId,
      },
    };
  }
  if (type === "done") {
    return {
      type: "done",
      data: {
        totalActions: 0,
        totalAgents: 0,
        agentHadContent: true,
        partial: true,
        finish_reason: "server_char_limit",
      },
    };
  }
  if (type === "error") {
    return {
      type: "error",
      data: { message: "响应过大，移动端已停止解析" },
    };
  }
  return null;
}

export function parseSSELine(line: string): StreamEvent | null {
  const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!raw || raw.startsWith(":")) return null;
  if (!raw.startsWith("data:")) return null;
  let payloadStart = 5;
  while (raw[payloadStart] === " " || raw[payloadStart] === "\t") {
    payloadStart += 1;
  }
  if (raw.length - payloadStart > SSE_JSON_PARSE_MAX_CHARS) {
    return parseOversizedSSEPayload(
      raw.slice(payloadStart, payloadStart + 4096),
    );
  }
  const payload = raw.slice(payloadStart).trimEnd();
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as StreamEvent;
  } catch {
    return null;
  }
}

export function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("canceled") ||
    message.includes("cancelled")
  );
}

export function isRetryableStreamError(error: Error): boolean {
  const message = error.message.toLowerCase();
  if (isAbortLikeError(error)) return false;
  if (message.includes("timeout") || message.includes("超时")) return false;
  if (message.includes("http 4")) return false;
  if (message.includes("invalid_model")) return false;
  if (message.includes("model_capability_mismatch")) return false;
  return true;
}

/**
 * 判断错误是否为网络层面的失败（应计入熔断器），
 * 而非业务语义型的终止（服务端输出限制、模型 length 停止、客户端渲染截断等）。
 *
 * 网络错误：HTTP 5xx、连接超时、DNS 解析失败、fetch 本身抛出 TypeError
 * 非网络错误：HTTP 4xx（客户端参数错误）、用户主动取消、超时类（由客户端超时定时器触发）
 */
export function isNetworkError(error: Error): boolean {
  const message = error.message;
  if (isAbortLikeError(error)) return false;
  // HTTP 5xx: 服务端故障，计入熔断器
  if (/http 5\d{2}/i.test(message)) return true;
  // HTTP 4xx: 客户端参数错误，不计入
  if (/http 4\d{2}/i.test(message)) return false;
  // TypeError from fetch: 网络层失败
  if (error.name === "TypeError" && /fetch|network/i.test(message)) return true;
  // DNS / ECONNREFUSED / ENOTFOUND / ECONNRESET: 明确的网络问题
  if (/dns|econnrefused|enotfound|econnreset/i.test(message)) return true;
  // 建连超时（message 含 "请求超时" + "网络连接"），属于网络层
  if (/请求超时.*网络连接/i.test(message)) return true;
  // 空闲/响应超时、长时间无内容: 服务端或内容策略触发，非网络层
  if (/响应超时|长时间没有返回|超时/i.test(message)) return false;
  // 已知的非网络错误类型
  if (/invalid|unsupported|capability/i.test(message)) return false;
  // 默认保守：不认识的错误不计入熔断器
  return false;
}

export function splitTextDeltaContent(
  content: string,
  chunkSize = TEXT_DELTA_CHUNK_SIZE,
): string[] {
  if (content.length <= chunkSize) return [content];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
  return chunks;
}
