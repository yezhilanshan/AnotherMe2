import { NextRequest } from 'next/server';
import {
  getGatewayStudentKnowledgeContext,
  getGatewayTeachingDecisions,
  isAnotherMe2GatewayError,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

/**
 * GET /api/students/{userId}/teaching-context?knowledgePointId=xxx
 *
 * Returns a prompt-ready KT context string for a specific knowledge point.
 * If knowledgePointId is omitted, auto-selects the weakest knowledge point
 * from the student's teaching decisions.
 */
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
    let knowledgePointId = request.nextUrl.searchParams.get('knowledgePointId') || '';

    // If no knowledgePointId provided, find the weakest one
    if (!knowledgePointId) {
      try {
        const decisions = await getGatewayTeachingDecisions({ userId });
        if (decisions.length > 0) {
          // Sort by mastery ascending to get weakest
          decisions.sort((a, b) => a.mastery - b.mastery);
          knowledgePointId = decisions[0].target_knowledge_point_id;
        }
      } catch {
        // Ignore — will return fallback below
      }
    }

    if (!knowledgePointId) {
      return apiSuccess({
        context_text: '# Teaching Context\n学生尚无知识点追踪记录。',
        knowledge_point_id: null,
      });
    }

    const result = await getGatewayStudentKnowledgeContext({
      userId,
      knowledgePointId,
    });

    return apiSuccess({
      context_text: result.context_text,
      knowledge_point_id: knowledgePointId,
    });
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
      error instanceof Error ? error.message : 'Failed to get teaching context',
    );
  }
}
