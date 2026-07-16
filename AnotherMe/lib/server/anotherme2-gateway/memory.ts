import { gatewayFetch } from './core';

export interface GatewayMemory {
  id: string;
  user_id: string;
  memory_type: string;
  content: string;
  source_session_id: string | null;
  importance: number;
  created_at: string | null;
}

export interface GatewayMemoryContext {
  context: string | null;
}

export async function createGatewayMemory(params: {
  userId: string;
  memoryType: string;
  content: string;
  sourceSessionId?: string;
  importance?: number;
}): Promise<GatewayMemory> {
  return gatewayFetch<GatewayMemory>(
    `/v1/users/${encodeURIComponent(params.userId)}/memories`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memory_type: params.memoryType,
        content: params.content,
        source_session_id: params.sourceSessionId,
        importance: params.importance ?? 0,
      }),
    },
  );
}

export async function listGatewayMemories(params: {
  userId: string;
  memoryType?: string;
  limit?: number;
  offset?: number;
}): Promise<GatewayMemory[]> {
  const query = new URLSearchParams();
  if (params.memoryType) query.set('memory_type', params.memoryType);
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayMemory[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/memories${suffix}`,
  );
}

export async function getGatewayMemory(params: {
  userId: string;
  memoryId: string;
}): Promise<GatewayMemory> {
  return gatewayFetch<GatewayMemory>(
    `/v1/users/${encodeURIComponent(params.userId)}/memories/${encodeURIComponent(params.memoryId)}`,
  );
}

export async function updateGatewayMemory(params: {
  userId: string;
  memoryId: string;
  content?: string;
  importance?: number;
}): Promise<GatewayMemory> {
  return gatewayFetch<GatewayMemory>(
    `/v1/users/${encodeURIComponent(params.userId)}/memories/${encodeURIComponent(params.memoryId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: params.content,
        importance: params.importance,
      }),
    },
  );
}

export async function deleteGatewayMemory(params: {
  userId: string;
  memoryId: string;
}): Promise<void> {
  await gatewayFetch<unknown>(
    `/v1/users/${encodeURIComponent(params.userId)}/memories/${encodeURIComponent(params.memoryId)}`,
    { method: 'DELETE' },
  );
}

export async function getGatewayMemoryContext(params: {
  userId: string;
  maxChars?: number;
}): Promise<GatewayMemoryContext> {
  const query = new URLSearchParams();
  if (typeof params.maxChars === 'number') query.set('max_chars', String(params.maxChars));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayMemoryContext>(
    `/v1/users/${encodeURIComponent(params.userId)}/memory-context${suffix}`,
  );
}

export async function extractGatewayMemories(params: {
  userId: string;
  userMessage: string;
  assistantMessage: string;
  sourceSessionId?: string;
}): Promise<GatewayMemory[]> {
  return gatewayFetch<GatewayMemory[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/memories/extract`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_message: params.userMessage,
        assistant_message: params.assistantMessage,
        source_session_id: params.sourceSessionId,
      }),
    },
  );
}
