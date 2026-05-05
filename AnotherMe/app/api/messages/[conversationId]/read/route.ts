import { NextRequest } from 'next/server';
import {
  isAnotherMe2GatewayError,
  markGatewayConversationRead,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return apiError('INVALID_REQUEST', 400, 'Missing conversation id');
    }

    const body = (await request.json()) as {
      userId?: string;
      lastReadSeq?: number;
    };

    const userId = await resolveRequestUserId(request, body.userId);

    let readState;
    try {
      readState = await markGatewayConversationRead({
        conversationId,
        userId,
        lastReadSeq: body.lastReadSeq,
      });
    } catch (error) {
      if (!isAnotherMe2GatewayError(error)) {
        throw error;
      }
      return apiSuccess({
        readState: {
          conversation_id: conversationId,
          user_id: userId,
          last_read_seq: body.lastReadSeq || 0,
          unread_count: 0,
        },
        degraded: true,
        warning: error.message,
      });
    }

    return apiSuccess({ readState });
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
      error instanceof Error ? error.message : 'Failed to mark conversation read',
    );
  }
}
