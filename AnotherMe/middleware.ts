import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware for request interception.
 * WebSocket connections now go directly to Gateway (via /api/messages/ws-url endpoint),
 * so no WebSocket rewrite is needed here.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [], // No routes matched — middleware is a no-op placeholder
};
