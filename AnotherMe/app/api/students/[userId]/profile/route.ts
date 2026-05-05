import { NextRequest } from 'next/server';
import { getGatewayStudentProfile, isAnotherMe2GatewayError } from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

function buildFallbackProfile(userId: string) {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    weak_subjects: [],
    weak_knowledge_points: [],
    recent_focus: null,
    ability_scores: [],
    learning_stats: {
      records_total: 0,
      records_14d: 0,
      active_days_14: 0,
      confusion_records: 0,
      solved_records: 0,
      top_subjects: [],
      top_knowledge_points: [],
      total_weight: 0,
    },
    updated_at: null,
    computed_at: now,
    profile_source: 'gateway-unavailable',
  };
}

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
    const rawLookback = Number(request.nextUrl.searchParams.get('lookbackDays') || '120');
    const lookbackDays = Number.isFinite(rawLookback) ? rawLookback : 120;

    try {
      const profile = await getGatewayStudentProfile({
        userId,
        lookbackDays,
      });
      return apiSuccess({ profile });
    } catch (error) {
      if (!isAnotherMe2GatewayError(error)) {
        throw error;
      }
      return apiSuccess({
        profile: buildFallbackProfile(userId),
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
      error instanceof Error ? error.message : 'Failed to load student profile',
    );
  }
}
