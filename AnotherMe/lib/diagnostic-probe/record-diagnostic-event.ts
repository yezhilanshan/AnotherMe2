/**
 * Records a diagnostic probe answer as a structured LearningEvent
 * and records a block-level attempt for mastery tracking.
 *
 * This feeds into the BKT pipeline on the backend and provides
 * structured event data for learning analysis and behavior replay.
 */

import { recordLearningEvent } from '@/lib/learning-events/client';
import type { DiagnosticProbe } from '@/lib/types/diagnostic-probe';
import { useDiagnosticStore } from '@/lib/store/diagnostic';

export interface RecordDiagnosticEventInput {
  userId: string;
  probe: DiagnosticProbe;
  correct: boolean;
  /** Time spent answering in milliseconds */
  timeSpentMs?: number;
}

/**
 * Fire-and-forget: records a diagnostic quiz_answered event
 * and a block-level attempt for mastery tracking.
 * Failures are silently swallowed to avoid disrupting the UX.
 */
export async function recordDiagnosticEvent(input: RecordDiagnosticEventInput): Promise<void> {
  const { probe, correct, timeSpentMs = 0 } = input;

  // Record block-level attempt for mastery tracking
  useDiagnosticStore.getState().recordBlockAttempt({
    knowledgePointId: probe.knowledgePointId,
    success: correct,
    score: correct ? 100 : 0,
    timeSpentMs,
    struggledPoints: correct ? [] : [probe.knowledgePointId],
  });

  // Fire structured LearningEvent for BKT pipeline
  await recordLearningEvent({
    eventType: 'quiz_answered',
    knowledgePoints: [probe.knowledgePointId],
    payload: {
      questionId: probe.probeId,
      selectedAnswers: correct ? [probe.correctAnswer] : [],
      correctAnswers: [probe.correctAnswer],
      isCorrect: correct,
      timeSpentMs,
      attemptNumber: 1,
      probeType: probe.probeType,
      difficulty: probe.difficulty,
      teachingAction: probe.teachingAction,
    },
    weight: 1.0,
  });
}
