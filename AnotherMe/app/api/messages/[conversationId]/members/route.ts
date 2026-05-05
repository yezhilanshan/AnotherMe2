import { NextRequest } from 'next/server';
import {
  addGatewayConversationMembers,
  isAnotherMe2GatewayError,
  listGatewayConversationMembers,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return apiError('INVALID_REQUEST', 400, 'Missing conversation id');
    }

    const userId = await resolveRequestUserId(request, request.nextUrl.searchParams.get('userId'));

    let members;
    try {
      members = await listGatewayConversationMembers({
        conversationId,
        userId,
      });
    } catch (error) {
      if (!isAnotherMe2GatewayError(error)) {
        throw error;
      }
      return apiSuccess({ members: [], degraded: true, warning: error.message });
    }

    return apiSuccess({ members });
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
      error instanceof Error ? error.message : 'Failed to list conversation members',
    );
  }
}

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
      operatorUserId?: string;
      memberIds?: string[];
    };

    const operatorUserId = await resolveRequestUserId(request, body.operatorUserId);
    const memberIds = (body.memberIds || []).map((item) => (item || '').trim()).filter(Boolean);

    if (memberIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'memberIds is required');
    }

    const members = await addGatewayConversationMembers({
      conversationId,
      operatorUserId,
      memberIds,
    });

    return apiSuccess({ members });
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
      error instanceof Error ? error.message : 'Failed to add conversation members',
    );
  }
}
