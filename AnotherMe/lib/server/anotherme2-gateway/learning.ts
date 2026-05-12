import { gatewayFetch } from './core';
import type {
  GatewayDiagnosticProbe,
  GatewayKnowledgePoint,
  GatewayLearningEvent,
  GatewayQuizAnswerResult,
  GatewayStudentKnowledgeContext,
  GatewayStudentKnowledgeState,
  GatewayStudentProfile,
  GatewayTeachingDecision,
} from './types';

export async function getGatewayStudentProfile(params: {
  userId: string;
  lookbackDays?: number;
}): Promise<GatewayStudentProfile> {
  const query = new URLSearchParams();
  if (typeof params.lookbackDays === 'number') {
    query.set('lookback_days', String(params.lookbackDays));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayStudentProfile>(`/v1/students/${params.userId}/profile${suffix}`);
}

export async function createGatewayLearningEvent(params: {
  userId: string;
  eventType: string;
  sessionId?: string;
  classroomId?: string;
  sceneId?: string;
  blockId?: string;
  knowledgePoints?: string[];
  payload?: Record<string, unknown>;
  weight?: number;
}): Promise<GatewayLearningEvent> {
  return gatewayFetch<GatewayLearningEvent>(
    `/v1/users/${encodeURIComponent(params.userId)}/learning-events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: params.eventType,
        session_id: params.sessionId,
        classroom_id: params.classroomId,
        scene_id: params.sceneId,
        block_id: params.blockId,
        knowledge_points: params.knowledgePoints,
        payload: params.payload,
        weight: params.weight,
      }),
    },
  );
}

export async function listGatewayKnowledgePoints(params?: {
  subject?: string;
  parentId?: string;
  limit?: number;
}): Promise<GatewayKnowledgePoint[]> {
  const query = new URLSearchParams();
  if (params?.subject) {
    query.set('subject', params.subject);
  }
  if (params?.parentId) {
    query.set('parent_id', params.parentId);
  }
  if (typeof params?.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayKnowledgePoint[]>(`/v1/knowledge-points${suffix}`);
}

export async function getGatewayStudentKnowledgeStates(params: {
  userId: string;
  knowledgePointIds?: string[];
  minMastery?: number;
  limit?: number;
}): Promise<GatewayStudentKnowledgeState[]> {
  const query = new URLSearchParams();
  if (params.knowledgePointIds?.length) {
    params.knowledgePointIds.forEach((id) => query.append('knowledge_point_ids', id));
  }
  if (typeof params.minMastery === 'number') {
    query.set('min_mastery', String(params.minMastery));
  }
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayStudentKnowledgeState[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/knowledge-states${suffix}`,
  );
}

export async function getGatewayStudentKnowledgeState(params: {
  userId: string;
  knowledgePointId: string;
}): Promise<GatewayStudentKnowledgeState> {
  return gatewayFetch<GatewayStudentKnowledgeState>(
    `/v1/users/${encodeURIComponent(params.userId)}/knowledge-states/${encodeURIComponent(params.knowledgePointId)}`,
  );
}

export async function getGatewayTeachingDecisions(params: {
  userId: string;
  knowledgePointIds?: string[];
}): Promise<GatewayTeachingDecision[]> {
  const query = new URLSearchParams();
  if (params.knowledgePointIds?.length) {
    params.knowledgePointIds.forEach((id) => query.append('knowledge_point_ids', id));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayTeachingDecision[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/teaching-decisions${suffix}`,
  );
}

export async function getGatewayTeachingDecision(params: {
  userId: string;
  knowledgePointId: string;
}): Promise<GatewayTeachingDecision> {
  return gatewayFetch<GatewayTeachingDecision>(
    `/v1/users/${encodeURIComponent(params.userId)}/teaching-decisions/${encodeURIComponent(params.knowledgePointId)}`,
  );
}

export async function getGatewayStudentKnowledgeContext(params: {
  userId: string;
  knowledgePointId: string;
}): Promise<GatewayStudentKnowledgeContext> {
  return gatewayFetch<GatewayStudentKnowledgeContext>(
    `/v1/users/${encodeURIComponent(params.userId)}/knowledge-context/${encodeURIComponent(params.knowledgePointId)}`,
  );
}

export async function createGatewayQuizAnswer(params: {
  userId: string;
  questionId: string;
  isCorrect: boolean;
  payload?: Record<string, unknown>;
}): Promise<GatewayQuizAnswerResult[]> {
  return gatewayFetch<GatewayQuizAnswerResult[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/quiz-answers`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question_id: params.questionId,
        is_correct: params.isCorrect,
        payload: params.payload,
      }),
    },
  );
}

export async function createGatewayDiagnosticProbe(params: {
  userId: string;
  knowledgePointId?: string;
  difficulty?: string;
  probeType?: string;
}): Promise<GatewayDiagnosticProbe> {
  return gatewayFetch<GatewayDiagnosticProbe>(
    `/v1/users/${encodeURIComponent(params.userId)}/diagnostic-probes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        knowledge_point_id: params.knowledgePointId,
        difficulty: params.difficulty,
        probe_type: params.probeType,
      }),
    },
  );
}
