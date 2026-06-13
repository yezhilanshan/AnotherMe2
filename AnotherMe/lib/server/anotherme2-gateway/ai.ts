import { DEFAULT_CHAT_USER_ID, gatewayFetch, getGatewayBaseUrl, buildGatewayHeaders } from './core';
import type {
  AnotherMe2JobSummary,
  GatewayAIChatMessage,
  GatewayAIChatSession,
  GatewayAIMessageFeedback,
  GatewayLearningRecord,
  LearningRecordExtractResult,
} from './types';

export async function listGatewayAISessions(params: {
  userId: string;
  limit?: number;
  linkedConversationId?: string;
}): Promise<GatewayAIChatSession[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  if (params.linkedConversationId) {
    query.set('linked_conversation_id', params.linkedConversationId);
  }
  return gatewayFetch<GatewayAIChatSession[]>(`/v1/ai/sessions?${query.toString()}`);
}

export async function createGatewayAISession(params: {
  userId: string;
  title: string;
  source?: string;
  subject?: string;
  linkedClassroomId?: string;
  linkedConversationId?: string;
}): Promise<GatewayAIChatSession> {
  return gatewayFetch<GatewayAIChatSession>('/v1/ai/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      title: params.title,
      source: params.source || '课后答疑',
      subject: params.subject,
      linked_classroom_id: params.linkedClassroomId,
      linked_conversation_id: params.linkedConversationId,
    }),
  });
}

export async function listGatewayAIMessages(params: {
  sessionId: string;
  limit?: number;
}): Promise<GatewayAIChatMessage[]> {
  const query = new URLSearchParams();
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayAIChatMessage[]>(
    `/v1/ai/sessions/${params.sessionId}/messages${suffix}`,
  );
}

export async function createGatewayAIMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  userId?: string;
  contentType?: string;
  modelName?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  requestId?: string;
  parentMessageId?: string;
}): Promise<GatewayAIChatMessage> {
  return gatewayFetch<GatewayAIChatMessage>(`/v1/ai/sessions/${params.sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: params.role,
      content: params.content,
      user_id: params.userId,
      content_type: params.contentType || 'text',
      model_name: params.modelName,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.totalTokens,
      latency_ms: params.latencyMs,
      request_id: params.requestId,
      parent_message_id: params.parentMessageId,
    }),
  });
}

export async function createGatewayAIMessageFeedback(params: {
  messageId: string;
  userId: string;
  rating: 'like' | 'dislike';
  feedbackText?: string;
}): Promise<GatewayAIMessageFeedback> {
  return gatewayFetch<GatewayAIMessageFeedback>(`/v1/ai/messages/${params.messageId}/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      rating: params.rating,
      feedback_text: params.feedbackText,
    }),
  });
}

export async function createLearningRecordExtractJob(params: {
  sessionId: string;
  userId?: string;
  extractVersion?: string;
  latestUserMessageId?: string;
  messageCount?: number;
}): Promise<AnotherMe2JobSummary> {
  return gatewayFetch<AnotherMe2JobSummary>('/v1/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_type: 'learning_record_extract',
      user_id: params.userId || DEFAULT_CHAT_USER_ID,
      payload: {
        session_id: params.sessionId,
        user_id: params.userId,
        extract_version: params.extractVersion || 'v1',
        latest_user_message_id: params.latestUserMessageId,
        message_count: params.messageCount,
      },
    }),
  });
}

export async function getLearningRecordExtractResult(
  jobId: string,
): Promise<LearningRecordExtractResult> {
  const payload = await gatewayFetch<{
    job_id: string;
    status: string;
    result: LearningRecordExtractResult;
  }>(`/v1/jobs/${jobId}/result`);
  return payload.result;
}

export async function listGatewayAILearningRecords(params: {
  sessionId: string;
  userId?: string;
  limit?: number;
}): Promise<GatewayLearningRecord[]> {
  const query = new URLSearchParams();
  if (params.userId) {
    query.set('user_id', params.userId);
  }
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayLearningRecord[]>(
    `/v1/ai/sessions/${params.sessionId}/learning-records${suffix}`,
  );
}

/**
 * 通过 AnotherMe2 Python 网关调用 DeepTutor engine 的 agentic chat capability。
 * 返回一个 ReadableStream，直接透传网关的 SSE 事件流。
 */
export function streamGatewayChat(params: {
  messages: Array<{ role: string; content: string }>;
  model: string;
  apiKey: string;
  baseUrl?: string;
  capability?: string;
  userId?: string;
  requestId?: string;
  learningContext?: Record<string, unknown>;
  persistenceSessionId?: string;
  persistMessages?: boolean;
  persistUserMessage?: boolean;
  signal?: AbortSignal;
}): Promise<Response> {
  const url = `${getGatewayBaseUrl()}/v1/ai/chat`;

  return fetch(url, {
    method: 'POST',
    headers: {
      ...buildGatewayHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: params.messages,
      model: params.model,
      api_key: params.apiKey,
      base_url: params.baseUrl,
      capability: params.capability || 'chat',
      streaming: true,
      user_id: params.userId || DEFAULT_CHAT_USER_ID,
      request_id: params.requestId || `chat-${Date.now()}`,
      learning_context: params.learningContext,
      persistence_session_id: params.persistenceSessionId,
      persist_messages: params.persistMessages ?? false,
      persist_user_message: params.persistUserMessage ?? true,
      persist_assistant_message: params.persistMessages ?? false,
    }),
    signal: params.signal,
    cache: 'no-store',
  });
}
