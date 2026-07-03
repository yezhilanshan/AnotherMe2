import { createHttpClient, type HttpClientConfig } from './http';
import { streamChat, streamChatWithRetry, type StreamChatOptions, type StreamEvent } from './sse';

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | Promise<string>;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
}

export function createApiClient(config: ApiClientConfig) {
  const http = createHttpClient(config);

  return {
    // ── Core ──────────────────────────────────────────────────────────
    core: {
      healthCheck: () =>
        http.request<{ ok: boolean; redis: string; queue_backend: string; env: string }>('/healthz'),
      root: () =>
        http.request<{ service: string; ok: boolean; health: string; api: string }>('/'),
    },

    // ── Capabilities ──────────────────────────────────────────────────
    capabilities: {
      list: () =>
        http.request<{ capabilities: Record<string, unknown>; effective: unknown[]; tools: Record<string, unknown> }>('/v1/capabilities'),
      get: (capabilityId: string) =>
        http.request<Record<string, unknown>>(`/v1/capabilities/${capabilityId}`),
      updateToolHealth: (toolId: string, body: { available: boolean; error_message?: string }) =>
        http.request<{ tool_id: string; available: boolean; affected_capabilities: string[] }>(`/v1/tools/${toolId}/health`, { method: 'POST', body }),
      checkJobGuard: (jobId: string) =>
        http.request<Record<string, unknown>>(`/v1/jobs/${jobId}/capability-guard`, { method: 'POST' }),
    },

    // ── Jobs ──────────────────────────────────────────────────────────
    jobs: {
      create: (body: { job_type: string; payload: Record<string, unknown>; user_id?: string }) =>
        http.request<{ job_id: string; job_type: string; status: string; progress: number; step: string; created_at: string; updated_at: string }>('/v1/jobs', { method: 'POST', body }),
      get: (jobId: string) =>
        http.request<{ job_id: string; job_type: string; status: string; progress: number; step: string; error_code?: string; error_message?: string; result?: Record<string, unknown>; created_at: string; updated_at: string }>(`/v1/jobs/${jobId}`),
      getResult: (jobId: string) =>
        http.request<{ job_id: string; status: string; result: Record<string, unknown> }>(`/v1/jobs/${jobId}/result`),
      getTraceEvents: (jobId: string, eventType?: string) =>
        http.request<Record<string, unknown>[]>(`/v1/jobs/${jobId}/trace-events${eventType ? `?event_type=${eventType}` : ''}`),
    },

    // ── Uploads ───────────────────────────────────────────────────────
    uploads: {
      upload: (body: FormData) =>
        http.request<{ object_key: string; url: string; size: number; content_type: string }>('/v1/uploads', {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'multipart/form-data' },
        }),
    },

    // ── AI Chat ───────────────────────────────────────────────────────
    ai: {
      chat: (body: {
        messages: { role: string; content: string }[];
        model?: string;
        api_key?: string;
        capability?: string;
        user_id?: string;
        request_id?: string;
        streaming?: boolean;
      }) => http.request<Record<string, unknown>>('/v1/ai/chat/non-streaming', { method: 'POST', body }),
      chatNonStreaming: (body: {
        messages: { role: string; content: string }[];
        model?: string;
        capability?: string;
        user_id?: string;
      }) => http.request<{ success: boolean; assistant_text: string; request_id: string }>('/v1/ai/chat/non-streaming', { method: 'POST', body }),
    },

    // ── AI Learning ───────────────────────────────────────────────────
    aiLearning: {
      listSessions: (params: { user_id: string; limit?: number; linked_conversation_id?: string }) =>
        http.request<Record<string, unknown>[]>(`/v1/ai/sessions?user_id=${params.user_id}${params.limit ? `&limit=${params.limit}` : ''}${params.linked_conversation_id ? `&linked_conversation_id=${params.linked_conversation_id}` : ''}`),
      createSession: (body: { user_id: string; title: string; source?: string; subject?: string; linked_classroom_id?: string; linked_conversation_id?: string }) =>
        http.request<Record<string, unknown>>('/v1/ai/sessions', { method: 'POST', body }),
      getSessionMessages: (sessionId: string, params?: number | { limit?: number; before_seq?: number; max_content_chars?: number }) => {
        const qs = new URLSearchParams();
        if (typeof params === 'number') {
          qs.set('limit', String(params));
        } else {
          if (params?.limit) qs.set('limit', String(params.limit));
          if (params?.before_seq) qs.set('before_seq', String(params.before_seq));
          if (params?.max_content_chars) qs.set('max_content_chars', String(params.max_content_chars));
        }
        const q = qs.toString();
        return http.request<Record<string, unknown>[]>(`/v1/ai/sessions/${sessionId}/messages${q ? `?${q}` : ''}`);
      },
      getMessage: (messageId: string) =>
        http.request<Record<string, unknown>>(`/v1/ai/messages/${messageId}`),
      createSessionMessage: (sessionId: string, body: { role: string; content: string; user_id?: string; content_type?: string; capability?: string; events?: unknown[]; attachments?: unknown[]; model_name?: string; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; latency_ms?: number; request_id?: string; parent_message_id?: string }) =>
        http.request<Record<string, unknown>>(`/v1/ai/sessions/${sessionId}/messages`, { method: 'POST', body }),
      getSessionLearningRecords: (sessionId: string, params?: { user_id?: string; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.user_id) qs.set('user_id', params.user_id);
        if (params?.limit) qs.set('limit', String(params.limit));
        const q = qs.toString();
        return http.request<Record<string, unknown>[]>(`/v1/ai/sessions/${sessionId}/learning-records${q ? `?${q}` : ''}`);
      },
      submitFeedback: (messageId: string, body: { user_id: string; rating: 'like' | 'dislike'; feedback_text?: string }) =>
        http.request<Record<string, unknown>>(`/v1/ai/messages/${messageId}/feedback`, { method: 'POST', body }),
    },

    // ── Students / Knowledge ──────────────────────────────────────────
    students: {
      getProfile: (userId: string, lookbackDays?: number) =>
        http.request<Record<string, unknown>>(`/v1/students/${userId}/profile${lookbackDays ? `?lookback_days=${lookbackDays}` : ''}`),
    },

    knowledge: {
      listPoints: (params?: { subject?: string; parent_id?: string; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.subject) qs.set('subject', params.subject);
        if (params?.parent_id) qs.set('parent_id', params.parent_id);
        if (params?.limit) qs.set('limit', String(params.limit));
        const q = qs.toString();
        return http.request<Record<string, unknown>[]>(`/v1/knowledge-points${q ? `?${q}` : ''}`);
      },
      createPoint: (body: { kp_id: string; name: string; subject?: string; description?: string; parent_id?: string; prerequisites?: string[]; difficulty?: string }) =>
        http.request<Record<string, unknown>>('/v1/knowledge-points', { method: 'POST', body }),
      getQuestionPoints: (questionId: string) =>
        http.request<Record<string, unknown>[]>(`/v1/questions/${questionId}/knowledge-points`),
      processQuizAnswer: (userId: string, body: { question_id: string; is_correct: boolean; knowledge_point_ids?: string[]; payload?: Record<string, unknown> }) =>
        http.request<Record<string, unknown>[]>(`/v1/users/${userId}/quiz-answers`, { method: 'POST', body }),
      getStates: (userId: string, params?: { knowledge_point_ids?: string[]; min_mastery?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.knowledge_point_ids) qs.set('knowledge_point_ids', params.knowledge_point_ids.join(','));
        if (params?.min_mastery !== undefined) qs.set('min_mastery', String(params.min_mastery));
        if (params?.limit) qs.set('limit', String(params.limit));
        const q = qs.toString();
        return http.request<Record<string, unknown>[]>(`/v1/users/${userId}/knowledge-states${q ? `?${q}` : ''}`);
      },
      getState: (userId: string, knowledgePointId: string) =>
        http.request<Record<string, unknown>>(`/v1/users/${userId}/knowledge-states/${knowledgePointId}`),
      getTeachingDecisions: (userId: string, knowledgePointIds?: string[]) => {
        const q = knowledgePointIds?.length ? `?knowledge_point_ids=${knowledgePointIds.join(',')}` : '';
        return http.request<Record<string, unknown>[]>(`/v1/users/${userId}/teaching-decisions${q}`);
      },
      getTeachingDecision: (userId: string, knowledgePointId: string) =>
        http.request<Record<string, unknown>>(`/v1/users/${userId}/teaching-decisions/${knowledgePointId}`),
      getContext: (userId: string, knowledgePointId: string) =>
        http.request<{ context_text: string }>(`/v1/users/${userId}/knowledge-context/${knowledgePointId}`),
      getTracingSummary: (userId: string) =>
        http.request<Record<string, unknown>>(`/v1/users/${userId}/knowledge-tracing`),
      generateDiagnosticProbe: (userId: string, body?: { knowledge_point_id?: string; difficulty?: string; probe_type?: string }) =>
        http.request<Record<string, unknown>>(`/v1/users/${userId}/diagnostic-probes`, { method: 'POST', body: body || {} }),
    },

    // ── Learning Events ───────────────────────────────────────────────
    learningEvents: {
      create: (body: { user_id?: string; event_type: string; session_id?: string; classroom_id?: string; scene_id?: string; block_id?: string; knowledge_points?: string[]; payload?: Record<string, unknown>; weight?: number }) =>
        http.request<Record<string, unknown>>('/v1/learning-events', { method: 'POST', body }),
      createForUser: (userId: string, body: { event_type: string; session_id?: string; classroom_id?: string; scene_id?: string; block_id?: string; knowledge_points?: string[]; payload?: Record<string, unknown>; weight?: number }) =>
        http.request<Record<string, unknown>>(`/v1/users/${userId}/learning-events`, { method: 'POST', body }),
      list: (userId: string, params?: { event_type?: string; classroom_id?: string; scene_id?: string; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.event_type) qs.set('event_type', params.event_type);
        if (params?.classroom_id) qs.set('classroom_id', params.classroom_id);
        if (params?.scene_id) qs.set('scene_id', params.scene_id);
        if (params?.limit) qs.set('limit', String(params.limit));
        const q = qs.toString();
        return http.request<Record<string, unknown>[]>(`/v1/users/${userId}/learning-events${q ? `?${q}` : ''}`);
      },
      getStats: (userId: string, params?: { classroom_id?: string; lookback_days?: number }) => {
        const qs = new URLSearchParams();
        if (params?.classroom_id) qs.set('classroom_id', params.classroom_id);
        if (params?.lookback_days) qs.set('lookback_days', String(params.lookback_days));
        const q = qs.toString();
        return http.request<Record<string, unknown>>(`/v1/users/${userId}/learning-events/stats${q ? `?${q}` : ''}`);
      },
    },

    // ── Messages ──────────────────────────────────────────────────────
    messages: {
      listConversations: (params: { user_id: string; limit?: number }) =>
        http.request<Record<string, unknown>[]>(`/v1/messages/conversations?user_id=${params.user_id}${params.limit ? `&limit=${params.limit}` : ''}`),
      createConversation: (body: { user_id: string; type?: string; name: string; creator_id?: string; member_ids?: string[] }) =>
        http.request<Record<string, unknown>>('/v1/messages/conversations', { method: 'POST', body }),
      deleteConversation: (conversationId: string, body: { operator_user_id: string }) =>
        http.request<Record<string, unknown>>(`/v1/messages/conversations/${conversationId}`, { method: 'DELETE', body }),
      getMessages: (conversationId: string, params?: { user_id?: string; limit?: number; before_seq?: number }) => {
        const qs = new URLSearchParams();
        if (params?.user_id) qs.set('user_id', params.user_id);
        if (params?.limit) qs.set('limit', String(params.limit));
        if (params?.before_seq) qs.set('before_seq', String(params.before_seq));
        const q = qs.toString();
        return http.request<Record<string, unknown>[]>(`/v1/messages/${conversationId}/messages${q ? `?${q}` : ''}`);
      },
      sendMessage: (conversationId: string, body: { sender_id: string; content: string; message_type?: string; attachments?: unknown[] }) =>
        http.request<Record<string, unknown>>(`/v1/messages/${conversationId}/messages`, { method: 'POST', body }),
      getMembers: (conversationId: string, userId?: string) =>
        http.request<Record<string, unknown>[]>(`/v1/messages/${conversationId}/members${userId ? `?user_id=${userId}` : ''}`),
      addMembers: (conversationId: string, body: { operator_user_id: string; member_ids: string[] }) =>
        http.request<Record<string, unknown>[]>(`/v1/messages/${conversationId}/members`, { method: 'POST', body }),
      removeMember: (conversationId: string, memberUserId: string, body: { operator_user_id: string }) =>
        http.request<Record<string, unknown>>(`/v1/messages/${conversationId}/members/${memberUserId}`, { method: 'DELETE', body }),
      markRead: (conversationId: string, body: { user_id: string; last_read_seq?: number }) =>
        http.request<Record<string, unknown>>(`/v1/messages/${conversationId}/read`, { method: 'POST', body }),
    },

    // ── Live Book ─────────────────────────────────────────────────────
    liveBook: {
      health: () =>
        http.request<{ ok: boolean; service: string }>('/live-book/health'),
      listBooks: () =>
        http.request<{ books: Record<string, unknown>[] }>('/live-book/books'),
      createBook: (body: { topic: string; language?: string; chat_session_id?: string; chat_selections?: unknown[]; knowledge_bases?: string[] }) =>
        http.request<{ book: Record<string, unknown>; proposal: Record<string, unknown> }>('/live-book/books', { method: 'POST', body }),
      getBook: (bookId: string) =>
        http.request<{ book: Record<string, unknown>; spine: Record<string, unknown>; pages: Record<string, unknown>[]; progress: Record<string, unknown> }>(`/live-book/books/${bookId}`),
      deleteBook: (bookId: string) =>
        http.request<{ deleted: boolean; book_id: string }>(`/live-book/books/${bookId}`, { method: 'DELETE' }),
      getSpine: (bookId: string) =>
        http.request<{ spine: Record<string, unknown> }>(`/live-book/books/${bookId}/spine`),
      getPage: (bookId: string, pageId: string) =>
        http.request<{ page: Record<string, unknown> }>(`/live-book/books/${bookId}/pages/${pageId}`),
      confirmProposal: (body: { book_id: string; proposal?: Record<string, unknown> }) =>
        http.request<{ book: Record<string, unknown>; spine: Record<string, unknown> }>('/live-book/books/confirm-proposal', { method: 'POST', body }),
      confirmSpine: (body: { book_id: string; spine?: Record<string, unknown>; auto_compile?: boolean }) =>
        http.request<{ pages: Record<string, unknown>[] }>('/live-book/books/confirm-spine', { method: 'POST', body }),
      compilePage: (body: { book_id: string; page_id: string; force?: boolean }) =>
        http.request<{ page: Record<string, unknown> }>('/live-book/books/compile-page', { method: 'POST', body }),
      regenerateBlock: (body: { book_id: string; page_id: string; block_id: string }) =>
        http.request<Record<string, unknown>>('/live-book/books/regenerate-block', { method: 'POST', body }),
      insertBlock: (body: { book_id: string; page_id: string; block_type: string; params?: Record<string, unknown>; compile_now?: boolean }) =>
        http.request<Record<string, unknown>>('/live-book/books/insert-block', { method: 'POST', body }),
      deleteBlock: (body: { book_id: string; page_id: string; block_id: string }) =>
        http.request<{ ok: boolean }>('/live-book/books/delete-block', { method: 'POST', body }),
      moveBlock: (body: { book_id: string; page_id: string; block_id: string; new_position: number }) =>
        http.request<{ ok: boolean }>('/live-book/books/move-block', { method: 'POST', body }),
      changeBlockType: (body: { book_id: string; page_id: string; block_id: string; new_type: string }) =>
        http.request<Record<string, unknown>>('/live-book/books/change-block-type', { method: 'POST', body }),
      quizAttempt: (body: { book_id: string; page_id: string; block_id: string; question_id: string; user_answer: string; is_correct: boolean }) =>
        http.request<{ progress: Record<string, unknown> }>('/live-book/books/quiz-attempt', { method: 'POST', body }),
      deepDive: (body: { book_id: string; parent_page_id: string; topic: string; block_id?: string; content_type?: string }) =>
        http.request<{ page: Record<string, unknown> }>('/live-book/books/deep-dive', { method: 'POST', body }),
      supplement: (body: { book_id: string; page_id: string; topic: string }) =>
        http.request<{ block: Record<string, unknown> }>('/live-book/books/supplement', { method: 'POST', body }),
      bookHealth: (bookId: string) =>
        http.request<{ health: Record<string, unknown> }>(`/live-book/books/${bookId}/health`),
      refreshFingerprints: (bookId: string) =>
        http.request<Record<string, unknown>>(`/live-book/books/${bookId}/refresh-fingerprints`, { method: 'POST' }),
      getJob: (jobId: string) =>
        http.request<{ job: Record<string, unknown> }>(`/live-book/jobs/${jobId}`),
    },

    // ── Co-Writer ─────────────────────────────────────────────────────
    coWriter: {
      listDocuments: () =>
        http.request<{ documents: Record<string, unknown>[] }>('/co-writer/documents'),
      createDocument: (body: { title?: string; content?: string }) =>
        http.request<Record<string, unknown>>('/co-writer/documents', { method: 'POST', body }),
      getDocument: (docId: string) =>
        http.request<Record<string, unknown>>(`/co-writer/documents/${docId}`),
      updateDocument: (docId: string, body: { title?: string; content?: string }) =>
        http.request<Record<string, unknown>>(`/co-writer/documents/${docId}`, { method: 'PUT', body }),
      deleteDocument: (docId: string) =>
        http.request<{ deleted: boolean }>(`/co-writer/documents/${docId}`, { method: 'DELETE' }),
      edit: (body: { text: string; instruction: string; action?: string; source?: string; kb_name?: string }) =>
        http.request<Record<string, unknown>>('/co-writer/edit', { method: 'POST', body }),
      editReact: (body: { selected_text: string; instruction: string; mode?: string; tools?: string[]; kb_name?: string }) =>
        http.request<Record<string, unknown>>('/co-writer/edit_react', { method: 'POST', body }),
      autoMark: (body: { text: string }) =>
        http.request<Record<string, unknown>>('/co-writer/automark', { method: 'POST', body }),
      getHistory: () =>
        http.request<{ history: Record<string, unknown>[]; total: number }>('/co-writer/history'),
      getHistoryItem: (operationId: string) =>
        http.request<Record<string, unknown>>(`/co-writer/history/${operationId}`),
      getToolCalls: (operationId: string) =>
        http.request<{ tool_calls: Record<string, unknown>[] }>(`/co-writer/tool_calls/${operationId}`),
    },

    // ── SSE Streaming ─────────────────────────────────────────────────
    streamChat: (options: Omit<StreamChatOptions, 'baseUrl' | 'getToken'>) =>
      streamChat({ ...options, baseUrl: config.baseUrl, getToken: config.getToken }),
    streamChatWithRetry: (options: Omit<StreamChatOptions, 'baseUrl' | 'getToken'>, maxRetries?: number) =>
      streamChatWithRetry({ ...options, baseUrl: config.baseUrl, getToken: config.getToken }, maxRetries),

    // ── Classroom ────────────────────────────────────────────────────
    classroom: {
      list: (limit = 50) =>
        http.request<{ success: boolean; classrooms: { id: string; title: string; created_at: string; scenes_count: number }[] }>(
          `/v1/classrooms?limit=${limit}`,
        ),
      get: (classroomId: string) =>
        http.request<{ success: boolean; classroom: Record<string, unknown> }>(
          `/v1/classrooms/${classroomId}`,
        ),
      create: (body: { stage: Record<string, unknown>; scenes: Record<string, unknown>[] }) =>
        http.request<{ success: boolean; id: string }>(
          '/v1/classrooms', { method: 'POST', body },
        ),
      delete: (classroomId: string) =>
        http.request<{ success: boolean; deleted: boolean }>(
          `/v1/classrooms/${classroomId}`, { method: 'DELETE' },
        ),
    },

    // ── Media Generation ─────────────────────────────────────────────
    media: {
      generateImage: (body: {
        prompt: string;
        negative_prompt?: string;
        width?: number;
        height?: number;
        aspect_ratio?: string;
        style?: string;
      }, headers?: Record<string, string>) =>
        http.request<{ success: boolean; result?: { base64: string; format: string; width: number; height: number } }>(
          '/v1/generate/image', { method: 'POST', body, headers },
        ),
      generateTTS: (body: {
        text: string;
        audio_id: string;
        tts_provider_id: string;
        tts_voice: string;
        tts_model_id?: string;
        tts_speed?: number;
        tts_api_key?: string;
        tts_base_url?: string;
      }) =>
        http.request<{ audio_id: string; base64: string; format: string }>(
          '/v1/generate/tts', { method: 'POST', body },
        ),
      generateVideo: (body: {
        prompt: string;
        duration?: number;
        aspect_ratio?: string;
        resolution?: string;
      }, headers?: Record<string, string>) =>
        http.request<{ success: boolean; status: string; message: string }>(
          '/v1/generate/video', { method: 'POST', body, headers },
        ),
      transcribe: async (file: File | Blob, providerId = 'openai-whisper', language = 'auto') => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('provider_id', providerId);
        formData.append('language', language);
        const token = await config.getToken();
        const response = await fetch(`${config.baseUrl}/v1/transcription`, {
          method: 'POST',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
        });
        if (!response.ok) throw new Error(`Transcription failed: ${response.status}`);
        return response.json() as Promise<{ text: string; language: string }>;
      },
    },

    // ── Documents ────────────────────────────────────────────────────
    documents: {
      proxyMedia: (url: string) =>
        http.request<{ success: boolean }>('/v1/proxy-media', { method: 'POST', body: { url } }),
      parsePdf: async (file: File | Blob, providerId = 'unpdf') => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('provider_id', providerId);
        const token = await config.getToken();
        const response = await fetch(`${config.baseUrl}/v1/parse-pdf`, {
          method: 'POST',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
        });
        if (!response.ok) throw new Error(`PDF parse failed: ${response.status}`);
        return response.json() as Promise<{ success: boolean; pages: { page_number: number; text: string }[]; total_pages: number; text: string }>;
      },
    },

    // ── Tools ────────────────────────────────────────────────────────
    tools: {
      webSearch: (body: { query: string; pdf_text?: string; api_key?: string; base_url?: string }) =>
        http.request<{ answer: string; sources: { title: string; url: string; content: string; score: number }[]; query: string; response_time: number }>(
          '/v1/web-search', { method: 'POST', body },
        ),
      quizGrade: (body: { question: string; user_answer: string; points: number; comment_prompt?: string; language?: string }) =>
        http.request<{ score: number; comment: string }>(
          '/v1/quiz-grade', { method: 'POST', body },
        ),
      codeExec: (body: { code: string; timeout?: number; language?: string }) =>
        http.request<{ success: boolean; stdout: string; stderr: string; exit_code: number; execution_time: number }>(
          '/v1/code-exec', { method: 'POST', body },
        ),
    },

    // ── Server Config ────────────────────────────────────────────────
    serverConfig: {
      getProviders: () =>
        http.request<{
          llm: { id: string; configured: boolean; has_api_key: boolean; base_url: string }[];
          tts: { id: string; configured: boolean; has_api_key: boolean; base_url: string }[];
          asr: { id: string; configured: boolean; has_api_key: boolean; base_url: string }[];
          image: { id: string; configured: boolean; has_api_key: boolean; base_url: string }[];
          video: { id: string; configured: boolean; has_api_key: boolean; base_url: string }[];
          webSearch: { id: string; configured: boolean; has_api_key: boolean; base_url: string }[];
        }>('/v1/server/providers'),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
