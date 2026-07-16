export type StreamEvent =
  | { type: 'agent_start'; data: { messageId: string; agentId: string; agentName: string } }
  | { type: 'thinking'; data: { stage: string; agentId: string; reasoning: string } }
  | { type: 'text_delta'; data: { content: string; messageId: string } }
  | { type: 'done'; data: { totalActions: number; totalAgents: number; agentHadContent: boolean } }
  | { type: 'error'; data: { message: string } };

export interface StreamChatOptions {
  baseUrl: string;
  getToken: () => string | Promise<string>;
  message: string;
  conversationId?: string;
  model?: string;
  capability?: string;
  userId?: string;
  onEvent: (event: StreamEvent) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

function buildBody(options: StreamChatOptions) {
  return {
    messages: [{ role: 'user', content: options.message }],
    model: options.model || 'gpt-4o',
    api_key: '',
    capability: options.capability || 'chat',
    user_id: options.userId || 'mobile-user',
    request_id: options.conversationId || `mobile-${Date.now()}`,
    streaming: true,
  };
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

function dispatchEvent(
  event: StreamEvent,
  onEvent: StreamChatOptions['onEvent'],
  onComplete: StreamChatOptions['onComplete'],
  onError: StreamChatOptions['onError'],
): boolean {
  onEvent(event);
  if (event.type === 'done') { onComplete(); return true; }
  if (event.type === 'error') { onError(new Error(event.data?.message || 'Unknown error')); return true; }
  return false;
}

/**
 * Stream chat with automatic retry on transient failures.
 * Uses exponential backoff: 1s, 2s, 4s (max 3 attempts).
 * Does NOT retry on abort or explicit error events.
 */
export async function streamChatWithRetry(
  options: StreamChatOptions,
  maxRetries = 3,
): Promise<void> {
  let attempt = 0;

  while (attempt < maxRetries) {
    let shouldRetry = false;

    await streamChat({
      ...options,
      onError: (error: Error) => {
        attempt++;
        if (attempt >= maxRetries || error.name === 'AbortError') {
          options.onError(error);
        } else {
          shouldRetry = true;
        }
      },
      onComplete: () => {
        options.onComplete();
      },
    });

    if (!shouldRetry) return;

    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { baseUrl, getToken, onEvent, onComplete, onError, signal } = options;
  const url = `${baseUrl}/v1/ai/chat`;
  const token = await getToken();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(buildBody(options)),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    onError(new Error(`HTTP ${response.status}: ${body || response.statusText}`));
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
          if (ev && dispatchEvent(ev, onEvent, onComplete, onError)) return;
        }
      }
      for (const line of buffer.split('\n')) {
        const ev = parseSSELine(line);
        if (ev && dispatchEvent(ev, onEvent, onComplete, onError)) return;
      }
      onComplete();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }

  // Fallback: read entire response
  try {
    const text = await response.text();
    for (const line of text.split('\n')) {
      const ev = parseSSELine(line);
      if (ev && dispatchEvent(ev, onEvent, onComplete, onError)) return;
    }
    onComplete();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
