import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createChatSlice, type ChatSlice } from './slices/chatSlice';
import { createSessionSlice, type SessionSlice } from './slices/sessionSlice';
import { createLearningSlice, type LearningSlice } from './slices/learningSlice';
import { getSafeStorage } from './safeStorage';

export type StoreState = ChatSlice & SessionSlice & LearningSlice;

export const useChatStore = create<StoreState>()(
  persist(
    (...a) => ({
      ...createChatSlice(...a),
      ...createSessionSlice(...a),
      ...createLearningSlice(...a),
    }),
    {
      name: '@anotherme/store',
      storage: createJSONStorage(getSafeStorage),
      partialize: state => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        messagesBySession: state.messagesBySession,
        selectedModel: state.selectedModel,
        selectedCapability: state.selectedCapability,
        learningContext: {
          l1: state.learningContext.l1,
          l2: state.learningContext.l2,
          reviewPlan: state.learningContext.reviewPlan,
          l3: { records: [], stats: null },
        },
      }),
    },
  ),
);

export type { Message } from './types';
