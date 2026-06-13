import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('live-book create proxy route', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, book: { id: 'book_1', title: '测试活书' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies create requests to the gateway live-book endpoint', async () => {
    const { POST } = await import('@/app/api/live-book/[...path]/route');
    const payload = {
      topic: '二次函数',
      sources: [
        {
          kind: 'notes',
          text: '',
          notebookRefs: ['note_1'],
          snapshots: [
            {
              kind: 'note',
              id: 'note_1',
              title: '顶点式',
              content: '顶点式 y=a(x-h)^2+k。',
            },
          ],
        },
      ],
    };

    const response = await POST(
      new NextRequest('http://localhost/api/live-book/create', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ path: ['create'] }) },
    );

    const json = await response.json();
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(target).toBe('http://127.0.0.1:8080/live-book/create');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get('content-type')).toBe('application/json');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(JSON.stringify(payload));
  });
});
