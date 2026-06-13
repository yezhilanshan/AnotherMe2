const BASE = '/api/co-writer';

export interface CoWriterDocumentSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  preview: string;
}

export interface CoWriterDocument {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface EditResponse {
  edited_text: string;
  operation_id: string;
}

export interface AutoMarkResponse {
  marked_text: string;
  operation_id: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listCoWriterDocuments(): Promise<CoWriterDocumentSummary[]> {
  const res = await fetch(`${BASE}/documents`, { cache: 'no-store' });
  const data = await jsonOrThrow<{ documents: CoWriterDocumentSummary[] }>(res);
  return Array.isArray(data?.documents) ? data.documents : [];
}

export async function createCoWriterDocument(payload?: {
  title?: string;
  content?: string;
}): Promise<CoWriterDocument> {
  const res = await fetch(`${BASE}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: payload?.title ?? null,
      content: payload?.content ?? '',
    }),
  });
  return jsonOrThrow<CoWriterDocument>(res);
}

export async function getCoWriterDocument(docId: string): Promise<CoWriterDocument> {
  const res = await fetch(`${BASE}/documents/${encodeURIComponent(docId)}`, {
    cache: 'no-store',
  });
  return jsonOrThrow<CoWriterDocument>(res);
}

export async function updateCoWriterDocument(
  docId: string,
  payload: { title?: string | null; content?: string | null },
): Promise<CoWriterDocument> {
  const res = await fetch(`${BASE}/documents/${encodeURIComponent(docId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: payload.title ?? null,
      content: payload.content ?? null,
    }),
  });
  return jsonOrThrow<CoWriterDocument>(res);
}

export async function deleteCoWriterDocument(docId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/documents/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
  const data = await jsonOrThrow<{ deleted: boolean }>(res);
  return Boolean(data?.deleted);
}

export async function editText(
  text: string,
  instruction: string,
  action: 'rewrite' | 'shorten' | 'expand' = 'rewrite',
  options?: { source?: 'rag' | 'web'; kb_name?: string },
): Promise<EditResponse> {
  return jsonOrThrow<EditResponse>(
    await fetch(`${BASE}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        instruction,
        action,
        source: options?.source || null,
        kb_name: options?.kb_name || null,
      }),
    }),
  );
}

export async function editTextReactStream(
  selected_text: string,
  instruction: string,
  mode: 'rewrite' | 'shorten' | 'expand' | 'none' = 'rewrite',
  tools: string[] = [],
  kb_name?: string,
): Promise<Response> {
  const res = await fetch(`${BASE}/edit_react/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected_text, instruction, mode, tools, kb_name: kb_name || null }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return res;
}

export async function autoMarkText(text: string): Promise<AutoMarkResponse> {
  return jsonOrThrow<AutoMarkResponse>(
    await fetch(`${BASE}/automark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  );
}

export async function editTextReact(
  selected_text: string,
  instruction: string,
  mode: 'rewrite' | 'shorten' | 'expand' | 'none' = 'rewrite',
  tools: string[] = [],
  kb_name?: string,
): Promise<EditResponse> {
  return jsonOrThrow<EditResponse>(
    await fetch(`${BASE}/edit_react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_text, instruction, mode, tools, kb_name: kb_name || null }),
    }),
  );
}

export async function getHistory(): Promise<{ history: unknown[]; total: number }> {
  return jsonOrThrow(await fetch(`${BASE}/history`, { cache: 'no-store' }));
}

export async function getHistoryItem(operationId: string): Promise<unknown> {
  return jsonOrThrow(await fetch(`${BASE}/history/${encodeURIComponent(operationId)}`, { cache: 'no-store' }));
}

export async function getToolCalls(operationId: string): Promise<{ tool_calls: unknown[] }> {
  return jsonOrThrow(await fetch(`${BASE}/tool_calls/${encodeURIComponent(operationId)}`, { cache: 'no-store' }));
}
