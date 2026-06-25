import { gatewayFetch } from './core';

export interface AccuracyTrendPoint {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface AccuracyTrend {
  trend: AccuracyTrendPoint[];
  summary: {
    total_answers: number;
    correct_answers: number;
    overall_accuracy: number;
    days_with_data: number;
  };
}

export interface MasteryProgressKP {
  knowledge_point_id: string;
  current_mastery: number;
  prior_mastery: number;
  delta: number;
  attempts: number;
  correct_attempts: number;
  last_updated: string | null;
}

export interface MasteryProgress {
  knowledge_points: MasteryProgressKP[];
  summary: {
    total_kps: number;
    improved: number;
    declined: number;
    stable: number;
  };
}

export interface LearningEfficiency {
  efficiency_score: number;
  breakdown: {
    accuracy_score: number;
    mastery_growth_score: number;
    hint_independence_score: number;
    repeat_reduction_score: number;
  };
  raw: {
    accuracy: AccuracyTrend['summary'];
    mastery: MasteryProgress['summary'];
    hints: { total_hints: number; days_with_data: number; avg_per_day: number };
    repeats: { knowledge_points_analyzed: number; total_repeat_mistakes: number; overall_repeat_rate: number };
  };
}

export async function getGatewayAccuracyTrend(params: {
  userId: string;
  knowledgePointId?: string;
  days?: number;
}): Promise<AccuracyTrend> {
  const query = new URLSearchParams();
  if (params.knowledgePointId) query.set('knowledge_point_id', params.knowledgePointId);
  if (typeof params.days === 'number') query.set('days', String(params.days));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<AccuracyTrend>(
    `/v1/users/${encodeURIComponent(params.userId)}/metrics/accuracy-trend${suffix}`,
  );
}

export async function getGatewayMasteryProgress(params: {
  userId: string;
  days?: number;
}): Promise<MasteryProgress> {
  const query = new URLSearchParams();
  if (typeof params.days === 'number') query.set('days', String(params.days));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<MasteryProgress>(
    `/v1/users/${encodeURIComponent(params.userId)}/metrics/mastery-progress${suffix}`,
  );
}

export async function getGatewayLearningEfficiency(params: {
  userId: string;
  days?: number;
}): Promise<LearningEfficiency> {
  const query = new URLSearchParams();
  if (typeof params.days === 'number') query.set('days', String(params.days));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<LearningEfficiency>(
    `/v1/users/${encodeURIComponent(params.userId)}/metrics/learning-efficiency${suffix}`,
  );
}
