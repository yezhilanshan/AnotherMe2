import { GATEWAY_URL, BEARER_TOKEN, TUNNEL_HEADERS, DEFAULT_MODEL } from './config';
import { normalizeCapability, CAPABILITY_IDS } from './config';
import { streamingCircuitBreaker, CircuitBreakerOpenError } from './circuit-breaker';

export type StreamEvent =
  | { type: 'agent_start'; data: { messageId: string; agentId: string; agentName: string } }
  | { type: 'thinking'; data: { stage: string; agentId: string; reasoning: string } }
  | { type: 'text_delta'; data: { content: string; messageId: string } }
  | { type: 'capability_result'; data: { messageId: string; content: string; output_mode: string; render_type?: string; artifacts: Array<{ type: string; url: string; filename: string; label: string }>; code: { language: string; content: string }; analysis?: Record<string, unknown>; review?: Record<string, unknown>; summary: Record<string, unknown> } }
  | { type: 'done'; data: { totalActions: number; totalAgents: number; agentHadContent: boolean } }
  | { type: 'error'; data: { message: string } };

export interface StreamChatOptions {
  message: string;
  systemPrompt?: string;
  conversationId?: string;
  model?: string;
  capability?: string;
  userId?: string;
  onEvent: (event: StreamEvent) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

function parseSSELine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (!trimmed.startsWith('data: ')) return null;
  try {
    return JSON.parse(trimmed.slice(6)) as StreamEvent;
  } catch {
    return null;
  }
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
    const retryAfterSec = Math.ceil(
      (status.nextRetryTime - Date.now()) / 1000,
    );
    options.onError(
      new CircuitBreakerOpenError(retryAfterSec * 1000),
    );
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
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

const FETCH_TIMEOUT_MS = 30000; // 30 秒超时

export async function streamChatWithFetch(options: StreamChatOptions): Promise<void> {
  const {
    message,
    systemPrompt,
    conversationId,
    model,
    capability,
    userId,
    onEvent,
    onComplete,
    onError,
    signal,
  } = options;

  const token = BEARER_TOKEN;

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: message });

  const url = `${GATEWAY_URL}/v1/ai/chat`;

  const normalizedCap = normalizeCapability(capability) || CAPABILITY_IDS.ai_tutor_chat;

  const body = {
    messages,
    model: model || DEFAULT_MODEL,
    api_key: '',
    capability: normalizedCap,
    user_id: userId || 'mobile-user',
    request_id: conversationId || `mobile-${Date.now()}`,
    streaming: true,
    mode: normalizedCap === 'chat' ? 'fast' : 'auto',
  };

  // 组合超时 + 用户取消信号
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  let combinedSignal: AbortSignal;
  try {
    combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
  } catch {
    // AbortSignal.any 不可用时降级
    combinedSignal = signal || timeoutController.signal;
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...TUNNEL_HEADERS,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      // 用户取消或超时
      if (!signal?.aborted) {
        safeOnError(new Error('请求超时，请检查网络连接'));
      }
      return;
    }
    safeOnError(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    safeOnError(new Error(`HTTP ${response.status}: ${responseBody || response.statusText}`));
    return;
  }

  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const ev = parseSSELine(line);
          if (!ev) continue;
          onEvent(ev);
          if (ev.type === 'done') { safeOnComplete(); return; }
          if (ev.type === 'error') { safeOnError(new Error(ev.data?.message || 'Unknown error')); return; }
        }
      }
      // 处理剩余 buffer
      for (const line of buffer.split('\n')) {
        const ev = parseSSELine(line);
        if (!ev) continue;
        onEvent(ev);
        if (ev.type === 'done') { safeOnComplete(); return; }
        if (ev.type === 'error') { safeOnError(new Error(ev.data?.message || 'Unknown error')); return; }
      }
      safeOnComplete();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      safeOnError(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }

  // Fallback: 读取完整响应
  try {
    const text = await response.text();
    for (const line of text.split('\n')) {
      const ev = parseSSELine(line);
      if (!ev) continue;
      onEvent(ev);
      if (ev.type === 'done') { safeOnComplete(); return; }
      if (ev.type === 'error') { safeOnError(new Error(ev.data?.message || 'Unknown error')); return; }
    }
    safeOnComplete();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    safeOnError(err instanceof Error ? err : new Error(String(err)));
  }
}
