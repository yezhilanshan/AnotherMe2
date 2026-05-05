import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

function toWebSocketBaseUrl(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) {
    return `wss://${baseUrl.slice('https://'.length)}`;
  }
  if (baseUrl.startsWith('http://')) {
    return `ws://${baseUrl.slice('http://'.length)}`;
  }
  return baseUrl;
}

export async function GET(request: NextRequest) {
  try {
    await resolveRequestUserId(request);

    const explicit = process.env.ANOTHERME2_GATEWAY_WS_BASE_URL?.trim();
    const gatewayHttp = process.env.ANOTHERME2_GATEWAY_BASE_URL?.trim();

    const resolved = explicit || (gatewayHttp ? toWebSocketBaseUrl(gatewayHttp) : '');
    if (!resolved) {
      return apiSuccess({ wsBaseUrl: '', enabled: false });
    }

    return apiSuccess({ wsBaseUrl: resolved.replace(/\/+$/, ''), enabled: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to resolve websocket url',
    );
  }
}
