export interface Session {
  id: string;
  user_id: string;
  title: string;
  source?: string;
  subject?: string;
  linked_conversation_id?: string;
  linked_classroom_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  timestamp: number;
  agentName?: string;
  serverMessageId?: string;
  feedback?: 'like' | 'dislike';
  /** 推理链内容（thinking 事件累积） */
  reasoning?: string;
  /** 本次消息使用的 capability */
  capability?: string;
  /** 引用来源 */
  sources?: Array<{ title: string; url?: string }>;
  /** 工具调用记录 */
  toolCalls?: Array<{ name: string; state: 'running' | 'completed' | 'error'; input?: string; output?: string; error?: string }>;
  /** 消息已排队等待网络恢复后发送 */
  queued?: boolean;
  /** 能力结构化结果（math_animator 等） */
  capabilityResult?: {
    output_mode?: string;
    render_type?: string;
    artifacts?: Array<{ type: string; url: string; filename: string; label: string }>;
    code?: { language: string; content: string };
    analysis?: Record<string, unknown>;
    review?: Record<string, unknown>;
    summary?: Record<string, unknown>;
  };
}

export interface KnowledgeState {
  knowledge_point_id: string;
  name: string;
  subject?: string;
  mastery: number;
  attempts: number;
  last_practiced_at?: string;
}

export interface LearningRecord {
  id: string;
  session_id: string;
  summary: string;
  knowledge_points?: string[];
  created_at: string;
}

export interface LearningEventStats {
  total_events: number;
  event_types: Record<string, number>;
  recent_activity?: { date: string; count: number }[];
}

export interface WorkingMemory {
  sessionId: string;
  recentSummary: string;
  activeKnowledgePoints: string[];
  lastUpdated: number;
}

// ==================== Diagnostic ====================

export interface DiagnosticProbe {
  question: string;
  options?: string[];
  correctAnswer: string | string[];
  explanation: string;
  hints?: string[];
  probeType: 'choice' | 'fill_blank' | 'step_by_step';
  difficulty: number;
  knowledgePointId?: string;
  teachingAction?: string;
  reason?: string;
}

// ==================== Live Book ====================

export interface Book {
  id: string;
  title: string;
  description?: string;
  status: string;
  chapter_count?: number;
  created_at: string;
}

export interface Block {
  id: string;
  type: string;
  title?: string;
  status: string;
  content: string;
  bridge_text?: string;
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>;
  error?: string;
}

export interface BookPage {
  id: string;
  title: string;
  status?: string;
  blocks: Block[];
}
