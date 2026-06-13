import type { StateCreator } from 'zustand';
import { api } from '../api';
import { USER_ID } from '../config';
import { scheduleLocalNotification } from '../notifications';
import { getSafeStorage } from '../safeStorage';
import type { KnowledgeState, LearningRecord, LearningEventStats, WorkingMemory } from '../types';
import type { StoreState } from '../store';

const L1_KEY = '@anotherme/l1_working_memory';

export interface LearningSlice {
  learningContext: {
    l1: WorkingMemory | null;
    l2: KnowledgeState[];
    l3: {
      records: LearningRecord[];
      stats: LearningEventStats | null;
    };
  };

  refreshLearningContext: () => Promise<void>;
  updateL1Summary: (summary: string) => void;
}

export const createLearningSlice: StateCreator<StoreState, [], [], LearningSlice> = (set, get) => ({
  learningContext: {
    l1: null,
    l2: [],
    l3: { records: [], stats: null },
  },

  refreshLearningContext: async () => {
    const { activeSessionId } = get();

    // L1: 从 AsyncStorage 加载（本地，快速）
    let l1: WorkingMemory | null = null;
    try {
      const raw = await getSafeStorage().getItem(L1_KEY);
      if (raw) l1 = JSON.parse(raw);
    } catch {}
    if (l1?.sessionId !== activeSessionId) {
      l1 = null;
    }

    // L2: 从服务端加载知识状态
    let l2: KnowledgeState[] = [];
    try {
      const raw = await api.knowledge.getStates(USER_ID, { limit: 100 });
      l2 = (raw as Record<string, unknown>[]).map(ks => ({
        knowledge_point_id: ks.knowledge_point_id as string,
        name: (ks.name as string) || (ks.knowledge_point_id as string),
        subject: ks.subject as string | undefined,
        mastery: (ks.mastery as number) || 0,
        attempts: (ks.attempts as number) || 0,
        last_practiced_at: ks.last_practiced_at as string | undefined,
      }));
    } catch {}

    // L3: 从服务端加载学习记录 + 统计
    let records: LearningRecord[] = [];
    let stats: LearningEventStats | null = null;
    try {
      if (activeSessionId) {
        const rawRecords = await api.aiLearning.getSessionLearningRecords(activeSessionId, {
          user_id: USER_ID,
          limit: 20,
        });
        records = (rawRecords as Record<string, unknown>[]).map(r => ({
          id: (r.id as string) || '',
          session_id: (r.session_id as string) || activeSessionId,
          summary: (r.summary as string) || '',
          knowledge_points: r.knowledge_points as string[] | undefined,
          created_at: (r.created_at as string) || new Date().toISOString(),
        }));
      }
      const rawStats = await api.learningEvents.getStats(USER_ID, { lookback_days: 30 });
      const rs = rawStats as Record<string, unknown>;
      stats = {
        total_events: (rs.total_events as number) || 0,
        event_types: (rs.event_types as Record<string, number>) || {},
        recent_activity: rs.recent_activity as { date: string; count: number }[] | undefined,
      };
    } catch {}

    set({ learningContext: { l1, l2, l3: { records, stats } } });

    // Notify about weak knowledge points
    const weakPoints = l2.filter(ks => ks.mastery < 0.3);
    if (weakPoints.length > 0) {
      const weakest = weakPoints[0];
      scheduleLocalNotification(
        '学习提醒',
        `你在「${weakest.name}」上需要加强，来练习一下吧`,
        { screen: 'chat', knowledgePointId: weakest.knowledge_point_id },
      ).catch(() => {});
    }
  },

  updateL1Summary: (summary: string) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;

    const l1: WorkingMemory = {
      sessionId: activeSessionId,
      recentSummary: summary,
      activeKnowledgePoints: [],
      lastUpdated: Date.now(),
    };

    set(state => ({
      learningContext: { ...state.learningContext, l1 },
    }));

    getSafeStorage().setItem(L1_KEY, JSON.stringify(l1)).catch(() => {});
  },
});
