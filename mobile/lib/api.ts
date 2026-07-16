import { createApiClient, type ApiClient } from "@anotherme/api-client";
import {
  getGatewayUrl,
  getWebUrl,
  onGatewayConfigChange,
} from "./runtime-gateway-config";
import {
  BEARER_TOKEN,
  USER_ID,
  TUNNEL_HEADERS,
  WEB_TUNNEL_HEADERS,
} from "./config";
import { normalizeCapability, CAPABILITY_IDS } from "./config";
import { CircuitBreakerOpenError } from "./circuit-breaker";

// Re-export ApiError for backward compatibility
export { ApiError } from "@anotherme/api-client";

// ── Lazy / reactive API clients ──
// Clients are recreated whenever runtime gateway config changes,
// so the app picks up new IPs without a rebuild.

let _api!: ApiClient;
let _bffApi!: ApiClient;
let _liveBookApi!: ApiClient["liveBook"];

function recreateClients(): void {
  const gw = getGatewayUrl();
  const web = getWebUrl();

  _api = createApiClient({
    baseUrl: gw,
    getToken: () => BEARER_TOKEN,
    defaultHeaders: TUNNEL_HEADERS,
  });

  _bffApi = createApiClient({
    baseUrl: `${web}/api`,
    getToken: () => BEARER_TOKEN,
    timeout: 120000,
    defaultHeaders: WEB_TUNNEL_HEADERS,
  });

  const gwLiveBook = createApiClient({
    baseUrl: gw,
    getToken: () => BEARER_TOKEN,
    timeout: 120000,
    defaultHeaders: TUNNEL_HEADERS,
  });
  _liveBookApi = gwLiveBook.liveBook;

  // Update the live bindings so all importers see the new clients
  api = _api;
  bffApi = _bffApi;
  liveBookApi = _liveBookApi;
}

// Initial creation
recreateClients();

// Recreate when runtime config changes
onGatewayConfigChange(recreateClients);

// Export as let — ESM live bindings ensure all importers always
// read the latest reference after recreateClients() updates them.
export let api: ApiClient = _api;
export let bffApi: ApiClient = _bffApi;
export let liveBookApi: typeof _liveBookApi = _liveBookApi;

// Re-export for streaming module
export { getGatewayUrl, getWebUrl };

export function formatGatewayError(
  error: unknown,
  fallback = "请求失败",
): string {
  const gw = getGatewayUrl();
  const message =
    error instanceof Error ? error.message : String(error || fallback);
  const errorCode =
    typeof error === "object" && error !== null && "errorCode" in error
      ? String((error as { errorCode?: unknown }).errorCode || "")
      : "";

  if (error instanceof CircuitBreakerOpenError) {
    const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
    return `网络不稳定，请求已暂时暂停。请等待 ${retryAfterSec} 秒后重试。`;
  }

  if (
    errorCode === "NETWORK_ERROR" ||
    message === "Network connection failed"
  ) {
    return [
      `无法连接 Gateway：${gw}`,
      "请确认 Python Gateway 已启动并监听 0.0.0.0，手机和电脑在同一网络，Windows 防火墙允许当前端口。",
      "请在 我的 → Gateway 设置 中修改电脑局域网 IP 地址。",
    ].join("\n");
  }

  if (errorCode === "TIMEOUT" || message === "Request timed out") {
    return `Gateway 请求超时：${gw}\n请确认服务没有卡住，或稍后重试。`;
  }

  return message || fallback;
}

export function formatLiveBookError(
  error: unknown,
  fallback = "活书请求失败",
): string {
  const gw = getGatewayUrl();
  const message =
    error instanceof Error ? error.message : String(error || fallback);
  const errorCode =
    typeof error === "object" && error !== null && "errorCode" in error
      ? String((error as { errorCode?: unknown }).errorCode || "")
      : "";

  if (error instanceof CircuitBreakerOpenError) {
    const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
    return `网络不稳定，请求已暂时暂停。请等待 ${retryAfterSec} 秒后重试。`;
  }

  if (
    errorCode === "NETWORK_ERROR" ||
    message === "Network connection failed"
  ) {
    return [
      `无法连接 Gateway：${gw}`,
      "活书移动端现在直接连接 Python Gateway。请确认 Python Gateway 已启动并监听 0.0.0.0，手机和电脑在同一网络，Windows 防火墙允许当前端口。",
      "请在 我的 → Gateway 设置 中修改电脑局域网 IP 地址。",
    ].join("\n");
  }

  if (errorCode === "TIMEOUT" || message === "Request timed out") {
    return `活书请求超时：${gw}\n请确认 Python Gateway 没有卡住，或稍后重试。`;
  }

  return message || fallback;
}

// ==================== Backward-compatible named exports ====================

export async function healthCheck() {
  return api.core.healthCheck();
}

export async function getCapabilities() {
  return api.capabilities.list();
}

export async function getJobs() {
  return { jobs: [] as unknown[] };
}

export async function getJob(jobId: string) {
  return api.jobs.get(jobId);
}

export async function createJob(payload: {
  job_type: string;
  input: Record<string, unknown>;
}) {
  return api.jobs.create({
    job_type: payload.job_type,
    payload: payload.input,
  });
}

export async function getStudentProfile(userId: string) {
  return api.students.getProfile(userId);
}

export async function getKnowledgeStates(userId: string) {
  return api.knowledge.getStates(userId);
}

export async function getLiveBooks() {
  return liveBookApi.listBooks();
}

export async function getConversations() {
  return api.messages.listConversations({ user_id: USER_ID });
}

export async function askQuestionWithImageObject(
  objectKey: string,
  description?: string,
) {
  return {
    content: description?.trim() || "请分析这张图片",
    capability: CAPABILITY_IDS.deep_solve,
    attachments: [
      {
        type: "image",
        object_key: objectKey,
      },
    ],
  };
}

export { normalizeCapability, CAPABILITY_IDS };
