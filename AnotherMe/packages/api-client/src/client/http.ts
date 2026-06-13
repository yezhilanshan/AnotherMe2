import { ApiError, type ErrorResponse } from '../types/errors';

export interface HttpClientConfig {
  baseUrl: string;
  getToken: () => string | Promise<string>;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export function createHttpClient(config: HttpClientConfig) {
  const { baseUrl, getToken, timeout: defaultTimeout = 30000 } = config;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      body,
      headers = {},
      timeout = defaultTimeout,
      signal,
    } = options;

    const url = `${baseUrl}${path}`;
    const token = await getToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine external signal with timeout signal
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...config.defaultHeaders,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData: ErrorResponse = await response.json().catch(() => ({
          error_code: `HTTP_${response.status}`,
          message: response.statusText,
        }));
        throw new ApiError(
          response.status,
          errorData.error_code || `HTTP_${response.status}`,
          errorData.message || `Request failed: ${response.status}`,
          errorData.details,
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(408, 'TIMEOUT', 'Request timed out');
      }

      throw new ApiError(0, 'NETWORK_ERROR', 'Network connection failed');
    }
  }

  return { request };
}
