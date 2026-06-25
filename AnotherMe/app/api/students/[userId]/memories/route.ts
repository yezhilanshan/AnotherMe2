import { NextRequest } from 'next/server';
import {
  createGatewayMemory,
  listGatewayMemories,
  isAnotherMe2GatewayError,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: routeUserId } = await context.params;
    if (!routeUserId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    const memoryType = request.nextUrl.searchParams.get('memoryType') || undefined;
    const limit = Number(request.nextUrl.searchParams.get('limit') || '50');
    const offset = Number(request.nextUrl.searchParams.get('offset') || '0');

    const memories = await listGatewayMemories({
      userId,
      memoryType,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return apiSuccess({ memories });
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
      error instanceof Error ? error.message : 'Failed to list memories',
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: routeUserId } = await context.params;
    if (!routeUserId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    const body = await request.json();

    if (!body.memory_type || !body.content) {
      return apiError('INVALID_REQUEST', 400, 'memory_type and content are required');
    }

    const memory = await createGatewayMemory({
      userId,
      memoryType: body.memory_type,
      content: body.content,
      sourceSessionId: body.source_session_id,
      importance: body.importance,
    });
    return apiSuccess({ memory });
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
      error instanceof Error ? error.message : 'Failed to create memory',
    );
  }
}
