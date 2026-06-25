import { NextRequest } from 'next/server';
import {
  getGatewayAccuracyTrend,
  getGatewayMasteryProgress,
  getGatewayLearningEfficiency,
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
    const metric = request.nextUrl.searchParams.get('metric') || 'efficiency';
    const days = Number(request.nextUrl.searchParams.get('days') || '30');
    const safeDays = Number.isFinite(days) ? days : 30;

    switch (metric) {
      case 'accuracy-trend': {
        const kpId = request.nextUrl.searchParams.get('knowledgePointId') || undefined;
        const result = await getGatewayAccuracyTrend({
          userId,
          knowledgePointId: kpId,
          days: safeDays,
        });
        return apiSuccess({ ...result });
      }
      case 'mastery-progress': {
        const result = await getGatewayMasteryProgress({ userId, days: safeDays });
        return apiSuccess({ ...result });
      }
      case 'learning-efficiency': {
        const result = await getGatewayLearningEfficiency({ userId, days: safeDays });
        return apiSuccess({ ...result });
      }
      default:
        return apiError('INVALID_REQUEST', 400, `Unknown metric: ${metric}`);
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
      error instanceof Error ? error.message : 'Failed to get metrics',
    );
  }
}
