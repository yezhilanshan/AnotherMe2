import type { StateCreator } from 'zustand';
import { api } from '../api';
import { USER_ID } from '../config';
import type { Session } from '../types';
import type { StoreState } from '../store';

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

function mapRemoteSession(raw: Record<string, unknown>): Session {
  return {
    id: (raw.session_id as string) || (raw.id as string) || generateSessionId(),
    user_id: (raw.user_id as string) || USER_ID,
    title: (raw.title as string) || '新对话',
    source: (raw.source as string) || 'mobile',
    subject: raw.subject as string | undefined,
    linked_conversation_id: raw.linked_conversation_id as string | undefined,
    linked_classroom_id: raw.linked_classroom_id as string | undefined,
    created_at: (raw.created_at as string) || new Date().toISOString(),
    updated_at: (raw.updated_at as string) || new Date().toISOString(),
  };
}

export interface SessionSlice {
  sessions: Session[];
  activeSessionId: string | null;
  sessionsLoaded: boolean;

  loadSessions: () => Promise<void>;
  createSession: (title: string, subject?: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => void;
}

export const createSessionSlice: StateCreator<StoreState, [], [], SessionSlice> = (set, get) => ({
  sessions: [],
  activeSessionId: null,
  sessionsLoaded: false,

  loadSessions: async () => {
    try {
      const remote = await api.aiLearning.listSessions({ user_id: USER_ID, limit: 40 });
      const remoteSessions = (remote as Record<string, unknown>[]).map(mapRemoteSession);
      set(state => {
        const remoteIds = new Set(remoteSessions.map(s => s.id));
        const localOnly = state.sessions.filter(s => !remoteIds.has(s.id));
        const sessions = [...remoteSessions, ...localOnly].slice(0, 40);
        const activeSessionId = state.activeSessionId && sessions.some(s => s.id === state.activeSessionId)
          ? state.activeSessionId
          : sessions[0]?.id || null;
        return { sessions, activeSessionId, sessionsLoaded: true };
      });
    } catch {
      set({ sessionsLoaded: true });
      const { activeSessionId, sessions } = get();
      if (!activeSessionId && sessions.length > 0) {
        set({ activeSessionId: sessions[0].id });
      }
    }
  },

  createSession: async (title: string, subject?: string) => {
    const now = new Date().toISOString();
    let session: Session;
    try {
      const remote = await api.aiLearning.createSession({
        user_id: USER_ID,
        title,
        source: 'mobile',
        subject,
      });
      session = mapRemoteSession(remote as Record<string, unknown>);
    } catch {
      session = {
        id: generateSessionId(),
        user_id: USER_ID,
        title,
        source: 'mobile',
        subject,
        created_at: now,
        updated_at: now,
      };
    }
    const MAX_SESSIONS = 40;
    set(state => {
      let newSessions = [session, ...state.sessions];
      // 超过最大数量时删除最旧的会话
      if (newSessions.length > MAX_SESSIONS) {
        newSessions = newSessions.slice(0, MAX_SESSIONS);
      }
      return { sessions: newSessions, activeSessionId: session.id };
    });
    await get().loadMessages(session.id);
    return session.id;
  },

  switchSession: async (sessionId: string) => {
    set({ activeSessionId: sessionId });
    await get().loadMessages(sessionId);
    await get().refreshLearningContext();
  },

  deleteSession: (sessionId: string) => {
    set(state => {
      const filtered = state.sessions.filter(s => s.id !== sessionId);
      const newActive =
        state.activeSessionId === sessionId ? filtered[0]?.id || null : state.activeSessionId;
      const { [sessionId]: _removed, ...messagesBySession } = state.messagesBySession;
      return {
        sessions: filtered,
        activeSessionId: newActive,
        messagesBySession,
        messages: state.activeSessionId === sessionId
          ? (newActive ? messagesBySession[newActive] || [] : [])
          : state.messages,
      };
    });
  },
});
