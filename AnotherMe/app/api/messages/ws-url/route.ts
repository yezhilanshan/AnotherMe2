import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';

/**
 * 返回 Gateway WebSocket URL（含 auth token）。
 * 客户端获取后直接连接 Gateway，不经过 Next.js 中转，
 * 避免 rewrite 代理不支持 WebSocket upgrade 的问题。
 */
export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId');
  const userId = request.nextUrl.searchParams.get('userId');

  if (!conversationId || !userId) {
    return apiError('INVALID_REQUEST', 400, 'conversationId and userId are required');
  }

  const gatewayHost = process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST?.trim() || '127.0.0.1:8080';
  const gatewayWsUrl = process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL?.trim();
  const gatewayToken = process.env.ANOTHERME2_GATEWAY_TOKEN?.trim() || '';

  // 构建 WebSocket URL
  // 优先使用 NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL（完整 URL）
  // 否则从 NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST 构建
  let wsBase: string;
  if (gatewayWsUrl) {
    wsBase = gatewayWsUrl.replace(/\/+$/, '');
  } else {
    // 自动推断协议：开发环境通常用 ws://，生产用 wss://
    wsBase = `ws://${gatewayHost}`;
  }

  const params = new URLSearchParams({
    user_id: userId,
    ...(gatewayToken ? { token: gatewayToken } : {}),
  });

  return apiSuccess({
    wsUrl: `${wsBase}/ws/messages/${encodeURIComponent(conversationId)}?${params.toString()}`,
  });
}
