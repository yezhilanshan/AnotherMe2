import { createLogger } from '@/lib/logger';

const log = createLogger('AnotherMe2Gateway');

export const DEFAULT_PROBLEM_VIDEO_USER_ID = 'anotherme-problem-video-ui';
export const DEFAULT_CHAT_USER_ID = 'anotherme-default-user';

export class AnotherMe2GatewayError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AnotherMe2GatewayError';
    this.status = status;
  }
}

function getGatewayBaseUrl(): string {
  const value = process.env.ANOTHERME2_GATEWAY_BASE_URL?.trim();
  if (!value) {
    throw new AnotherMe2GatewayError(
      'AnotherMe2 gateway is not configured. Set ANOTHERME2_GATEWAY_BASE_URL.',
      500,
    );
  }
  return value.replace(/\/+$/, '');
}

export function isAnotherMe2GatewayConfigured(): boolean {
  return Boolean(process.env.ANOTHERME2_GATEWAY_BASE_URL?.trim());
}

function buildGatewayHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  const token = process.env.ANOTHERME2_GATEWAY_TOKEN?.trim();
  if (token) {
    merged.set('Authorization', `Bearer ${token}`);
  }
  return merged;
}

async function parseGatewayResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

export async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getGatewayBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: buildGatewayHeaders(init?.headers),
      cache: 'no-store',
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : 'Unknown network error';
    log.error(`Gateway request unreachable: ${path} ${message}`);
    const hint =
      /connection error|econnrefused|fetch failed|network|refused|timed out|timeout/i.test(message)
        ? ' 请确认已在运行 AnotherMe2 网关（如 pnpm dev:gateway），且 AnotherMe 的 ANOTHERME2_GATEWAY_BASE_URL 与网关监听地址一致；若使用 pnpm dev:all 复用已有 Next 进程，请核对 .env.local 中的网关 URL。'
        : '';
    throw new AnotherMe2GatewayError(
      `无法连接 AnotherMe2 网关（${getGatewayBaseUrl()}）：${message}。${hint}`,
      503,
    );
  }

  const payload = await parseGatewayResponse(response);
  if (!response.ok) {
    let message = `Gateway request failed with status ${response.status}`;
    if (payload && typeof payload === 'object') {
      const maybeMessage =
        'message' in payload
          ? payload.message
          : 'detail' in payload && payload.detail && typeof payload.detail === 'object'
            ? (payload.detail as { message?: string }).message
            : undefined;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        message = maybeMessage;
      }
    } else if (typeof payload === 'string' && payload.trim()) {
      message = payload;
    }

    log.warn(`Gateway request failed: ${response.status} ${path} ${message}`);
    throw new AnotherMe2GatewayError(message, response.status);
  }

  return payload as T;
}

export function isAnotherMe2GatewayError(error: unknown): error is AnotherMe2GatewayError {
  return error instanceof AnotherMe2GatewayError;
}
