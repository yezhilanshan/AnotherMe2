import { describe, expect, it } from 'vitest';
import { createLearningContext } from '@/lib/types/learning-context';
import { buildProblemVideoStepPersonalization } from '@/lib/server/problem-video-step-personalization';

describe('problem video step personalization', () => {
  it('marks weak BKT-linked solution steps for expanded explanation', () => {
    const context = createLearningContext('student-1', {
      knowledgeTracing: {
        weakestKnowledgePointContext: null,
        teachingDecisions: [
          {
            knowledgePointId: '勾股定理',
            mastery: 0.32,
            action: 'reteach',
            reason: '最近在斜边识别和平方关系上出错',
          },
          {
            knowledgePointId: '直角三角形',
            mastery: 0.62,
            action: 'give_hint',
            reason: '需要确认直角位置',
          },
        ],
      },
    });

    const personalization = buildProblemVideoStepPersonalization(
      context,
      '已知 Rt△ABC，AC=3，BC=4，求 AB。',
    );

    expect(personalization.standardSteps.map((step) => step.title)).toContain('建立勾股关系');
    expect(personalization.summary.weakKnowledgePointIds).toContain('勾股定理');

    const pythagoreanStep = personalization.standardSteps.find((step) =>
      step.knowledgePointIds.includes('勾股定理'),
    );
    expect(pythagoreanStep).toBeTruthy();

    const decision = personalization.stepDecisions.find(
      (item) => item.stepId === pythagoreanStep?.id,
    );
    expect(decision).toMatchObject({
      riskLevel: 'high',
      expansionStrategy: 'full_scaffold',
      needsExpansion: true,
      likelyStuck: true,
    });
  });
});
