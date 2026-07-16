import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('live-book source-options proxy route', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ notes: [{ id: 'book_1:block_1', title: '二次函数课堂 / 顶点式' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies source option queries to the gateway live-book endpoint', async () => {
    const { GET } = await import('@/app/api/live-book/[...path]/route');

    const response = await GET(
      new NextRequest('http://localhost/api/live-book/source-options?kind=notes'),
      { params: Promise.resolve({ path: ['source-options'] }) },
    );

    const json = await response.json();
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(json.notes).toHaveLength(1);
    expect(target).toBe('http://127.0.0.1:8080/live-book/source-options?kind=notes');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });
});
