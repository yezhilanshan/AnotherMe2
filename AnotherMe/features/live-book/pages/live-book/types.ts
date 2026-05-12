export type LiveBookStatus = 'draft' | 'spine_ready' | 'compiling' | 'ready' | 'failed';

export type BlockType =
  | 'section'
  | 'text'
  | 'quiz'
  | 'interactive'
  | 'animation'
  | 'deep_dive'
  | 'remedial'
  | 'callout'
  | 'figure'
  | 'flash_cards'
  | 'code'
  | 'timeline'
  | 'concept_graph'
  | 'user_note'
  | 'placeholder';

export type ViewMode = 'list' | 'creator' | 'spine' | 'reader';

export interface LiveBookSummary {
  id: string;
  title: string;
  topic: string;
  status: LiveBookStatus;
  chapterCount: number;
  pageCount: number;
  updatedAt: number;
}

export interface LiveBookProposal {
  title: string;
  description: string;
  scope: string;
  targetLevel: string;
  estimatedChapters: number;
  rationale: string;
}

export interface LiveBookChapter {
  id: string;
  title: string;
  goal: string;
  order: number;
  learningObjectives?: string[];
  contentType?: 'theory' | 'derivation' | 'practice' | 'concept' | 'mixed';
  sourceRefs?: Array<Record<string, unknown>>;
  prerequisites?: string[];
  summary?: string;
}

export interface LiveBookBlock {
  id: string;
  type: BlockType;
  title: string;
  content: string;
  status: 'ready' | 'error';
  paramsJson?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  sourceRefsJson?: Array<Record<string, unknown>>;
}

export interface LiveBookPage {
  id: string;
  chapterId: string;
  title: string;
  order: number;
  status: 'pending' | 'ready' | 'partial' | 'error';
  blocks: LiveBookBlock[];
}

export interface LiveBookProgress {
  currentPageId: string | null;
  visitedPageIds: string[];
  bookmarkedPageIds: string[];
  quizAttempts: Array<{
    pageId: string;
    blockId: string;
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
    timestamp: number;
  }>;
  weakChapterIds: string[];
  score: number;
  updatedAt: number;
}

export interface LiveBookQuality {
  compileTotal: number;
  compileFailed: number;
  blockErrors: number;
  supplementHits: number;
}

export interface LiveBookRecord {
  id: string;
  title: string;
  topic: string;
  language: 'zh-CN' | 'en-US';
  targetLevel: string;
  status: LiveBookStatus;
  proposal: LiveBookProposal;
  chapters: LiveBookChapter[];
  pages: LiveBookPage[];
  progress: LiveBookProgress;
  quality: LiveBookQuality;
  conceptGraphJson?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface LiveBookJob {
  id: string;
  bookId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage:
    | 'queued'
    | 'ideation'
    | 'exploration'
    | 'synthesis'
    | 'compilation'
    | 'completed'
    | 'failed';
  progress: number;
  events: LiveBookEvent[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveBookEvent {
  id: string;
  type:
    | 'stage_begin'
    | 'progress'
    | 'stage_end'
    | 'page_ready'
    | 'block_ready'
    | 'block_error'
    | 'error'
    | 'done';
  stage: LiveBookJob['stage'];
  message: string;
  progress: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Insights {
  weakProfile: {
    weakChapters: Array<{ chapterId: string; title: string; wrongCount: number }>;
    weakPoints: string[];
  };
  reviewPath: Array<{ step: number; title: string; action: string }>;
  quality: {
    compileFailureRate: number;
    blockErrorRate: number;
    supplementHitRate: number;
    compileTotal: number;
    compileFailed: number;
    blockErrors: number;
    supplementHits: number;
  };
  progress: {
    score: number;
    quizTotal: number;
    quizCorrect: number;
    visitedPages: number;
    totalPages: number;
  };
}

export interface FormState {
  topic: string;
  language: 'zh-CN' | 'en-US';
  targetLevel: string;
}

export interface LiveBookHealth {
  stalePageIds: string[];
  driftPageIds: string[];
  driftReasonByPageId: Record<string, string[]>;
  errorPageIds: string[];
  partialPageIds: string[];
  pendingPageIds: string[];
  blockErrorCount: number;
  staleCount: number;
  driftCount: number;
  ok: boolean;
}
