'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  AlignLeft,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Code2,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  Library,
  ListChecks,
  Loader2,
  MessageSquare,
  MousePointerClick,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Send,
  Sparkles,
  Sticker,
  Trash2,
  type LucideIcon,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import {
  createInitialProgressState,
  liveBookProgressReducer,
} from '@/lib/live-book/progress-reducer';
import { LiveBookProgressTimeline, type ProgressCounters } from '@/features/live-book/components/live-book/live-book-progress-timeline';
import { LiveBookSourcePicker, type LiveBookSourceInput } from './live-book-source-picker';

function getLiveBookHeaders(): HeadersInit {
  const config = getCurrentModelConfig();
  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
    'x-requires-api-key': String(config.requiresApiKey ?? false),
  };
}

type LiveBookStatus = 'draft' | 'spine_ready' | 'compiling' | 'ready' | 'failed';
type BlockType =
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

type ViewMode = 'list' | 'creator' | 'spine' | 'reader';

interface LiveBookSummary {
  id: string;
  title: string;
  topic: string;
  status: LiveBookStatus;
  chapterCount: number;
  pageCount: number;
  updatedAt: number;
}

interface LiveBookProposal {
  title: string;
  description: string;
  scope: string;
  targetLevel: string;
  estimatedChapters: number;
  rationale: string;
}

interface LiveBookChapter {
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

interface LiveBookBlock {
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

interface LiveBookPage {
  id: string;
  chapterId: string;
  title: string;
  order: number;
  status: 'pending' | 'ready' | 'partial' | 'error';
  blocks: LiveBookBlock[];
}

interface LiveBookProgress {
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

interface LiveBookQuality {
  compileTotal: number;
  compileFailed: number;
  blockErrors: number;
  supplementHits: number;
}

interface LiveBookRecord {
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

interface LiveBookJob {
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

interface LiveBookEvent {
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

interface Insights {
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

interface FormState {
  topic: string;
  language: 'zh-CN' | 'en-US';
  targetLevel: string;
}

interface LiveBookHealth {
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

const initialForm: FormState = {
  topic: '',
  language: 'zh-CN',
  targetLevel: '',
};

async function parseApi<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { success?: boolean; error?: string } & T;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || '请求失败');
  }
  return payload;
}

function statusText(status: LiveBookStatus): string {
  if (status === 'draft') return '草案';
  if (status === 'spine_ready') return '目录就绪';
  if (status === 'compiling') return '编译中';
  if (status === 'ready') return '就绪';
  return '失败';
}

function statusColor(status: LiveBookStatus): string {
  if (status === 'ready') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'failed') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'compiling') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'spine_ready') return 'bg-gray-100 text-gray-700 border-gray-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function blockTypeColor(type: BlockType): string {
  switch (type) {
    case 'quiz':
      return 'bg-amber-50/70 border-amber-200';
    case 'deep_dive':
      return 'bg-indigo-50/70 border-indigo-200';
    case 'remedial':
      return 'bg-rose-50/70 border-rose-200';
    case 'callout':
      return 'bg-yellow-50/70 border-yellow-200';
    case 'figure':
      return 'bg-emerald-50/70 border-emerald-200';
    case 'flash_cards':
      return 'bg-violet-50/70 border-violet-200';
    case 'interactive':
      return 'bg-teal-50/70 border-teal-200';
    case 'animation':
      return 'bg-sky-50/70 border-sky-200';
    case 'code':
      return 'bg-slate-50/70 border-slate-200';
    case 'timeline':
      return 'bg-cyan-50/70 border-cyan-200';
    case 'concept_graph':
      return 'bg-blue-50/70 border-blue-200';
    case 'section':
      return 'bg-white border-gray-200';
    default:
      return 'bg-white border-gray-200';
  }
}

function blockTypeAccent(type: BlockType): string {
  switch (type) {
    case 'quiz':
      return 'bg-amber-500';
    case 'deep_dive':
      return 'bg-indigo-500';
    case 'remedial':
      return 'bg-rose-500';
    case 'callout':
      return 'bg-yellow-500';
    case 'figure':
      return 'bg-emerald-500';
    case 'interactive':
      return 'bg-teal-500';
    case 'animation':
      return 'bg-sky-500';
    case 'timeline':
      return 'bg-cyan-500';
    case 'concept_graph':
      return 'bg-blue-500';
    case 'code':
      return 'bg-slate-500';
    default:
      return 'bg-gray-400';
  }
}

function blockTypeLabel(type: BlockType): string {
  const labels: Record<BlockType, string> = {
    section: '导学',
    text: '讲解',
    quiz: '测验',
    interactive: '互动',
    animation: '演示',
    deep_dive: '深入',
    remedial: '补救',
    callout: '提示',
    figure: '图示',
    flash_cards: '卡片',
    code: '代码',
    timeline: '时间线',
    concept_graph: '概念图',
    user_note: '笔记',
    placeholder: '占位',
  };
  return labels[type] || type;
}

const BLOCK_TYPE_ICON: Record<BlockType, LucideIcon> = {
  section: BookOpen,
  text: AlignLeft,
  quiz: ListChecks,
  interactive: MousePointerClick,
  animation: Film,
  deep_dive: MessageSquare,
  remedial: AlertTriangle,
  callout: Sparkles,
  figure: ImageIcon,
  flash_cards: Sticker,
  code: Code2,
  timeline: Layers,
  concept_graph: Layers,
  user_note: FileText,
  placeholder: Circle,
};

const INSERTABLE_BLOCK_TYPES: BlockType[] = [
  'text',
  'callout',
  'quiz',
  'code',
  'timeline',
  'flash_cards',
  'figure',
  'interactive',
  'animation',
  'deep_dive',
  'user_note',
];

const CHANGEABLE_BLOCK_TYPES: BlockType[] = [
  'section',
  'text',
  'callout',
  'quiz',
  'interactive',
  'animation',
  'deep_dive',
  'remedial',
  'figure',
  'flash_cards',
  'code',
  'timeline',
  'concept_graph',
  'user_note',
];

function manualBlockDefaults(type: BlockType) {
  const label = blockTypeLabel(type);
  return {
    title: `手动插入${label}`,
    content: `这是一个手动插入的${label}块，可继续重生成或调整类型。`,
  };
}

function extractBlockSourceLabels(block: LiveBookBlock): string[] {
  const labels: string[] = [];
  const metadataAnchors = Array.isArray(block.metadataJson?.sourceAnchors)
    ? block.metadataJson.sourceAnchors
    : [];
  for (const anchor of metadataAnchors) {
    if (!anchor || typeof anchor !== 'object') continue;
    const record = anchor as Record<string, unknown>;
    const name = typeof record.sourceName === 'string' ? record.sourceName : undefined;
    const snippet = typeof record.contentSnippet === 'string' ? record.contentSnippet : undefined;
    const label = [name, snippet?.slice(0, 36)].filter(Boolean).join(' · ');
    if (label) labels.push(label);
  }
  for (const ref of block.sourceRefsJson || []) {
    const refText = typeof ref.ref === 'string' ? ref.ref : undefined;
    const snippet = typeof ref.snippet === 'string' ? ref.snippet : undefined;
    const label = [refText, snippet?.slice(0, 36)].filter(Boolean).join(' · ');
    if (label) labels.push(label);
  }
  return Array.from(new Set(labels)).slice(0, 3);
}

function getBlockPayload(block: LiveBookBlock): Record<string, unknown> {
  return block.payloadJson && typeof block.payloadJson === 'object'
    ? block.payloadJson
    : block.paramsJson && typeof block.paramsJson === 'object'
      ? block.paramsJson
      : {};
}

function extractBlockBridgeText(block: LiveBookBlock): string {
  const payload = getBlockPayload(block);
  const candidates = [
    payload.bridge_text,
    payload.bridgeText,
    block.paramsJson?.bridgeText,
    block.metadataJson?.bridgeText,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function renderBlockPayload(block: LiveBookBlock) {
  const payload = getBlockPayload(block);
  const payloadType = String(payload.type || block.type);

  if (payloadType === 'section' && Array.isArray(payload.subsections)) {
    return (
      <div className="space-y-4">
        {(payload.subsections as Array<Record<string, unknown>>).map((section, index) => (
          <section key={`${block.id}-section-${index}`} className="space-y-1">
            <h4 className="text-sm font-semibold text-gray-900">
              {String(section.heading || block.title)}
            </h4>
            <p className="whitespace-pre-wrap text-[15px] leading-8 text-gray-700">
              {String(section.body || '')}
            </p>
          </section>
        ))}
      </div>
    );
  }

  if (payloadType === 'quiz' && Array.isArray(payload.questions)) {
    return (
      <div className="space-y-3">
        {(payload.questions as Array<Record<string, unknown>>).map((question, index) => (
          <div
            key={`${block.id}-q-${index}`}
            className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3"
          >
            <p className="text-xs font-semibold uppercase text-amber-700">Question {index + 1}</p>
            <p className="mt-1 text-[15px] leading-7 text-gray-800">
              {String(question.prompt || block.content)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (payloadType === 'flash_cards' && Array.isArray(payload.cards)) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {(payload.cards as Array<Record<string, unknown>>).slice(0, 4).map((card, index) => (
          <div
            key={`${block.id}-card-${index}`}
            className="rounded-md border border-violet-200 bg-white/80 px-4 py-3"
          >
            <p className="text-xs font-semibold text-violet-700">{String(card.front || '')}</p>
            <p className="mt-2 text-sm leading-6 text-gray-600">{String(card.back || '')}</p>
          </div>
        ))}
      </div>
    );
  }

  if (payloadType === 'callout') {
    return (
      <div className="rounded-md border border-yellow-200 bg-yellow-50/70 px-4 py-3 text-[15px] leading-7 text-gray-800">
        {String(payload.body || block.content)}
      </div>
    );
  }

  if (payloadType === 'figure') {
    return (
      <div className="space-y-2">
        <pre className="overflow-x-auto rounded-md border border-emerald-200 bg-white px-4 py-3 text-xs text-gray-600">
          {String(payload.code || block.content)}
        </pre>
        {typeof payload.caption === 'string' && (
          <p className="text-xs text-gray-500">{payload.caption}</p>
        )}
      </div>
    );
  }

  if (payloadType === 'code') {
    return (
      <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
        {String(payload.code || block.content)}
      </pre>
    );
  }

  if (payloadType === 'timeline' && Array.isArray(payload.steps)) {
    return (
      <ol className="space-y-3">
        {(payload.steps as Array<Record<string, unknown>>).map((step, index) => (
          <li key={`${block.id}-step-${index}`} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{String(step.title || '')}</p>
              <p className="text-sm leading-6 text-gray-600">{String(step.description || '')}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-[15px] leading-8 text-gray-700">{block.content}</div>
  );
}

function pageStatusBadge(status: LiveBookPage['status']) {
  switch (status) {
    case 'ready':
      return { text: '就绪', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'error':
      return { text: '错误', className: 'bg-red-50 text-red-700 border-red-200' };
    case 'partial':
      return { text: '部分', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    default:
      return { text: '待编译', className: 'bg-gray-50 text-gray-600 border-gray-200' };
  }
}

export default function LiveBookPage() {
  const searchParams = useSearchParams();
  const [form, setForm] = useState<FormState>(initialForm);
  const [books, setBooks] = useState<LiveBookSummary[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveBookRecord | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [sourceItems, setSourceItems] = useState<LiveBookSourceInput[]>([]);

  const [loadingBooks, setLoadingBooks] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [operatingBlockId, setOperatingBlockId] = useState<string | null>(null);

  const [progressState, dispatchProgress] = useReducer(
    liveBookProgressReducer<LiveBookJob, LiveBookEvent>,
    createInitialProgressState<LiveBookJob, LiveBookEvent>(),
  );

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string; streaming?: boolean }>
  >([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [insights, setInsights] = useState<Insights | null>(null);
  const [health, setHealth] = useState<LiveBookHealth | null>(null);
  const [refreshingHealth, setRefreshingHealth] = useState(false);

  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [typeMenuBlockId, setTypeMenuBlockId] = useState<string | null>(null);
  const [scrollContainerElement, setScrollContainerElement] = useState<HTMLDivElement | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamClosedByUsRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const setReaderScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollContainerElement(node);
  }, []);

  const selectedPage = useMemo(() => {
    if (!detail || !selectedPageId) return null;
    return detail.pages.find((item) => item.id === selectedPageId) || null;
  }, [detail, selectedPageId]);

  const currentChapter = useMemo(() => {
    if (!detail || !selectedPage) return null;
    return detail.chapters.find((item) => item.id === selectedPage.chapterId) || null;
  }, [detail, selectedPage]);

  const refreshBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const payload = await parseApi<{ books: LiveBookSummary[] }>(
        await fetch('/api/live-book/books', { cache: 'no-store' }),
      );
      setBooks(payload.books);
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  const loadDetail = useCallback(
    async (bookId: string) => {
      const payload = await parseApi<{ book: LiveBookRecord }>(
        await fetch(`/api/live-book/books/${encodeURIComponent(bookId)}`, {
          cache: 'no-store',
        }),
      );

      setDetail(payload.book);

      if (!selectedPageId || !payload.book.pages.some((item) => item.id === selectedPageId)) {
        const firstPage = payload.book.pages.sort((a, b) => a.order - b.order)[0];
        setSelectedPageId(firstPage?.id || null);
      }

      if (payload.book.status === 'draft') {
        setView('creator');
      } else if (payload.book.status === 'spine_ready' || payload.book.status === 'compiling') {
        setView('spine');
      } else {
        setView('reader');
      }

      return payload.book;
    },
    [selectedPageId],
  );

  const loadInsights = useCallback(async (bookId: string) => {
    try {
      const payload = await parseApi<{ insights: Insights }>(
        await fetch(`/api/live-book/books/${encodeURIComponent(bookId)}/insights`, {
          cache: 'no-store',
        }),
      );
      setInsights(payload.insights);
    } catch {
      setInsights(null);
    }
  }, []);

  const loadHealth = useCallback(async (bookId: string) => {
    try {
      const payload = await parseApi<{ health: LiveBookHealth }>(
        await fetch(`/api/live-book/books/${encodeURIComponent(bookId)}/health`, {
          cache: 'no-store',
        }),
      );
      setHealth(payload.health);
      return payload.health;
    } catch {
      setHealth(null);
      return null;
    }
  }, []);

  const refreshFingerprints = useCallback(
    async (bookId: string) => {
      setRefreshingHealth(true);
      try {
        const payload = await parseApi<{
          book: LiveBookRecord;
          health: LiveBookHealth;
          recompiledPageIds: string[];
        }>(
          await fetch(`/api/live-book/books/${encodeURIComponent(bookId)}/refresh-fingerprints`, {
            method: 'POST',
          }),
        );
        setDetail(payload.book);
        setHealth(payload.health);
        await loadInsights(bookId);
        await refreshBooks();
      } finally {
        setRefreshingHealth(false);
      }
    },
    [loadInsights, refreshBooks],
  );

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  useEffect(() => {
    if (!selectedBookId) {
      setDetail(null);
      setInsights(null);
      setHealth(null);
      return;
    }

    void loadDetail(selectedBookId);
    void loadInsights(selectedBookId);
    void loadHealth(selectedBookId);
  }, [selectedBookId, loadDetail, loadInsights, loadHealth]);

  useEffect(() => {
    const deepBookId = searchParams.get('bookId');
    if (deepBookId && deepBookId !== selectedBookId) {
      setSelectedBookId(deepBookId);
    }
  }, [searchParams, selectedBookId]);

  useEffect(() => {
    return () => {
      streamClosedByUsRef.current = true;
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  const connectJobStream = useCallback(
    (jobId: string, bookId: string) => {
      streamClosedByUsRef.current = false;
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      dispatchProgress({ type: 'set_connection_state', state: 'connected' });

      const es = new EventSource(`/api/live-book/jobs/${encodeURIComponent(jobId)}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (message) => {
        try {
          reconnectAttemptsRef.current = 0;
          dispatchProgress({ type: 'set_reconnect_count', count: 0 });
          dispatchProgress({ type: 'set_connection_state', state: 'connected' });
          const event = JSON.parse(message.data) as LiveBookEvent;
          dispatchProgress({ type: 'ingest_event', event });

          if (event.type === 'done' || event.type === 'error') {
            streamClosedByUsRef.current = true;
            es.close();
            setCompiling(false);
            void loadDetail(bookId);
            void loadInsights(bookId);
            void loadHealth(bookId);
            void refreshBooks();
          }
        } catch {
          // ignore malformed payload
        }
      };

      es.onerror = () => {
        es.close();
        if (streamClosedByUsRef.current) {
          dispatchProgress({ type: 'set_connection_state', state: 'closed' });
          return;
        }

        const nextCount = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = nextCount;
        dispatchProgress({ type: 'set_reconnect_count', count: nextCount });
        dispatchProgress({ type: 'set_connection_state', state: 'reconnecting' });

        const delay = Math.min(10000, 800 * 2 ** Math.min(5, nextCount - 1));
        reconnectTimerRef.current = setTimeout(() => {
          connectJobStream(jobId, bookId);
        }, delay);
      };
    },
    [loadDetail, loadHealth, loadInsights, refreshBooks],
  );

  async function handleCreateBook() {
    if (!form.topic.trim()) return;
    setCreating(true);
    try {
      const payload = await parseApi<{ book: LiveBookRecord }>(
        await fetch('/api/live-book/create', {
          method: 'POST',
          headers: getLiveBookHeaders(),
          body: JSON.stringify({
            topic: form.topic,
            language: form.language,
            targetLevel: form.targetLevel,
            ...(sourceItems.length > 0 ? { sources: sourceItems } : {}),
          }),
        }),
      );

      await refreshBooks();
      setSelectedBookId(payload.book.id);
      setForm((prev) => ({ ...prev, topic: '' }));
      setSourceItems([]);
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmProposal() {
    if (!detail) return;
    setConfirming(true);
    try {
      // Step 1: call confirm-proposal to run SourceExplorer + SpineSynthesizer
      const proposalPayload = await parseApi<{ book: LiveBookRecord }>(
        await fetch('/api/live-book/confirm-proposal', {
          method: 'POST',
          headers: getLiveBookHeaders(),
          body: JSON.stringify({ bookId: detail.id }),
        }),
      );
      setDetail(proposalPayload.book);
      setSelectedPageId(
        proposalPayload.book.pages.sort((a, b) => a.order - b.order)[0]?.id || null,
      );
      setView('spine');
      await refreshBooks();
      await loadInsights(proposalPayload.book.id);
    } finally {
      setConfirming(false);
    }
  }

  async function handleConfirmSpine() {
    if (!detail) return;
    setConfirming(true);
    try {
      const payload = await parseApi<{ book: LiveBookRecord }>(
        await fetch('/api/live-book/confirm-spine', {
          method: 'POST',
          headers: getLiveBookHeaders(),
          body: JSON.stringify({ bookId: detail.id }),
        }),
      );
      setDetail(payload.book);
      setSelectedPageId(payload.book.pages.sort((a, b) => a.order - b.order)[0]?.id || null);
      setView('spine');
      await refreshBooks();
      await loadInsights(payload.book.id);
    } finally {
      setConfirming(false);
    }
  }

  async function handleReorderChapter(chapterId: string, direction: 'up' | 'down') {
    if (!detail) return;
    const ordered = [...detail.chapters].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((item) => item.id === chapterId);
    if (idx < 0) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ordered.length) return;

    const swapped = [...ordered];
    const current = swapped[idx];
    swapped[idx] = swapped[target];
    swapped[target] = current;

    const payload = await parseApi<{ book: LiveBookRecord }>(
      await fetch(`/api/live-book/books/${encodeURIComponent(detail.id)}`, {
        method: 'PATCH',
        headers: getLiveBookHeaders(),
        body: JSON.stringify({ chapterOrder: swapped.map((item) => item.id) }),
      }),
    );

    setDetail(payload.book);
  }

  async function handleCompile() {
    if (!detail) return;
    setCompiling(true);

    const payload = await parseApi<{ job: LiveBookJob }>(
      await fetch('/api/live-book/compile', {
        method: 'POST',
        headers: getLiveBookHeaders(),
        body: JSON.stringify({
          bookId: detail.id,
          ...(selectedPage ? { priorityPageId: selectedPage.id } : {}),
        }),
      }),
    );

    dispatchProgress({ type: 'set_job', job: payload.job, events: payload.job.events || [] });
    connectJobStream(payload.job.id, detail.id);
    setView('spine');
  }

  async function handleCompilePage(pageId: string) {
    if (!detail) return;
    setCompiling(true);
    try {
      const payload = await parseApi<{ book: LiveBookRecord }>(
        await fetch('/api/live-book/compile-page', {
          method: 'POST',
          headers: getLiveBookHeaders(),
          body: JSON.stringify({ bookId: detail.id, pageId }),
        }),
      );
      setDetail(payload.book);
      await loadInsights(detail.id);
      await loadHealth(detail.id);
    } finally {
      setCompiling(false);
    }
  }

  async function handlePrimaryCompile() {
    if (!detail) return;

    if (view === 'reader' && selectedPage) {
      await handleCompilePage(selectedPage.id);
      return;
    }

    await handleCompile();
  }

  async function handleOperateBlock(
    action: 'insert' | 'move' | 'delete' | 'regenerate' | 'change_type',
    args: {
      pageId: string;
      blockId?: string;
      direction?: 'up' | 'down';
      blockType?: BlockType;
    },
  ) {
    if (!detail) return;
    setOperatingBlockId(args.blockId || `${args.pageId}-${action}`);
    try {
      if (action === 'regenerate' && args.blockId) {
        const payload = await parseApi<{ book: LiveBookRecord }>(
          await fetch('/api/live-book/regenerate-block', {
            method: 'POST',
            headers: getLiveBookHeaders(),
            body: JSON.stringify({
              bookId: detail.id,
              pageId: args.pageId,
              blockId: args.blockId,
            }),
          }),
        );
        setDetail(payload.book);
        await loadInsights(detail.id);
        await loadHealth(detail.id);
      } else {
        const payload = await parseApi<{ book: LiveBookRecord }>(
          await fetch(`/api/live-book/books/${encodeURIComponent(detail.id)}/blocks`, {
            method: 'POST',
            headers: getLiveBookHeaders(),
            body: JSON.stringify({
              action,
              pageId: args.pageId,
              ...(args.blockId ? { blockId: args.blockId } : {}),
              ...(args.direction ? { direction: args.direction } : {}),
              ...(args.blockType ? { blockType: args.blockType } : {}),
              ...(action === 'insert' ? manualBlockDefaults(args.blockType || 'text') : {}),
            }),
          }),
        );
        setDetail(payload.book);
        await loadInsights(detail.id);
        await loadHealth(detail.id);
      }
    } finally {
      setOperatingBlockId(null);
      setInsertMenuOpen(false);
      setTypeMenuBlockId(null);
    }
  }

  async function handleQuizAttempt(block: LiveBookBlock, isCorrect: boolean) {
    if (!detail || !selectedPage) return;

    const payload = await parseApi<{ book: LiveBookRecord }>(
      await fetch(`/api/live-book/books/${encodeURIComponent(detail.id)}/quiz-attempt`, {
        method: 'POST',
        headers: getLiveBookHeaders(),
        body: JSON.stringify({
          pageId: selectedPage.id,
          blockId: block.id,
          isCorrect,
          userAnswer: isCorrect ? '我理解了关键策略。' : '我在条件判断上出错。',
        }),
      }),
    );

    setDetail(payload.book);
    await loadInsights(detail.id);
    await loadHealth(detail.id);
  }

  async function handlePageChat() {
    if (!detail || !selectedPage || !chatInput.trim()) return;

    const userText = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: 'user', content: userText }]);
    setChatInput('');

    setChatStreaming(true);
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

    try {
      const response = await fetch(
        `/api/live-book/books/${encodeURIComponent(detail.id)}/chat/stream`,
        {
          method: 'POST',
          headers: getLiveBookHeaders(),
          body: JSON.stringify({
            pageId: selectedPage.id,
            message: userText,
          }),
        },
      );

      if (!response.ok || !response.body) {
        throw new Error('流式问答失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalBook: LiveBookRecord | null = null;
      let finalReply = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const raw = part.slice(6);
          try {
            const payload = JSON.parse(raw) as
              | { type: 'start' }
              | { type: 'chunk'; chunk: string }
              | { type: 'done'; reply: string; book: LiveBookRecord };

            if (payload.type === 'chunk') {
              finalReply += payload.chunk;
              setChatMessages((prev) => {
                const next = [...prev];
                const idx = next.length - 1;
                if (idx >= 0 && next[idx].role === 'assistant') {
                  next[idx] = {
                    role: 'assistant',
                    content: finalReply,
                    streaming: true,
                  };
                }
                return next;
              });
            }

            if (payload.type === 'done') {
              finalBook = payload.book;
              finalReply = payload.reply;
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }

      setChatMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === 'assistant') {
          next[idx] = {
            role: 'assistant',
            content: finalReply || next[idx].content,
          };
        }
        return next;
      });

      if (finalBook) {
        setDetail(finalBook);
        await loadInsights(detail.id);
        await loadHealth(detail.id);
      }
    } catch {
      setChatMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === 'assistant' && next[idx].streaming) {
          next[idx] = { role: 'assistant', content: '问答流中断了，请稍后重试。' };
          return next;
        }
        return [...next, { role: 'assistant', content: '问答流中断了，请稍后重试。' }];
      });
    } finally {
      setChatStreaming(false);
      setChatMessages((prev) =>
        prev.map((item) => (item.streaming ? { ...item, streaming: false } : item)),
      );
    }
  }

  useEffect(() => {
    if (!detail || !selectedPage || compiling) return;
    if (
      selectedPage.status === 'pending' ||
      selectedPage.status === 'partial' ||
      selectedPage.status === 'error'
    ) {
      void handleCompilePage(selectedPage.id);
    }
  }, [detail, selectedPage, compiling]);

  useEffect(() => {
    setHeaderCollapsed(false);
    setOutlineCollapsed(false);
    setActiveBlockId(null);
    setInsertMenuOpen(false);
    setTypeMenuBlockId(null);
    setChatOpen(false);
    scrollContainerElement?.scrollTo({ top: 0 });
  }, [selectedPage?.id, scrollContainerElement]);

  // Close type menu when clicking outside
  useEffect(() => {
    if (!typeMenuBlockId) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-type-menu]')) {
        setTypeMenuBlockId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [typeMenuBlockId]);

  // Close insert menu when clicking outside
  useEffect(() => {
    if (!insertMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-insert-menu]')) {
        setInsertMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [insertMenuOpen]);

  useEffect(() => {
    if (view !== 'reader' || !selectedPage || !scrollContainerElement) return;

    let lastTop = scrollContainerElement.scrollTop;
    const handleScroll = () => {
      const top = scrollContainerElement.scrollTop;
      if (top < 24) {
        setHeaderCollapsed(false);
      } else if (top > 96 && top > lastTop + 10) {
        setHeaderCollapsed(true);
      }
      lastTop = top;
    };

    scrollContainerElement.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => scrollContainerElement.removeEventListener('scroll', handleScroll);
  }, [scrollContainerElement, selectedPage, view]);

  useEffect(() => {
    if (!selectedPage || !scrollContainerElement || selectedPage.blocks.length === 0) return;

    const elements = selectedPage.blocks
      .map((block) => document.getElementById(`block-${block.id}`))
      .filter((item): item is HTMLElement => Boolean(item));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const firstVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (firstVisible) {
          setActiveBlockId(firstVisible.target.id.replace(/^block-/, ''));
        }
      },
      {
        root: scrollContainerElement,
        rootMargin: '-20% 0px -65% 0px',
        threshold: 0,
      },
    );

    elements.forEach((element) => observer.observe(element));
    setActiveBlockId((current) => current || selectedPage.blocks[0]?.id || null);
    return () => observer.disconnect();
  }, [scrollContainerElement, selectedPage]);

  const chapterCount = detail?.chapters.length || 0;
  const readyBooksCount = books.filter((b) => b.status === 'ready').length;

  const currentStage = progressState.job?.stage || 'queued';
  const currentProgress = progressState.job?.progress || 0;
  const hasProgressActivity = progressState.job !== null;

  // ── Render helpers ────────────────────────────────────────────────

  function renderSidebar() {
    if (view === 'list') return null;

    const book = detail;
    const pages = book?.pages || [];

    return (
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
        {/* Sidebar Header */}
        <div className="border-b border-gray-100 p-4">
          <button
            onClick={() => {
              setSelectedBookId(null);
              setDetail(null);
              setView('list');
            }}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回书库
          </button>
          {book && (
            <div className="mt-3">
              <p className="text-sm font-semibold text-gray-900 truncate">{book.title}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    statusColor(book.status),
                  )}
                >
                  {statusText(book.status)}
                </span>
                <span className="text-[11px] text-gray-400">{pages.length} 页</span>
              </div>
            </div>
          )}
        </div>

        {/* Page Navigation */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            页面导航
          </p>
          <div className="space-y-0.5">
            {pages
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((page) => {
                const badge = pageStatusBadge(page.status);
                const isActive = selectedPageId === page.id;
                const isError = page.status === 'error';
                const isPending = page.status === 'pending';
                return (
                  <button
                    key={page.id}
                    onClick={() => setSelectedPageId(page.id)}
                    className={cn(
                      'w-full rounded-lg px-2.5 py-2 text-left transition-all duration-200 relative',
                      isActive
                        ? 'bg-gray-50 border border-gray-200 shadow-sm'
                        : 'hover:bg-gray-50/80 border border-transparent',
                      isError && !isActive && 'bg-red-50/30',
                    )}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-gray-900" />
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold transition-colors',
                          isActive
                            ? 'bg-gray-900 text-white'
                            : isError
                              ? 'bg-red-100 text-red-600'
                              : isPending
                                ? 'bg-gray-100 text-gray-400'
                                : 'bg-gray-100 text-gray-500',
                        )}
                      >
                        {page.order}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'text-xs font-medium truncate leading-relaxed',
                            isActive ? 'text-gray-900' : 'text-gray-700',
                          )}
                        >
                          {page.title}
                        </p>
                      </div>
                      {/* Status dot for non-active items */}
                      {!isActive && (
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            isError
                              ? 'bg-red-400'
                              : page.status === 'ready'
                                ? 'bg-emerald-400'
                                : page.status === 'partial'
                                  ? 'bg-amber-400'
                                  : 'bg-gray-300',
                          )}
                        />
                      )}
                      {/* Badge for active item */}
                      {isActive && (
                        <span
                          className={cn(
                            'shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium border',
                            badge.className,
                          )}
                        >
                          {badge.text}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Sidebar Footer - Insights mini */}
        {insights && (
          <div className="border-t border-gray-100 p-3 space-y-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-400">学习得分</span>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, insights.progress.score)}%` }}
                  />
                </div>
                <span className="font-semibold text-gray-900 tabular-nums">{insights.progress.score}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-400">测验</span>
              <span className="font-semibold text-gray-900">
                <span className={insights.progress.quizCorrect === insights.progress.quizTotal && insights.progress.quizTotal > 0 ? 'text-emerald-600' : ''}>
                  {insights.progress.quizCorrect}
                </span>
                <span className="text-gray-400">/{insights.progress.quizTotal}</span>
              </span>
            </div>
          </div>
        )}
      </aside>
    );
  }

  function renderHealthBanner() {
    if (!health || health.ok) return null;

    const totalIssues = health.staleCount + health.driftCount + health.blockErrorCount;

    return (
      <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-amber-800">检测到可修复状态</p>
              <span className="flex h-5 items-center rounded-full bg-amber-100 px-2 text-[10px] font-medium text-amber-700">
                {totalIssues} 项
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-700">
              {health.staleCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  未就绪 {health.staleCount}
                </span>
              )}
              {health.driftCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                  漂移 {health.driftCount}
                </span>
              )}
              {health.blockErrorCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  块错误 {health.blockErrorCount}
                </span>
              )}
            </div>
            {health.driftPageIds.length > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-600 truncate">
                涉及页面：{health.driftPageIds.slice(0, 4).join(' · ')}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0"
            onClick={() => void refreshFingerprints(detail!.id)}
            disabled={refreshingHealth}
          >
            {refreshingHealth ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            一键修复
          </Button>
        </div>
      </div>
    );
  }

  function renderReaderHeader() {
    if (!selectedPage) return null;

    const readyBlocks = selectedPage.blocks.filter((b) => b.status === 'ready').length;
    const errorBlocks = selectedPage.blocks.filter((b) => b.status === 'error' || b.error).length;
    const blockProgress = selectedPage.blocks.length > 0
      ? Math.round((readyBlocks / selectedPage.blocks.length) * 100)
      : 0;

    return (
      <header
        className={cn(
          'border-b border-gray-200 bg-white/90 backdrop-blur transition-all duration-300 ease-out shrink-0',
          headerCollapsed ? 'px-6 py-2.5' : 'px-8 py-6',
        )}
      >
        <div className="mx-auto flex w-full max-w-[78ch] items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            {/* Breadcrumb */}
            {!headerCollapsed && currentChapter && (
              <div className="mb-2 flex items-center gap-2 text-[11px] text-gray-400">
                <span className="font-medium text-gray-500">{detail?.title}</span>
                <ChevronRight className="h-3 w-3" />
                <span>{currentChapter.title}</span>
              </div>
            )}
            <h1
              className={cn(
                'font-semibold leading-tight tracking-tight text-gray-900 transition-all duration-300',
                headerCollapsed ? 'truncate text-[15px]' : 'text-[22px]',
              )}
              title={selectedPage.title}
            >
              {selectedPage.title}
            </h1>
            {!headerCollapsed && currentChapter && (
              <div className="mt-3 space-y-3">
                {currentChapter.goal && (
                  <div className="flex items-start gap-2">
                    <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <p className="max-w-[68ch] text-sm leading-6 text-gray-600">
                      {currentChapter.goal}
                    </p>
                  </div>
                )}
                {currentChapter.learningObjectives &&
                  currentChapter.learningObjectives.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {currentChapter.learningObjectives.slice(0, 6).map((objective) => (
                        <span
                          key={objective}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-700"
                        >
                          {objective}
                        </span>
                      ))}
                    </div>
                  )}
                {currentChapter.prerequisites && currentChapter.prerequisites.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="text-gray-400">前置知识:</span>
                    <span>{currentChapter.prerequisites.join(' · ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!headerCollapsed && (
              <>
                {/* Block progress mini */}
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-gray-600">
                        {readyBlocks}/{selectedPage.blocks.length}
                      </span>
                      <span className="text-[10px] text-gray-400">块就绪</span>
                    </div>
                    {/* Mini progress bar */}
                    <div className="h-1 w-20 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          errorBlocks > 0 ? 'bg-amber-500' : 'bg-emerald-500',
                        )}
                        style={{ width: `${blockProgress}%` }}
                      />
                    </div>
                  </div>
                  {errorBlocks > 0 && (
                    <span className="flex h-5 items-center rounded-full bg-red-100 px-1.5 text-[10px] font-medium text-red-600">
                      {errorBlocks}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium border',
                    pageStatusBadge(selectedPage.status).className,
                  )}
                >
                  {pageStatusBadge(selectedPage.status).text}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCompilePage(selectedPage.id)}
                  disabled={compiling}
                  className="h-8 text-xs border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  {compiling ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  重编译
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setHeaderCollapsed((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              {headerCollapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </header>
    );
  }

  function renderPageOutline() {
    if (!selectedPage || selectedPage.blocks.length === 0) return null;

    const jumpToBlock = (blockId: string) => {
      const element = document.getElementById(`block-${blockId}`);
      if (!element) return;
      setActiveBlockId(blockId);
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
      <aside className="pointer-events-none absolute right-0 top-1/2 z-30 hidden -translate-y-1/2 xl:block">
        <div
          className={cn(
            'pointer-events-auto relative overflow-hidden border border-gray-200 bg-white/90 shadow-md backdrop-blur transition-all duration-300',
            outlineCollapsed ? 'w-7 rounded-l-md border-r-0' : 'w-60 rounded-lg',
          )}
        >
          <nav
            aria-label="本页内容"
            aria-hidden={outlineCollapsed}
            className={cn(
              'flex w-60 flex-col text-[12px] transition-all duration-300',
              outlineCollapsed
                ? 'pointer-events-none max-h-16 translate-x-2 opacity-0'
                : 'max-h-[min(70vh,520px)] translate-x-0 opacity-100',
            )}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase text-gray-500">
                <Layers className="h-3.5 w-3.5" />
                <span>本页内容</span>
              </div>
              <button
                type="button"
                onClick={() => setOutlineCollapsed(true)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="隐藏目录"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <ol className="flex-1 overflow-y-auto px-1.5 py-1.5">
              {selectedPage.blocks.map((block, index) => {
                const Icon = BLOCK_TYPE_ICON[block.type] || FileText;
                const isActive = activeBlockId === block.id;
                const isError = block.status === 'error';
                return (
                  <li key={block.id}>
                    <button
                      type="button"
                      onClick={() => jumpToBlock(block.id)}
                      className={cn(
                        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        isActive
                          ? 'bg-gray-900/5 text-gray-900'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0',
                          isActive ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-700',
                        )}
                      >
                        {isError ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                        ) : (
                          <Icon className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="shrink-0 text-[10.5px] tabular-nums text-gray-400">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span
                          className="truncate"
                          title={`${blockTypeLabel(block.type)} · ${block.title}`}
                        >
                          {block.title || blockTypeLabel(block.type)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          isError
                            ? 'bg-rose-500'
                            : block.status === 'ready'
                              ? 'bg-emerald-500'
                              : 'bg-gray-300',
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <button
            type="button"
            onClick={() => setOutlineCollapsed(false)}
            title="展开目录"
            aria-label="展开目录"
            aria-hidden={!outlineCollapsed}
            tabIndex={outlineCollapsed ? 0 : -1}
            className={cn(
              'absolute inset-0 flex items-center justify-center text-gray-400 transition hover:text-gray-800',
              outlineCollapsed
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
          </button>
        </div>
      </aside>
    );
  }

  function renderBlocks() {
    if (!selectedPage) return null;

    return (
      <div className="relative flex-1 overflow-hidden bg-[#f8fafb]">
        <div className="h-full overflow-y-auto" ref={setReaderScrollContainer}>
          <div className="mx-auto max-w-[78ch] px-6 py-8">
            {currentChapter && !headerCollapsed && (
              <div className="mb-6 border-l-2 border-gray-900 bg-white px-5 py-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-900 px-2.5 py-0.5 text-[11px] font-medium text-white">
                    Chapter {currentChapter.order}
                  </span>
                  <span className="text-xs font-medium text-gray-500">{detail?.topic}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-gray-900">
                  {currentChapter.summary || currentChapter.title}
                </p>
                {currentChapter.prerequisites && currentChapter.prerequisites.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    前置：{currentChapter.prerequisites.join(' · ')}
                  </p>
                )}
              </div>
            )}

            <article className="flex flex-col gap-5">
              {selectedPage.blocks.map((block, index) => {
                const sourceLabels = extractBlockSourceLabels(block);
                const bridgeText = extractBlockBridgeText(block);
                return (
                  <div
                    key={block.id}
                    id={`block-${block.id}`}
                    className={cn(
                      'group relative scroll-mt-6 rounded-lg border p-5 pl-6 shadow-sm transition-all duration-200 hover:shadow-md',
                      blockTypeColor(block.type),
                      activeBlockId === block.id ? 'ring-1 ring-gray-900/10' : '',
                    )}
                  >
                    <div
                      className={cn(
                        'absolute left-0 top-0 h-full w-1',
                        blockTypeAccent(block.type),
                      )}
                    />
                    {/* Hover action bar */}
                    <div className="pointer-events-none absolute -top-3 right-3 z-10 flex translate-y-1 items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-0.5 text-gray-500 opacity-0 shadow-sm transition group-hover:translate-y-0 group-hover:opacity-100">
                      <button
                        onClick={() =>
                          void handleOperateBlock('move', {
                            pageId: selectedPage.id,
                            blockId: block.id,
                            direction: 'up',
                          })
                        }
                        disabled={operatingBlockId === block.id || index === 0}
                        className="pointer-events-auto rounded p-1 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                        title="上移"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          void handleOperateBlock('move', {
                            pageId: selectedPage.id,
                            blockId: block.id,
                            direction: 'down',
                          })
                        }
                        disabled={operatingBlockId === block.id || index === selectedPage.blocks.length - 1}
                        className="pointer-events-auto rounded p-1 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                        title="下移"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <div className="pointer-events-auto relative" data-type-menu>
                        <button
                          type="button"
                          onClick={() =>
                            setTypeMenuBlockId((current) =>
                              current === block.id ? null : block.id,
                            )
                          }
                          disabled={operatingBlockId === block.id}
                          className="rounded p-1 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                          title="调整类型"
                        >
                          <Replace className="h-3.5 w-3.5" />
                        </button>
                        {typeMenuBlockId === block.id && (
                          <div className="absolute right-0 top-full mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 shadow-xl">
                            <p className="px-2 py-1 text-[10px] font-medium uppercase text-gray-400">
                              切换类型
                            </p>
                            {CHANGEABLE_BLOCK_TYPES.filter((type) => type !== block.type).map(
                              (type) => {
                                const Icon = BLOCK_TYPE_ICON[type] || FileText;
                                return (
                                  <button
                                    key={type}
                                    type="button"
                                    onClick={() =>
                                      void handleOperateBlock('change_type', {
                                        pageId: selectedPage.id,
                                        blockId: block.id,
                                        blockType: type,
                                      })
                                    }
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 hover:text-gray-900"
                                  >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{blockTypeLabel(type)}</span>
                                  </button>
                                );
                              },
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          void handleOperateBlock('regenerate', {
                            pageId: selectedPage.id,
                            blockId: block.id,
                          })
                        }
                        disabled={operatingBlockId === block.id}
                        className="pointer-events-auto rounded p-1 hover:bg-gray-100 hover:text-gray-700"
                        title="重生成"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          void handleOperateBlock('delete', {
                            pageId: selectedPage.id,
                            blockId: block.id,
                          })
                        }
                        disabled={operatingBlockId === block.id}
                        className="pointer-events-auto rounded p-1 hover:bg-rose-100 hover:text-rose-700"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Block header */}
                    <div className="mb-3 flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                            Step {index + 1}
                          </span>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border shadow-sm',
                              block.status === 'error'
                                ? 'bg-red-50 text-red-600 border-red-100'
                                : block.status === 'ready'
                                  ? 'bg-white/90 text-gray-500 border-gray-100'
                                  : 'bg-gray-50 text-gray-400 border-gray-100',
                            )}
                          >
                            {block.status === 'error' && (
                              <AlertTriangle className="h-2.5 w-2.5" />
                            )}
                            {blockTypeLabel(block.type)}
                          </span>
                        </div>
                        <p className="text-base font-semibold leading-6 text-gray-900">
                          {block.title}
                        </p>
                      </div>
                      {block.status === 'ready' && (
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                      )}
                    </div>

                    {/* Block content */}
                    {bridgeText && (
                      <div className="mb-3 rounded-md border border-gray-100 bg-white/70 px-3 py-2 text-[13px] leading-6 text-gray-600">
                        {bridgeText}
                      </div>
                    )}
                    {renderBlockPayload(block)}

                    {sourceLabels.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
                        {sourceLabels.map((label) => (
                          <span
                            key={label}
                            className="max-w-full truncate rounded-full border border-gray-200 bg-white/80 px-2.5 py-1 text-[11px] text-gray-500"
                          >
                            来源：{label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Error state */}
                    {block.status === 'error' || block.error ? (
                      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100">
                            <AlertTriangle className="h-4 w-4 text-rose-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-rose-800">
                              块生成失败
                            </p>
                            <p className="mt-1 text-xs text-rose-600 leading-relaxed">
                              {block.error || '未提供错误详情'}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void handleOperateBlock('regenerate', {
                                    pageId: selectedPage.id,
                                    blockId: block.id,
                                  })
                                }
                                disabled={operatingBlockId === block.id}
                                className="border-rose-300 text-rose-700 hover:bg-rose-100 text-xs h-8"
                              >
                                {operatingBlockId === block.id ? (
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3 w-3 mr-1" />
                                )}
                                重试生成
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void handleOperateBlock('change_type', {
                                    pageId: selectedPage.id,
                                    blockId: block.id,
                                    blockType: 'text',
                                  })
                                }
                                disabled={operatingBlockId === block.id}
                                className="text-rose-600 hover:text-rose-700 hover:bg-rose-100 text-xs h-8"
                              >
                                <Replace className="h-3 w-3 mr-1" />
                                转为文本块
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void handleOperateBlock('delete', {
                                    pageId: selectedPage.id,
                                    blockId: block.id,
                                  })
                                }
                                disabled={operatingBlockId === block.id}
                                className="text-gray-500 hover:text-red-600 hover:bg-red-50 text-xs h-8"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                删除
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Quiz actions */}
                    {block.type === 'quiz' && block.status === 'ready' && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 h-7 text-xs"
                          onClick={() => void handleQuizAttempt(block, true)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          答对
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 h-7 text-xs"
                          onClick={() => void handleQuizAttempt(block, false)}
                        >
                          <Circle className="h-3.5 w-3.5 mr-1" />
                          答错
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}

              {selectedPage.blocks.length === 0 && (
                <div className="text-center py-16">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 mx-auto mb-4">
                    <Layers className="h-8 w-8 text-gray-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">此页面暂无内容块</p>
                  <p className="text-xs text-gray-400 mt-1.5 max-w-[240px] mx-auto">
                    点击下方的「插入块」按钮添加内容，或触发编译自动生成
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCompilePage(selectedPage.id)}
                    disabled={compiling}
                    className="mt-4 rounded-full border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                  >
                    {compiling ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    )}
                    触发编译
                  </Button>
                </div>
              )}

              {/* Insert block */}
              {selectedPage.blocks.length > 0 && (
                <div className="relative flex justify-center pt-2" data-insert-menu>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInsertMenuOpen((current) => !current)}
                    disabled={operatingBlockId === `${selectedPage.id}-insert`}
                    className="rounded-full border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    插入块
                  </Button>
                  {insertMenuOpen && (
                    <div className="absolute bottom-full left-1/2 mb-2 grid w-[min(520px,calc(100vw-160px))] -translate-x-1/2 grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-xl sm:grid-cols-3">
                      {INSERTABLE_BLOCK_TYPES.map((type) => {
                        const Icon = BLOCK_TYPE_ICON[type] || FileText;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() =>
                              void handleOperateBlock('insert', {
                                pageId: selectedPage.id,
                                blockType: type,
                              })
                            }
                            className="flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{blockTypeLabel(type)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </article>
          </div>
        </div>
        {renderPageOutline()}
      </div>
    );
  }

  function renderChatPanel() {
    if (view !== 'reader' || !selectedPage) return null;

    if (!chatOpen) {
      return (
        <button
          onClick={() => setChatOpen(true)}
          className="absolute bottom-5 right-5 inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-xl hover:bg-gray-800 hover:shadow-2xl hover:scale-105 transition-all z-20"
        >
          <MessageSquare className="h-4 w-4" />
          页内问答
          {chatMessages.length > 0 && (
            <span className="flex h-5 items-center rounded-full bg-white/20 px-2 text-[11px]">
              {chatMessages.length}
            </span>
          )}
        </button>
      );
    }

    return (
      <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-gray-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900">
              <MessageSquare className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">页内问答</p>
              <p className="text-[10px] text-gray-400">基于当前页面内容追问</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {chatMessages.length > 0 && (
              <button
                onClick={() => {
                  setChatMessages([]);
                  setChatInput('');
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 transition-colors"
                title="清空对话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setChatOpen(false)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 mb-3">
                <Bot className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">开始追问</p>
              <p className="text-xs text-gray-400 mt-1 max-w-[200px] leading-relaxed">
                针对当前页面内容提问，AI 会追加 deep_dive 或补偿块
              </p>
              <div className="mt-4 space-y-2 w-full">
                {['这个概念的核心是什么？', '能给我一个具体的例子吗？', '这里和前面有什么联系？'].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setChatInput(q);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={cn(
                    'flex gap-2.5',
                    message.role === 'assistant' ? 'flex-row' : 'flex-row-reverse',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      message.role === 'assistant' ? 'bg-gray-900' : 'bg-gray-200',
                    )}
                  >
                    {message.role === 'assistant' ? (
                      <Bot className="h-3 w-3 text-white" />
                    ) : (
                      <MessageSquare className="h-3 w-3 text-gray-600" />
                    )}
                  </div>
                  <div
                    className={cn(
                      'max-w-[calc(100%-40px)] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed',
                      message.role === 'assistant'
                        ? 'bg-gray-100 rounded-tl-sm text-gray-800'
                        : 'bg-gray-900 rounded-tr-sm text-white',
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {message.streaming && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse delay-75" />
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse delay-150" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {/* Quick follow-up suggestions after last assistant message */}
              {!chatStreaming && chatMessages.length > 0 && chatMessages[chatMessages.length - 1]?.role === 'assistant' && (
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {['再详细解释一下', '举个例子', '和前面内容有什么联系？'].map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setChatInput(q);
                      }}
                      className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handlePageChat();
          }}
          className="border-t border-gray-100 p-3 bg-white"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="例如：为什么这里要先判断条件？"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handlePageChat();
                }
              }}
              className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs text-gray-900 outline-none transition-all focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
            />
            <button
              type="submit"
              disabled={chatStreaming || !chatInput.trim()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800 transition-all hover:scale-105"
            >
              {chatStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      </aside>
    );
  }

  // ── Main render ───────────────────────────────────────────────────

  if (view === 'list') {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 tracking-tight">活书引擎</h1>
            <p className="mt-1 text-sm text-gray-500">生成、浏览和学习你的 AI 互动书籍</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索书籍..."
                className="h-9 w-48 rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none transition-all focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
              />
            </div>
            <button
              onClick={() => setView('creator')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              新建活书
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Library className="h-4 w-4 text-gray-400" />
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                Total Books
              </span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{books.length}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                Ready
              </span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{readyBooksCount}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-4 w-4 text-amber-500" />
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                In Progress
              </span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">
              {
                books.filter(
                  (b) =>
                    b.status === 'compiling' || b.status === 'draft' || b.status === 'spine_ready',
                ).length
              }
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-gray-400" />
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                Chapters
              </span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{chapterCount}</p>
          </div>
        </div>

        {/* My Library */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 tracking-tight">
                我的书库
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{books.length} 本活书</p>
            </div>
            {loadingBooks && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>

          {books.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-3 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 mx-auto mb-4">
                <Library className="h-7 w-7 text-gray-300" />
              </div>
              <p className="text-sm text-gray-500 font-medium">暂无活书</p>
              <p className="text-xs text-gray-400 mt-1.5 max-w-[240px] mx-auto">
                点击右上角「新建活书」开始创建你的第一本 AI 互动书籍
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {books.map((book, index) => {
                const gradients = [
                  'from-orange-50 via-amber-50/50 to-white',
                  'from-violet-50 via-purple-50/50 to-white',
                  'from-sky-50 via-blue-50/50 to-white',
                  'from-rose-50 via-pink-50/50 to-white',
                  'from-emerald-50 via-green-50/50 to-white',
                  'from-cyan-50 via-teal-50/50 to-white',
                ];
                const gradient = gradients[index % gradients.length];
                const statusConfig = {
                  ready: {
                    dot: 'bg-emerald-500',
                    text: 'text-emerald-700',
                    label: '就绪',
                    bg: 'bg-emerald-50',
                    border: 'border-emerald-200',
                  },
                  compiling: {
                    dot: 'bg-amber-500',
                    text: 'text-amber-700',
                    label: '编译中',
                    bg: 'bg-amber-50',
                    border: 'border-amber-200',
                  },
                  draft: {
                    dot: 'bg-gray-400',
                    text: 'text-gray-600',
                    label: '草案',
                    bg: 'bg-gray-100',
                    border: 'border-gray-200',
                  },
                  spine_ready: {
                    dot: 'bg-blue-500',
                    text: 'text-blue-700',
                    label: '目录就绪',
                    bg: 'bg-blue-50',
                    border: 'border-blue-200',
                  },
                  failed: {
                    dot: 'bg-red-500',
                    text: 'text-red-700',
                    label: '失败',
                    bg: 'bg-red-50',
                    border: 'border-red-200',
                  },
                };
                const cfg = statusConfig[book.status] || statusConfig.draft;
                return (
                  <button
                    key={book.id}
                    onClick={() => setSelectedBookId(book.id)}
                    className="group relative rounded-2xl border border-gray-100 bg-white text-left transition-all duration-300 hover:shadow-xl hover:-translate-y-1 overflow-hidden"
                  >
                    {/* Gradient top */}
                    <div className={cn('h-24 bg-gradient-to-br px-5 pt-4 pb-3 relative', gradient)}>
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider',
                            cfg.bg,
                            cfg.text,
                            cfg.border,
                          )}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                          {cfg.label}
                        </span>
                        <BookOpen className="h-5 w-5 text-gray-400/50" />
                      </div>
                    </div>
                    {/* Content */}
                    <div className="p-5">
                      <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 mb-2">
                        {book.title}
                      </h3>
                      <p className="text-xs text-gray-500 line-clamp-2 mb-4 leading-relaxed">
                        {book.topic}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1.5">
                            <Layers className="h-3 w-3" />
                            <span className="font-medium text-gray-600">{book.chapterCount}</span>
                            <span>章</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <BookOpen className="h-3 w-3" />
                            <span className="font-medium text-gray-600">{book.pageCount}</span>
                            <span>页</span>
                          </span>
                        </div>
                        <span className="text-gray-400">
                          {new Date(book.updatedAt).toLocaleDateString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                    {/* Hover action */}
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-900 scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Creator / Spine / Reader views with sidebar layout
  return (
    <div className="flex h-[calc(100vh-4rem)] -m-8 bg-[#F3F2EE]">
      {renderSidebar()}

      <main className="relative flex flex-1 overflow-hidden">
        {hasProgressActivity && (
          <LiveBookProgressTimeline
            currentStage={currentStage}
            currentProgress={currentProgress}
            counters={progressState.counters as ProgressCounters}
            connectionState={progressState.connectionState}
            reconnectCount={progressState.reconnectCount}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Creator View */}
          {view === 'creator' && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mx-auto max-w-2xl space-y-6">
                <div className="space-y-1.5">
                  <h1 className="text-xl font-semibold text-gray-900">创建新活书</h1>
                  <p className="text-sm text-gray-500">
                    描述你想学习的内容，AI 将为你生成结构化互动书籍。
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="space-y-5 px-6 pb-6 pt-6">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        学习主题
                      </span>
                      <textarea
                        value={form.topic}
                        onChange={(e) => setForm((prev) => ({ ...prev, topic: e.target.value }))}
                        rows={3}
                        placeholder="例如：用推导和练习建立对Transformer注意力机制的直觉"
                        className="mt-2 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        目标水平
                      </span>
                      <input
                        value={form.targetLevel}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, targetLevel: e.target.value }))
                        }
                        placeholder="例如：初中、高中"
                        className="mt-2 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition-all focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                      />
                    </label>

                    <LiveBookSourcePicker items={sourceItems} onItemsChange={setSourceItems} />

                    <Button
                      onClick={handleCreateBook}
                      disabled={creating || !form.topic.trim()}
                      className="w-full bg-gray-900 hover:bg-gray-800 text-white h-11"
                    >
                      {creating ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      生成提案
                    </Button>
                  </div>
                </div>

                {detail?.status === 'draft' && (
                  <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <h2 className="text-base font-semibold text-gray-900">提案预览</h2>
                    <p className="text-xs text-gray-500 mt-1">确认以下内容，然后生成章节目录。</p>
                    <div className="mt-5 space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          标题
                        </p>
                        <p className="text-sm text-gray-900 mt-1.5">{detail.proposal.title}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          描述
                        </p>
                        <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
                          {detail.proposal.description}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            范围
                          </p>
                          <p className="text-sm text-gray-900 mt-1.5">{detail.proposal.scope}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            目标水平
                          </p>
                          <p className="text-sm text-gray-900 mt-1.5">
                            {detail.proposal.targetLevel}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end">
                      <Button
                        onClick={handleConfirmProposal}
                        disabled={confirming}
                        className="bg-gray-900 hover:bg-gray-800 text-white"
                      >
                        {confirming ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        )}
                        确认提案并生成目录
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Spine View */}
          {view === 'spine' && detail && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mx-auto max-w-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-xl font-semibold text-gray-900">目录编辑</h1>
                    <p className="text-sm text-gray-500 mt-1">调整章节顺序后触发编译</p>
                  </div>
                  <Button
                    onClick={() => void handlePrimaryCompile()}
                    disabled={compiling}
                    className="bg-gray-900 hover:bg-gray-800 text-white"
                  >
                    {compiling ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <Wand2 className="h-4 w-4 mr-1.5" />
                    )}
                    触发编译
                  </Button>
                </div>

                <div className="space-y-3">
                  {detail.chapters
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((chapter, index) => (
                      <div
                        key={chapter.id}
                        className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-5 py-4 hover:border-gray-200 transition-colors shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-700">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{chapter.title}</p>
                            <p className="text-xs text-gray-500">{chapter.goal}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleReorderChapter(chapter.id, 'up')}
                            disabled={index === 0}
                            className="h-7 w-7 text-gray-400 hover:text-gray-700"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleReorderChapter(chapter.id, 'down')}
                            disabled={index === detail.chapters.length - 1}
                            className="h-7 w-7 text-gray-400 hover:text-gray-700"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <Button
                    variant="outline"
                    className="border-gray-200 text-gray-600 hover:bg-gray-50"
                    onClick={() => setView('reader')}
                  >
                    <BookOpen className="h-4 w-4 mr-1.5" />
                    进入阅读器
                  </Button>
                  {detail.status === 'spine_ready' && (
                    <Button
                      onClick={() => void handleConfirmSpine()}
                      disabled={confirming}
                      className="bg-gray-900 hover:bg-gray-800 text-white"
                    >
                      {confirming ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      )}
                      确认书脊并锁定
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Reader View */}
          {view === 'reader' && detail && (
            <>
              {renderHealthBanner()}
              {renderReaderHeader()}
              {renderBlocks()}
            </>
          )}
        </div>

        {renderChatPanel()}
      </main>
    </div>
  );
}
