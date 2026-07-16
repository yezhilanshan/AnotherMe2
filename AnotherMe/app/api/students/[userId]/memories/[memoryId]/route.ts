import { NextRequest } from 'next/server';
import {
  getGatewayMemory,
  updateGatewayMemory,
  deleteGatewayMemory,
  isAnotherMe2GatewayError,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string; memoryId: string }> },
) {
  try {
    const { userId: routeUserId, memoryId } = await context.params;
    if (!routeUserId || !memoryId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id or memory id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    const memory = await getGatewayMemory({ userId, memoryId });
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
      error instanceof Error ? error.message : 'Failed to get memory',
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ userId: string; memoryId: string }> },
) {
  try {
    const { userId: routeUserId, memoryId } = await context.params;
    if (!routeUserId || !memoryId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id or memory id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    const body = await request.json();

    const memory = await updateGatewayMemory({
      userId,
      memoryId,
      content: body.content,
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
      error instanceof Error ? error.message : 'Failed to update memory',
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ userId: string; memoryId: string }> },
) {
  try {
    const { userId: routeUserId, memoryId } = await context.params;
    if (!routeUserId || !memoryId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id or memory id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    await deleteGatewayMemory({ userId, memoryId });
    return apiSuccess({ ok: true });
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
      error instanceof Error ? error.message : 'Failed to delete memory',
    );
  }
}
