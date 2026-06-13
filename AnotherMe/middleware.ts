import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_TOKEN = process.env.ANOTHERME2_GATEWAY_TOKEN?.trim() || '';

/**
 * Intercepts WebSocket upgrade requests to /api/messages/ws and injects the
 * gateway auth token into the query string before passing through to the
 * rewrites() proxy layer (next.config.ts).
 *
 * This replaces the old Edge Runtime WebSocketPair bridge
 * (app/api/messages/ws/route.ts) with zero custom WebSocket handling code.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const upgrade = request.headers.get('upgrade');

  if (url.pathname === '/api/messages/ws' && upgrade === 'websocket') {
    const conversationId = url.searchParams.get('conversation_id') || 'unknown';

    // Restructure path so rewrites() can extract conversation_id as a path param.
    // /api/messages/ws?conversation_id=X&user_id=Y
    //   → /api/messages/ws-proxy/X?user_id=Y&token=Z
    url.pathname = `/api/messages/ws-proxy/${conversationId}`;
    url.searchParams.delete('conversation_id');
    if (GATEWAY_TOKEN) {
      url.searchParams.set('token', GATEWAY_TOKEN);
    }

    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/messages/ws',
};
