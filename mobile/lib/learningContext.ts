import type { WorkingMemory, KnowledgeState, LearningRecord, LearningEventStats } from './types';

export interface LearningContext {
  l1: WorkingMemory | null;
  l2: KnowledgeState[];
  l3: {
    records: LearningRecord[];
    stats: LearningEventStats | null;
  };
}

export function buildSystemPrompt(ctx: LearningContext): string | undefined {
  const parts: string[] = [];

  // L1: 工作记忆
  if (ctx.l1?.recentSummary) {
    parts.push(`[Working Memory] Recent conversation summary: ${ctx.l1.recentSummary}`);
    if (ctx.l1.activeKnowledgePoints.length > 0) {
      parts.push(`Active knowledge points: ${ctx.l1.activeKnowledgePoints.join(', ')}`);
    }
  }

  // L2: 知识掌握矩阵
  if (ctx.l2.length > 0) {
    const weakPoints = ctx.l2.filter(ks => ks.mastery < 0.5);
    const strongPoints = ctx.l2.filter(ks => ks.mastery >= 0.8);
    if (weakPoints.length > 0) {
      parts.push(
        `[Knowledge - Needs Work] ${weakPoints.map(ks => `${ks.name} (mastery: ${Math.round(ks.mastery * 100)}%)`).join(', ')}`,
      );
    }
    if (strongPoints.length > 0) {
      parts.push(`[Knowledge - Strong] ${strongPoints.map(ks => ks.name).join(', ')}`);
    }
  }

  // L3: 长期学习轨迹
  if (ctx.l3.records.length > 0) {
    const recentSummaries = ctx.l3.records
      .slice(0, 3)
      .map(r => r.summary)
      .filter(Boolean);
    if (recentSummaries.length > 0) {
      parts.push(`[Learning History] ${recentSummaries.join('; ')}`);
    }
  }
  if (ctx.l3.stats && ctx.l3.stats.total_events > 0) {
    parts.push(`[Activity] Total learning events: ${ctx.l3.stats.total_events}`);
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}
