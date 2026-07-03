import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

describe('middleware — WebSocket rewrite removed', () => {
  it('middleware passes through all requests without rewriting', async () => {
    const { middleware, config } = await import('@/middleware');

    // Matcher should be empty — middleware is a no-op
    expect(config.matcher).toEqual([]);

    // Middleware should return NextResponse.next() for any request
    const req = new NextRequest('http://localhost/api/messages/ws?conversation_id=abc&user_id=def');
    const response = middleware(req);

    // NextResponse.next() returns a response with status 200 and no body
    expect(response.status).toBe(200);
    // Should NOT be a rewrite (no x-middleware-rewrite header)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('middleware does not intercept WebSocket upgrade requests', async () => {
    const { middleware } = await import('@/middleware');

    const req = new NextRequest('http://localhost/api/messages/ws?conversation_id=abc&user_id=def', {
      headers: {
        upgrade: 'websocket',
        connection: 'Upgrade',
      },
    });
    const response = middleware(req);

    // Should pass through, not rewrite
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
