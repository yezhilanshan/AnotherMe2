import { describe, expect, it } from 'vitest';
import {
  advanceSocraticProgressStateFromAttempt,
  advanceSocraticProgressStateFromVariant,
  deriveStepGoal,
  resolveTargetKnowledgePointIds,
  type SocraticProgressState,
} from '@anotherme/teaching-core';

function makeState(): SocraticProgressState {
  return {
    currentTopic: '建立勾股关系',
    targetConcept: '勾股定理',
    phase: 'hint_level_0',
    hintLevel: 0,
    hintsGiven: 0,
    turnsInPhase: 0,
    revealedConcepts: [],
    stillMisunderstands: [],
    previousAnswers: [],
    stepGoal: '弄清楚这一步为什么要用「勾股定理」',
    targetKnowledgePointIds: ['勾股定理', '直角三角形'],
    startedAt: 1,
    studentAttempts: 0,
  };
}

describe('teaching-core socratic helpers', () => {
  it('prefers real knowledge point in step goal inference', () => {
    expect(
      deriveStepGoal({
        title: '建立勾股关系',
        knowledgePointIds: ['勾股定理'],
      }),
    ).toContain('勾股定理');
  });

  it('never fabricates knowledge points when target list is empty', () => {
    expect(
      resolveTargetKnowledgePointIds({
        targetKnowledgePointIds: [],
        extractedKnowledgePointIds: ['勾股定理'],
      }),
    ).toEqual([]);
  });

  it('keeps only intersected target knowledge points on attempt evaluation', () => {
    const next = advanceSocraticProgressStateFromAttempt(makeState(), {
      attempt: '因为这是直角三角形，所以可以用勾股定理。',
      evaluation: {
        verdict: 'correct',
        confidence: 0.92,
        conciseDiagnosis: '学生说明了关键依据。',
        nextAction: 'ask_variant_check',
        shouldIncreaseHintLevel: false,
        shouldAskVariant: true,
        extractedKnowledgePointIds: ['勾股定理'],
        tutorReply: '换一个更小的变式试试。',
      },
    });

    expect(next.phase).toBe('confirm_understanding');
    expect(next.variantQuestion).toBeTruthy();
  });

  it('marks mastery only after correct variant transition', () => {
    const warmed = {
      ...makeState(),
      phase: 'confirm_understanding' as const,
      variantQuestion: '如果两直角边变成 5 和 12，你会先用什么关系？',
    };

    const next = advanceSocraticProgressStateFromVariant(warmed, {
      answer: '先用勾股定理列平方关系。',
      evaluation: {
        verdict: 'correct',
        confidence: 0.95,
        conciseDiagnosis: '学生能迁移到变式。',
        tutorReply: '这一步你已经掌握了。',
        extractedKnowledgePointIds: ['勾股定理'],
      },
    });

    expect(next.variantVerdict).toBe('correct');
    expect(next.variantCompletedAt).toBeTypeOf('number');
    expect(next.revealedConcepts).toContain('勾股定理');
  });
});
