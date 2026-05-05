import { NextRequest } from 'next/server';
import {
  createGatewayAISession,
  isAnotherMe2GatewayError,
  listGatewayAISessions,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveRequestUserId(request, request.nextUrl.searchParams.get('userId'));
    const limit = Number(request.nextUrl.searchParams.get('limit') || '50');
    const linkedConversationId = request.nextUrl.searchParams.get('conversationId') || undefined;

    let sessions;
    try {
      sessions = await listGatewayAISessions({
        userId,
        limit: Number.isFinite(limit) ? limit : 50,
        linkedConversationId,
      });
    } catch (error) {
      if (!isAnotherMe2GatewayError(error)) {
        throw error;
      }
      return apiSuccess({ sessions: [], degraded: true, warning: error.message });
    }
    return apiSuccess({ sessions });
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
      error instanceof Error ? error.message : 'Failed to list ai sessions',
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      title?: string;
      source?: string;
      subject?: string;
      linkedClassroomId?: string;
      linkedConversationId?: string;
    };

    const title = (body.title || '').trim();
    if (!title) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'title is required');
    }
    const userId = await resolveRequestUserId(request, body.userId);

    const session = await createGatewayAISession({
      userId,
      title,
      source: body.source,
      subject: body.subject,
      linkedClassroomId: body.linkedClassroomId,
      linkedConversationId: body.linkedConversationId,
    });

    return apiSuccess({ session }, 201);
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
      error instanceof Error ? error.message : 'Failed to create ai session',
    );
  }
}
