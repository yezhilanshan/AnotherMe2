import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { api, formatLiveBookError, liveBookApi } from '../lib/api';
import { USER_ID } from '../lib/config';
import { getSafeStorage } from '../lib/safeStorage';
import { colors } from '../lib/theme';
import type { BookPage, Block } from '../lib/types';
import { LiveBookWebView } from '../components/live-book/LiveBookWebView';
import type { QuizAttemptArgs } from '../components/live-book/blocks/QuizBlock';
import { debugLog, debugWarn, elapsedMs, nowMs } from '../lib/debug';

interface BookProgressState {
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageIndex: number;
  totalPages: number;
  completedPageIds: string[];
  updatedAt: number;
}

const PROGRESS_PREFIX = '@anotherme/live-book/progress/';
const STORAGE_TIMEOUT_MS = 3000;
const GET_BOOK_TIMEOUT_MS = 30000;
const LIVE_BOOK_MUTATION_TIMEOUT_MS = 120000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() || '';
  return typeof value === 'string' ? value.trim() : '';
}

function pageNeedsCompile(page: BookPage): boolean {
  return page.status === 'pending' || (page.status !== 'ready' && page.blocks.length === 0);
}

type RawRecord = Record<string, unknown>;
function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function joinNonEmpty(parts: Array<string | undefined>): string {
  return parts.map(part => (part || '').trim()).filter(Boolean).join('\n\n');
}

function blockTextFromPayload(type: string, payload: RawRecord, legacyContent: unknown): string {
  const direct = stringValue(payload.body)
    || stringValue(payload.content)
    || stringValue(payload.text)
    || stringValue(legacyContent);
  if (direct) return direct;

  if (type === 'section') {
    const subsections = Array.isArray(payload.subsections) ? payload.subsections : [];
    return joinNonEmpty([
      stringValue(payload.intro),
      ...subsections.map(sub => stringValue(asRecord(sub).body)),
      stringValue(payload.key_takeaway),
    ]);
  }

  if (type === 'callout') {
    return joinNonEmpty([stringValue(payload.label), stringValue(payload.body)]);
  }

  if (type === 'code') {
    return joinNonEmpty([stringValue(payload.code), stringValue(payload.explanation)]);
  }

  if (type === 'timeline') {
    const events = Array.isArray(payload.events) ? payload.events : [];
    return events.map(event => {
      const ev = asRecord(event);
      return joinNonEmpty([
        stringValue(ev.date),
        stringValue(ev.title),
        stringValue(ev.description),
      ]);
    }).filter(Boolean).join('\n\n');
  }

  if (type === 'flash_cards') {
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    return cards.map((card, index) => {
      const item = asRecord(card);
      return joinNonEmpty([
        `${index + 1}. ${stringValue(item.front)}`,
        stringValue(item.back),
        stringValue(item.hint) ? `提示：${stringValue(item.hint)}` : '',
      ]);
    }).filter(Boolean).join('\n\n');
  }

  if (type === 'concept_graph') {
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    return nodes.map(node => {
      const item = asRecord(node);
      return joinNonEmpty([stringValue(item.label), stringValue(item.description)]);
    }).filter(Boolean).join('\n\n');
  }

  return '';
}

function parseBookDetail(raw: RawRecord): { title: string; status: string; pages: BookPage[] } {
  const rawBook = asRecord(raw.book);
  const rawPages = (Array.isArray(raw.pages) ? raw.pages : []) as RawRecord[];
  const pages: BookPage[] = rawPages.map(p => ({
    id: stringValue(p.id),
    title: stringValue(p.title),
    status: stringValue(p.status, 'pending'),
    blocks: (((Array.isArray(p.blocks) ? p.blocks : []) as RawRecord[]) || []).map(b => {
      const type = stringValue(b.type, 'text');
      const payload = asRecord(b.payload);
      return {
        id: stringValue(b.id),
        type,
        title: stringValue(b.title),
        status: stringValue(b.status, 'ready'),
        content: blockTextFromPayload(type, payload, b.content),
        bridge_text: stringValue(payload.bridge_text) || stringValue(b.bridge_text) || undefined,
        payload,
        params: asRecord(b.params),
        error: stringValue(b.error),
      };
    }),
  }));
  return {
    title: stringValue(rawBook.title, 'Untitled'),
    status: stringValue(rawBook.status, 'unknown'),
    pages,
  };
}

async function readSavedProgress(bookId: string): Promise<BookProgressState | null> {
  try {
    const AS = getSafeStorage();
    const rawProgress = await withTimeout(
      AS.getItem(`${PROGRESS_PREFIX}${bookId}`),
      STORAGE_TIMEOUT_MS,
      '读取活书进度',
    );
    if (!rawProgress) return null;
    return JSON.parse(rawProgress) as BookProgressState;
  } catch (err) {
    debugWarn('book-reader', 'progress_read_failed', {
      bookId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export default function BookReaderScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ bookId?: string | string[] }>();
  const bookId = normalizeRouteParam(params.bookId);

  const [loading, setLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState('加载中...');
  const [error, setError] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('');
  const [pages, setPages] = useState<BookPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [completedPageIds, setCompletedPageIds] = useState<Record<string, boolean>>({});

  const applyBookDetail = useCallback(async (parsedDetail: ReturnType<typeof parseBookDetail>) => {
    const parsed = parsedDetail.pages;
    setBookTitle(parsedDetail.title);
    setPages(parsed);

    const firstReadableIndex = parsed.findIndex(page =>
      page.status === 'ready' && page.blocks.length > 0,
    );
    const fallbackIndex = parsed.length > 0 ? 0 : -1;
    const defaultIndex = firstReadableIndex >= 0 ? firstReadableIndex : fallbackIndex;

    const progress = await readSavedProgress(bookId);
    if (progress) {
      const safeIndex = Math.min(
        Math.max(progress.pageIndex || 0, 0),
        Math.max(parsed.length - 1, 0),
      );
      setCurrentPageIndex(safeIndex);
      setCompletedPageIds(
        Object.fromEntries((progress.completedPageIds || []).map(pageId => [pageId, true])),
      );
    } else if (defaultIndex >= 0) {
      setCurrentPageIndex(defaultIndex);
    }
  }, [bookId]);

  const compilePendingPageInBackground = useCallback(async (pageId: string) => {
    try {
      debugLog('book-reader', 'background_compile_start', { bookId, pageId });
      await withTimeout(
        liveBookApi.compilePage({
          book_id: bookId,
          page_id: pageId,
          force: false,
        }),
        LIVE_BOOK_MUTATION_TIMEOUT_MS,
        '生成当前页内容',
      );
      const raw = await withTimeout(
        liveBookApi.getBook(bookId),
        GET_BOOK_TIMEOUT_MS,
        '刷新活书详情',
      ) as RawRecord;
      await applyBookDetail(parseBookDetail(raw));
      debugLog('book-reader', 'background_compile_done', { bookId, pageId });
    } catch (err) {
      console.warn('[book-reader] background compile failed:', err);
      debugWarn('book-reader', 'background_compile_failed', {
        bookId,
        pageId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [applyBookDetail, bookId]);

  const loadBook = useCallback(async () => {
    if (!bookId) {
      setError('缺少书籍 ID，无法打开活书');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadingLabel('加载书籍...');
    setError(null);
    const startedAt = nowMs();
    debugLog('book-reader', 'load_start', { bookId });
    try {
      let raw = await withTimeout(
        liveBookApi.getBook(bookId),
        GET_BOOK_TIMEOUT_MS,
        '获取活书详情',
      ) as RawRecord;
      let parsedDetail = parseBookDetail(raw);
      const rawBook = asRecord(raw.book);
      debugLog('book-reader', 'get_book_done', {
        bookId,
        status: parsedDetail.status,
        pages: parsedDetail.pages.length,
        elapsedMs: elapsedMs(startedAt),
      });

      if (parsedDetail.status === 'draft') {
        setLoadingLabel('确认活书提案...');
        await withTimeout(
          liveBookApi.confirmProposal({
            book_id: bookId,
            proposal: asRecord(rawBook.proposal),
          }),
          LIVE_BOOK_MUTATION_TIMEOUT_MS,
          '确认活书提案',
        );
        raw = await withTimeout(
          liveBookApi.getBook(bookId),
          GET_BOOK_TIMEOUT_MS,
          '刷新活书详情',
        ) as RawRecord;
        parsedDetail = parseBookDetail(raw);
      }

      // 仅在目录已生成但还没有任何页面时确认 spine。
      // 若页面已存在（compiling/ready），重复 confirmSpine 会拖慢甚至卡住加载。
      if (parsedDetail.status === 'spine_ready' && parsedDetail.pages.length === 0) {
        setLoadingLabel('生成页面目录...');
        const spine = asRecord(raw.spine);
        if (Object.keys(spine).length > 0) {
          await withTimeout(
            liveBookApi.confirmSpine({
              book_id: bookId,
              spine,
              auto_compile: false,
            }),
            LIVE_BOOK_MUTATION_TIMEOUT_MS,
            '生成页面目录',
          );
          raw = await withTimeout(
            liveBookApi.getBook(bookId),
            GET_BOOK_TIMEOUT_MS,
            '刷新活书详情',
          ) as RawRecord;
          parsedDetail = parseBookDetail(raw);
        }
      }

      await applyBookDetail(parsedDetail);

      const firstPendingPage = parsedDetail.pages.find(page => pageNeedsCompile(page));
      if (firstPendingPage) {
        void compilePendingPageInBackground(firstPendingPage.id);
      }
      debugLog('book-reader', 'load_done', {
        bookId,
        pages: parsedDetail.pages.length,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (err) {
      debugWarn('book-reader', 'load_failed', {
        bookId,
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: elapsedMs(startedAt),
      });
      setError(formatLiveBookError(err, '加载书籍失败'));
    } finally {
      setLoading(false);
    }
  }, [applyBookDetail, bookId, compilePendingPageInBackground]);

  useEffect(() => {
    loadBook();
  }, [loadBook]);

  const currentPage = pages[currentPageIndex];
  const completedCount = Object.keys(completedPageIds).length;
  const progressPercent = pages.length > 0 ? Math.round((completedCount / pages.length) * 100) : 0;
  const sidebarWidth = Math.min(360, Math.max(280, Math.round(windowWidth * 0.86)));

  // ── 使用 ref 避免 persistProgress 依赖过多 ──
  const completedPageIdsRef = useRef(completedPageIds);
  const currentPageRef = useRef(currentPage);
  const currentPageIndexRef = useRef(currentPageIndex);
  const pagesLengthRef = useRef(pages.length);

  useEffect(() => { completedPageIdsRef.current = completedPageIds; }, [completedPageIds]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { currentPageIndexRef.current = currentPageIndex; }, [currentPageIndex]);
  useEffect(() => { pagesLengthRef.current = pages.length; }, [pages.length]);

  const persistProgress = useCallback(async (nextCompletedPageIds?: Record<string, boolean>) => {
    if (!bookId) return;
    const page = currentPageRef.current;
    if (!page) return;
    const AS = getSafeStorage();

    const payload: BookProgressState = {
      bookId,
      bookTitle,
      pageId: page.id,
      pageIndex: currentPageIndexRef.current,
      totalPages: pagesLengthRef.current,
      completedPageIds: Object.keys(nextCompletedPageIds ?? completedPageIdsRef.current),
      updatedAt: Date.now(),
    };
    await AS.setItem(`${PROGRESS_PREFIX}${bookId}`, JSON.stringify(payload));
  }, [bookId, bookTitle]);

  useEffect(() => {
    if (!bookId || !currentPage || loading) return;
    let cancelled = false;

    const recordPageRead = async () => {
      const nextCompleted = { ...completedPageIdsRef.current, [currentPage.id]: true };
      setCompletedPageIds(nextCompleted);

      // 只在首次阅读该页时记录事件
      if (!completedPageIdsRef.current[currentPage.id]) {
        await persistProgress(nextCompleted);
        try {
          await api.learningEvents.createForUser(USER_ID, {
            event_type: 'live_book_page_read',
            block_id: currentPage.id,
            knowledge_points: currentPage.title ? [currentPage.title] : undefined,
            payload: {
              book_id: bookId,
              book_title: bookTitle,
              page_id: currentPage.id,
              page_title: currentPage.title || `第 ${currentPageIndex + 1} 页`,
              page_index: currentPageIndex,
            },
            weight: 0.5,
          });
        } catch {
          // Reading progress remains local if Gateway is unavailable.
        }
      }
    };

    recordPageRead().catch(() => {
      if (!cancelled) persistProgress().catch(() => {});
    });
    return () => { cancelled = true; };
  }, [bookId, bookTitle, currentPage?.id, currentPageIndex, loading, persistProgress]);

  const handleQuizAttempt = async (block: Block, args: QuizAttemptArgs) => {
    try {
      await liveBookApi.quizAttempt({
        book_id: bookId!,
        page_id: currentPage.id,
        block_id: block.id,
        question_id: args.questionId || '',
        user_answer: args.userAnswer || '',
        is_correct: args.isCorrect,
      }).catch(() => {});
      await api.learningEvents.createForUser(USER_ID, {
        event_type: 'live_book_quiz_answered',
        block_id: block.id,
        knowledge_points: currentPage.title ? [currentPage.title] : undefined,
        payload: {
          book_id: bookId,
          book_title: bookTitle,
          page_id: currentPage.id,
          page_title: currentPage.title || `第 ${currentPageIndex + 1} 页`,
          question_id: args.questionId,
          user_answer: args.userAnswer,
          is_correct: args.isCorrect,
        },
        weight: args.isCorrect ? 1 : 0.5,
      }).catch(() => {});
    } catch {
      // Quiz attempt recorded locally even if API fails
    }
  };

  const handleSelectPage = useCallback((index: number) => {
    setCurrentPageIndex(index);
    setSidebarVisible(false);
    const page = pages[index];
    if (page && pageNeedsCompile(page)) {
      void compilePendingPageInBackground(page.id);
    }
  }, [compilePendingPageInBackground, pages]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{loadingLabel}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerIconButton}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={23} color={colors.textInverse} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{bookTitle}</Text>
          {currentPage && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {currentPage.title || `第 ${currentPageIndex + 1} 页`} · {progressPercent}%
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setSidebarVisible(!sidebarVisible)}
          style={styles.headerIconButton}
          hitSlop={8}
        >
          <Ionicons name="list" size={22} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Sidebar (page list) */}
      {sidebarVisible && (
        <>
          <TouchableOpacity
            style={styles.sidebarScrim}
            activeOpacity={1}
            onPress={() => setSidebarVisible(false)}
          />
          <View style={[styles.sidebar, { width: sidebarWidth }]}>
          <ScrollView
            contentContainerStyle={styles.sidebarContent}
            showsVerticalScrollIndicator={false}
          >
            {pages.map((page, i) => (
              <TouchableOpacity
                key={page.id}
                style={[styles.sidebarItem, i === currentPageIndex && styles.sidebarItemActive]}
                onPress={() => handleSelectPage(i)}
              >
                <Text
                  style={[styles.sidebarText, i === currentPageIndex && styles.sidebarTextActive]}
                  numberOfLines={2}
                >
                  {page.title || `第 ${i + 1} 页`}
                </Text>
                {completedPageIds[page.id] && (
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        </>
      )}

      {/* Content */}
      {currentPage ? (
        <View style={styles.content}>
          <LiveBookWebView
            bookTitle={bookTitle}
            page={currentPage}
            progress={{
              completedCount,
              totalPages: pages.length,
              progressPercent,
            }}
            bottomInset={insets.bottom + 80}
            onQuizAttempt={handleQuizAttempt}
          />
        </View>
      ) : (
        <View style={[styles.center, { flex: 1 }]}>
          <Ionicons name="document-text-outline" size={48} color="#CCC" />
          <Text style={styles.emptyText}>暂无页面内容</Text>
        </View>
      )}

      {/* Page navigation */}
      {pages.length > 1 && (
        <View style={[styles.navBar, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={[styles.navButton, currentPageIndex === 0 && styles.navButtonDisabled]}
            onPress={() => handleSelectPage(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex === 0}
          >
            <Ionicons name="chevron-back" size={20} color={currentPageIndex === 0 ? colors.textMuted : colors.primaryDark} />
            <Text style={[styles.navText, currentPageIndex === 0 && styles.navTextDisabled]}>上一页</Text>
          </TouchableOpacity>
          <Text style={styles.navPage}>{currentPageIndex + 1} / {pages.length}</Text>
          <TouchableOpacity
            style={[styles.navButton, currentPageIndex === pages.length - 1 && styles.navButtonDisabled]}
            onPress={() => handleSelectPage(Math.min(pages.length - 1, currentPageIndex + 1))}
            disabled={currentPageIndex === pages.length - 1}
          >
            <Text style={[styles.navText, currentPageIndex === pages.length - 1 && styles.navTextDisabled]}>下一页</Text>
            <Ionicons name="chevron-forward" size={20} color={currentPageIndex === pages.length - 1 ? colors.textMuted : colors.primaryDark} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  headerSub: {
    fontSize: 12,
    color: colors.textInverse,
    opacity: 0.82,
    marginTop: 1,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  errorBanner: {
    backgroundColor: colors.errorLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  sidebarScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(30, 27, 24, 0.24)',
    zIndex: 9,
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgElevated,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    zIndex: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    paddingTop: 56,
  },
  sidebarContent: {
    paddingBottom: 16,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sidebarItemActive: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  sidebarText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  sidebarTextActive: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 8,
  },
  // Navigation
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 104,
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.bgInput,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navText: {
    fontSize: 14,
    color: colors.primaryDark,
    fontWeight: '500',
  },
  navTextDisabled: {
    color: colors.textMuted,
  },
  navPage: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    minWidth: 52,
  },
});
