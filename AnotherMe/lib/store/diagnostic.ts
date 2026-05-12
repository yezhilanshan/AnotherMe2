/**
 * Diagnostic Store - Manages diagnostic probe state, session history, and block mastery.
 *
 * - Current probe, loading, and error state (shared across components)
 * - Session history with persistence via localStorage
 * - LearningBlock-level mastery tracking for knowledge points
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DiagnosticProbe } from '@/lib/types/diagnostic-probe';
import type { DiagnosticSessionSnapshot } from '@/lib/types/learning-context';
import type { LearningBlock, AttemptRecord } from '@/lib/types/learning-block';
import { recordBlockAttempt, calculateBlockMastery } from '@/lib/types/learning-block';

// ==================== Types ====================

export interface DiagnosticHistoryEntry {
  correct: boolean;
  probe: DiagnosticProbe;
  answeredAt: number;
}

export interface DiagnosticSession {
  /** Session identifier */
  sessionId: string;
  /** All answers in this session */
  entries: DiagnosticHistoryEntry[];
  /** Session start timestamp */
  startedAt: number;
  /** Session end timestamp (null if still active) */
  endedAt: number | null;
}

export interface DiagnosticBlockEntry {
  block: LearningBlock;
  mastery: number;
}

// ==================== Block Helpers ====================

function generateBlockId(knowledgePointId: string): string {
  return `diag-block-${knowledgePointId}`;
}

function createBlock(knowledgePointId: string): LearningBlock {
  return {
    id: generateBlockId(knowledgePointId),
    sceneId: 'diagnostic',
    stageId: 'diagnostic',
    order: 0,
    title: `诊断练习: ${knowledgePointId}`,
    metadata: {
      type: 'practice',
      status: 'active',
      difficulty: 'adaptive',
      learningObjectives: [],
      knowledgePoints: [knowledgePointId],
      misconceptionTags: [],
      sourceAnchors: [],
      attempts: [],
      generatedBy: 'diagnostic-probe',
      estimatedTimeMinutes: 5,
      prerequisiteBlockIds: [],
      relatedBlockIds: [],
      recommendedForReview: false,
    },
    content: {
      type: 'practice',
      problemSet: [],
      solutionHints: [],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ==================== Store ====================

export interface DiagnosticState {
  // Current probe state (transient, not persisted)
  currentProbe: DiagnosticProbe | null;
  probeLoading: boolean;
  probeError: string | null;

  // Session state (persisted)
  currentSession: DiagnosticSession | null;
  sessions: DiagnosticSession[];

  // Block mastery state (persisted)
  blocks: Record<string, LearningBlock>;

  // Probe actions
  setProbe: (probe: DiagnosticProbe | null) => void;
  setProbeLoading: (loading: boolean) => void;
  setProbeError: (error: string | null) => void;
  clearProbe: () => void;

  // Session actions
  startSession: () => void;
  addEntry: (entry: Omit<DiagnosticHistoryEntry, 'answeredAt'>) => void;
  endSession: () => void;
  clearHistory: () => void;

  // Block actions
  recordBlockAttempt: (params: {
    knowledgePointId: string;
    success: boolean;
    score?: number;
    timeSpentMs?: number;
    hintsUsed?: string[];
    struggledPoints?: string[];
  }) => void;
  getBlock: (knowledgePointId: string) => DiagnosticBlockEntry | null;
  getAllBlocks: () => DiagnosticBlockEntry[];
  getMastery: (knowledgePointId: string) => number;

  // Derived
  getTodayStats: () => { total: number; correct: number; incorrect: number };
}

function generateSessionId(): string {
  return `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useDiagnosticStore = create<DiagnosticState>()(
  persist(
    (set, get) => ({
      // Transient state (not persisted via partialize)
      currentProbe: null,
      probeLoading: false,
      probeError: null,

      // Persisted state
      currentSession: null,
      sessions: [],
      blocks: {},

      // Probe actions
      setProbe: (probe) => set({ currentProbe: probe, probeError: null }),
      setProbeLoading: (loading) => set({ probeLoading: loading }),
      setProbeError: (error) => set({ probeError: error, currentProbe: null }),
      clearProbe: () => set({ currentProbe: null, probeError: null }),

      // Session actions
      startSession: () => {
        const session: DiagnosticSession = {
          sessionId: generateSessionId(),
          entries: [],
          startedAt: Date.now(),
          endedAt: null,
        };
        set({ currentSession: session });
      },

      addEntry: (entry) => {
        const { currentSession } = get();
        if (!currentSession) return;

        set({
          currentSession: {
            ...currentSession,
            entries: [
              ...currentSession.entries,
              { ...entry, answeredAt: Date.now() },
            ],
          },
        });
      },

      endSession: () => {
        const { currentSession, sessions } = get();
        if (!currentSession) return;

        const completedSession = {
          ...currentSession,
          endedAt: Date.now(),
        };

        set({
          currentSession: null,
          sessions: [completedSession, ...sessions],
        });
      },

      clearHistory: () => {
        set({ currentSession: null, sessions: [] });
      },

      // Block actions
      recordBlockAttempt: (params) => {
        const { knowledgePointId, success, score, timeSpentMs, hintsUsed, struggledPoints } = params;
        const { blocks } = get();

        const existingBlock = blocks[knowledgePointId] || createBlock(knowledgePointId);

        const attempt: Omit<AttemptRecord, 'id' | 'timestamp'> = {
          success,
          score,
          timeSpentMs,
          hintsUsed: hintsUsed ?? [],
          struggledPoints: struggledPoints ?? [],
        };

        const updatedBlock = recordBlockAttempt(existingBlock, attempt);

        set({
          blocks: {
            ...blocks,
            [knowledgePointId]: updatedBlock,
          },
        });
      },

      getBlock: (knowledgePointId) => {
        const { blocks } = get();
        const block = blocks[knowledgePointId];
        if (!block) return null;
        return { block, mastery: calculateBlockMastery(block) };
      },

      getAllBlocks: () => {
        const { blocks } = get();
        return Object.entries(blocks)
          .map(([kpId, block]) => ({
            block,
            mastery: calculateBlockMastery(block),
          }))
          .sort((a, b) => a.mastery - b.mastery);
      },

      getMastery: (knowledgePointId) => {
        const { blocks } = get();
        const block = blocks[knowledgePointId];
        if (!block) return 0;
        return calculateBlockMastery(block);
      },

      getTodayStats: () => {
        const { currentSession, sessions } = get();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTs = todayStart.getTime();

        const todayEntries: DiagnosticHistoryEntry[] = [];

        if (currentSession) {
          for (const entry of currentSession.entries) {
            if (entry.answeredAt >= todayTs) {
              todayEntries.push(entry);
            }
          }
        }

        for (const session of sessions) {
          if (session.startedAt >= todayTs) {
            todayEntries.push(...session.entries);
          }
        }

        return {
          total: todayEntries.length,
          correct: todayEntries.filter((e) => e.correct).length,
          incorrect: todayEntries.filter((e) => !e.correct).length,
        };
      },
    }),
    {
      name: 'diagnostic-storage',
      version: 3, // Bumped version for merged store
      // Only persist session data and blocks, not transient probe state
      partialize: (state) => ({
        currentSession: state.currentSession,
        sessions: state.sessions,
        blocks: state.blocks,
      }),
    },
  ),
);

/**
 * Build a DiagnosticSessionSnapshot from the current store state.
 * Returns null if there's no session data.
 */
export function buildDiagnosticSnapshot(): DiagnosticSessionSnapshot | null {
  const { currentSession, sessions } = useDiagnosticStore.getState();
  const session = currentSession || sessions[0];
  if (!session || session.entries.length === 0) return null;

  const blockMastery = buildDiagnosticBlockSnapshot();

  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    probes: session.entries.map((e) => ({
      knowledgePointId: e.probe.knowledgePointId,
      question: e.probe.question,
      correct: e.correct,
      teachingAction: e.probe.teachingAction,
    })),
    totalAnswered: session.entries.length,
    correctCount: session.entries.filter((e) => e.correct).length,
    incorrectCount: session.entries.filter((e) => !e.correct).length,
    blockMastery: Object.keys(blockMastery).length > 0 ? blockMastery : undefined,
  };
}

/**
 * Build block mastery summary for inclusion in LearningContext.
 */
export function buildDiagnosticBlockSnapshot(): Record<string, number> {
  const { blocks } = useDiagnosticStore.getState();
  const result: Record<string, number> = {};
  for (const [kpId, block] of Object.entries(blocks)) {
    result[kpId] = calculateBlockMastery(block);
  }
  return result;
}
