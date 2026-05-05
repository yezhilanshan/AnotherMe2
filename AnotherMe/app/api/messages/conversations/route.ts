import { NextRequest } from 'next/server';
import {
  createGatewayConversation,
  isAnotherMe2GatewayError,
  listGatewayConversations,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

const FALLBACK_CONVERSATION_ID = 'local-system-assistant';

function buildFallbackConversation(userId: string) {
  const now = new Date().toISOString();
  return {
    conversation_id: FALLBACK_CONVERSATION_ID,
    type: 'single',
    name: '系统助手',
    creator_id: userId,
    last_message_id: null,
    last_message_time: null,
    unread_count: 0,
    created_at: now,
    updated_at: now,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveRequestUserId(request, request.nextUrl.searchParams.get('userId'));
    const limit = Number(request.nextUrl.searchParams.get('limit') || '50');
    try {
      const conversations = await listGatewayConversations({
        userId,
        limit: Number.isFinite(limit) ? limit : 50,
      });
      return apiSuccess({ conversations });
    } catch (error) {
      if (!isAnotherMe2GatewayError(error)) {
        throw error;
      }
      return apiSuccess({
        conversations: [buildFallbackConversation(userId)],
        degraded: true,
        warning: error.message,
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to list conversations',
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      type?: string;
      name?: string;
      creatorId?: string;
      memberIds?: string[];
    };

    const userId = await resolveRequestUserId(request, body.userId);
    const name = (body.name || '').trim();
    if (!name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'name is required');
    }

    const conversation = await createGatewayConversation({
      userId,
      type: body.type || 'single',
      name,
      creatorId: userId,
      memberIds: body.memberIds,
    });

    return apiSuccess({ conversation }, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to create conversation',
    );
  }
}
