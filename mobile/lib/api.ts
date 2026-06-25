import { createApiClient } from '@anotherme/api-client';
import { GATEWAY_URL, WEB_URL, BEARER_TOKEN, USER_ID, TUNNEL_HEADERS, WEB_TUNNEL_HEADERS } from './config';
import { normalizeCapability, CAPABILITY_IDS } from './config';
import { CircuitBreakerOpenError } from './circuit-breaker';

// Re-export ApiError for backward compatibility
export { ApiError } from '@anotherme/api-client';

// Create the shared API client instance
export const api = createApiClient({
  baseUrl: GATEWAY_URL,
  getToken: () => BEARER_TOKEN,
  defaultHeaders: TUNNEL_HEADERS,
});

export const bffApi = createApiClient({
  baseUrl: `${WEB_URL}/api`,
  getToken: () => BEARER_TOKEN,
  timeout: 120000,
  defaultHeaders: WEB_TUNNEL_HEADERS,
});

export const liveBookApi = bffApi.liveBook;

export function formatGatewayError(error: unknown, fallback = '请求失败'): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  const errorCode = typeof error === 'object' && error !== null && 'errorCode' in error
    ? String((error as { errorCode?: unknown }).errorCode || '')
    : '';

  if (error instanceof CircuitBreakerOpenError) {
    const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
    return `网络不稳定，请求已暂时暂停。请等待 ${retryAfterSec} 秒后重试。`;
  }

  if (errorCode === 'NETWORK_ERROR' || message === 'Network connection failed') {
    return [
      `无法连接 Gateway：${GATEWAY_URL}`,
      '请确认 Python Gateway 已启动并监听 0.0.0.0，手机和电脑在同一网络，Windows 防火墙允许当前端口。',
      '如果自动识别到 localhost，请在 mobile/lib/config.ts 设置 DEV_SERVER_HOST 为电脑局域网 IP。',
    ].join('\n');
  }

  if (errorCode === 'TIMEOUT' || message === 'Request timed out') {
    return `Gateway 请求超时：${GATEWAY_URL}\n请确认服务没有卡住，或稍后重试。`;
  }

  return message || fallback;
}

export function formatLiveBookError(error: unknown, fallback = '活书请求失败'): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  const errorCode = typeof error === 'object' && error !== null && 'errorCode' in error
    ? String((error as { errorCode?: unknown }).errorCode || '')
    : '';

  if (errorCode === 'NETWORK_ERROR' || message === 'Network connection failed') {
    return [
      `无法连接 Web/BFF：${WEB_URL}`,
      '活书移动端现在通过 Web 端 /api/live-book 代理访问后端。请确认 Next.js Web 服务已启动，手机可以访问该地址，并且 Web 服务所在电脑能访问 Python Gateway。',
      '如果手机访问不到 Web 地址，请检查同一网络、防火墙，或用 EXPO_PUBLIC_WEB_URL / EXPO_PUBLIC_DEV_SERVER_HOST 覆盖 mobile 端地址。',
    ].join('\n');
  }

  if (errorCode === 'TIMEOUT' || message === 'Request timed out') {
    return `活书请求超时：${WEB_URL}/api/live-book\n请确认 Web 服务和 Python Gateway 都没有卡住。`;
  }

  return message || fallback;
}

// ==================== Backward-compatible named exports ====================
// These delegate to the shared client, preserving the original function signatures.

export async function healthCheck() {
  return api.core.healthCheck();
}

export async function getCapabilities() {
  return api.capabilities.list();
}

export async function getJobs() {
  // Gateway has no GET /v1/jobs list endpoint; return empty for now.
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
    content: description?.trim() || '请分析这张图片',
    capability: CAPABILITY_IDS.deep_solve,
    attachments: [
      {
        type: 'image',
        object_key: objectKey,
      },
    ],
  };
}

export { normalizeCapability, CAPABILITY_IDS };
