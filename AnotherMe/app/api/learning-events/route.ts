import { NextRequest } from 'next/server';
import {
  createGatewayLearningEvent,
  getGatewayLearningEventStats,
  isAnotherMe2GatewayError,
  listGatewayLearningEvents,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAuthenticatedUserFromRequest } from '@/lib/auth/session';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

function parseBooleanParam(value: string | null, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return defaultValue;
}

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUserFromRequest(request);
    const stats = parseBooleanParam(request.nextUrl.searchParams.get('stats'), false);

    if (stats) {
      const eventStats = await getGatewayLearningEventStats({
        userId: user.id,
        classroomId: request.nextUrl.searchParams.get('classroomId') || undefined,
        lookbackDays: parseBoundedInt(request.nextUrl.searchParams.get('lookbackDays'), 30, 1, 365),
      });
      return apiSuccess({ stats: eventStats });
    }

    const events = await listGatewayLearningEvents({
      userId: user.id,
      eventType: request.nextUrl.searchParams.get('eventType') || undefined,
      classroomId: request.nextUrl.searchParams.get('classroomId') || undefined,
      sceneId: request.nextUrl.searchParams.get('sceneId') || undefined,
      limit: parseBoundedInt(request.nextUrl.searchParams.get('limit'), 200, 1, 500),
    });

    return apiSuccess({ events });
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
      error instanceof Error ? error.message : 'Failed to load learning events',
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      eventType?: string;
      event_type?: string;
      sessionId?: string;
      session_id?: string;
      classroomId?: string;
      classroom_id?: string;
      sceneId?: string;
      scene_id?: string;
      blockId?: string;
      block_id?: string;
      knowledgePoints?: string[];
      knowledge_points?: string[];
      payload?: Record<string, unknown>;
      learningContext?: Record<string, unknown>;
      learning_context?: Record<string, unknown>;
      weight?: number;
    };

    const eventType = (body.eventType || body.event_type || '').trim();
    if (!eventType) {
      return apiError('INVALID_REQUEST', 400, 'Missing eventType');
    }

    const payload = { ...(body.payload || {}) };
    const learningContext = body.learningContext || body.learning_context;
    if (learningContext && !payload.learning_context) {
      payload.learning_context = learningContext;
    }

    const event = await createGatewayLearningEvent({
      userId: user.id,
      eventType,
      sessionId: body.sessionId || body.session_id,
      classroomId: body.classroomId || body.classroom_id,
      sceneId: body.sceneId || body.scene_id,
      blockId: body.blockId || body.block_id,
      knowledgePoints: body.knowledgePoints || body.knowledge_points,
      payload,
      weight: body.weight,
    });

    return apiSuccess({ event }, 201);
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
      error instanceof Error ? error.message : 'Failed to create learning event',
    );
  }
}
