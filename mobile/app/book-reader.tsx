import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { api, formatLiveBookError, liveBookApi } from '../lib/api';
import { USER_ID } from '../lib/config';
import { getSafeStorage } from '../lib/safeStorage';
import type { BookPage, Block } from '../lib/types';

interface BookProgressState {
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageIndex: number;
  totalPages: number;
  completedPageIds: string[];
  quizAnswers: Record<string, string>;
  quizResults: Record<string, boolean>;
  updatedAt: number;
}

const PROGRESS_PREFIX = '@anotherme/live-book/progress/';

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

function normalizeQuizQuestions(block: Block) {
  const payloadQuestions = Array.isArray(block.payload?.questions) ? block.payload.questions : [];
  if (payloadQuestions.length > 0) {
    return payloadQuestions.map(rawQuestion => {
      const question = asRecord(rawQuestion);
      const rawOptions = question.options;
      const options = Array.isArray(rawOptions)
        ? rawOptions.map(String)
        : Object.entries(asRecord(rawOptions)).map(([key, value]) => `${key.toUpperCase()}. ${String(value)}`);
      const correctAnswer = stringValue(question.correct_answer);
      return {
        question_id: stringValue(question.question_id),
        question: stringValue(question.question),
        options,
        correct_answer: correctAnswer,
        explanation: stringValue(question.explanation),
      };
    });
  }

  try {
    const parsed = JSON.parse(block.content);
    return [parsed as {
      question_id?: string;
      question?: string;
      options?: string[];
      correct_answer?: string;
      explanation?: string;
    }];
  } catch {
    return [];
  }
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

export default function BookReaderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bookId } = useLocalSearchParams<{ bookId: string }>();

  const [loading, setLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState('加载中...');
  const [error, setError] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('');
  const [pages, setPages] = useState<BookPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [completedPageIds, setCompletedPageIds] = useState<Record<string, boolean>>({});

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResults, setQuizResults] = useState<Record<string, boolean>>({});

  const loadBook = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    setLoadingLabel('加载书籍...');
    try {
      let raw = await liveBookApi.getBook(bookId) as RawRecord;
      let parsedDetail = parseBookDetail(raw);
      const rawBook = asRecord(raw.book);

      if (parsedDetail.status === 'draft') {
        setLoadingLabel('确认活书提案...');
        await liveBookApi.confirmProposal({
          book_id: bookId,
          proposal: asRecord(rawBook.proposal),
        });
        raw = await liveBookApi.getBook(bookId) as RawRecord;
        parsedDetail = parseBookDetail(raw);
      }

      if (parsedDetail.status === 'spine_ready' || parsedDetail.pages.length === 0) {
        setLoadingLabel('生成页面目录...');
        const spine = asRecord(raw.spine);
        if (Object.keys(spine).length > 0) {
          await liveBookApi.confirmSpine({
            book_id: bookId,
            spine,
            auto_compile: false,
          });
          raw = await liveBookApi.getBook(bookId) as RawRecord;
          parsedDetail = parseBookDetail(raw);
        }
      }

      const firstPageNeedingCompile = parsedDetail.pages.find(page =>
        page.status !== 'ready' || page.blocks.length === 0,
      );
      if (firstPageNeedingCompile) {
        setLoadingLabel('生成当前页内容...');
        await liveBookApi.compilePage({
          book_id: bookId,
          page_id: firstPageNeedingCompile.id,
          force: false,
        });
        raw = await liveBookApi.getBook(bookId) as RawRecord;
        parsedDetail = parseBookDetail(raw);
      }

      const parsed = parsedDetail.pages;
      setBookTitle(parsedDetail.title);
      setPages(parsed);
      const AS = getSafeStorage();
      if (bookId) {
        const rawProgress = await AS.getItem(`${PROGRESS_PREFIX}${bookId}`);
        if (rawProgress) {
          const progress = JSON.parse(rawProgress) as BookProgressState;
          const safeIndex = Math.min(Math.max(progress.pageIndex || 0, 0), Math.max(parsed.length - 1, 0));
          setCurrentPageIndex(safeIndex);
          setCompletedPageIds(
            Object.fromEntries((progress.completedPageIds || []).map(pageId => [pageId, true])),
          );
          setQuizAnswers(progress.quizAnswers || {});
          setQuizResults(progress.quizResults || {});
        }
      }
      setError(null);
    } catch (err) {
      setError(formatLiveBookError(err, '加载书籍失败'));
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    loadBook();
  }, [loadBook]);

  const currentPage = pages[currentPageIndex];
  const completedCount = Object.keys(completedPageIds).length;
  const progressPercent = pages.length > 0 ? Math.round((completedCount / pages.length) * 100) : 0;

  const persistProgress = useCallback(async (nextCompletedPageIds = completedPageIds) => {
    if (!bookId || !currentPage) return;
    const AS = getSafeStorage();

    const payload: BookProgressState = {
      bookId,
      bookTitle,
      pageId: currentPage.id,
      pageIndex: currentPageIndex,
      totalPages: pages.length,
      completedPageIds: Object.keys(nextCompletedPageIds),
      quizAnswers,
      quizResults,
      updatedAt: Date.now(),
    };
    await AS.setItem(`${PROGRESS_PREFIX}${bookId}`, JSON.stringify(payload));
  }, [bookId, bookTitle, completedPageIds, currentPage, currentPageIndex, pages.length, quizAnswers, quizResults]);

  useEffect(() => {
    if (!bookId || !currentPage || loading) return;
    let cancelled = false;

    const recordPageRead = async () => {
      const nextCompleted = { ...completedPageIds, [currentPage.id]: true };
      setCompletedPageIds(nextCompleted);
      await persistProgress(nextCompleted);

      if (!completedPageIds[currentPage.id]) {
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
  }, [bookId, bookTitle, currentPage?.id, currentPageIndex, loading]);

  useEffect(() => {
    persistProgress().catch(() => {});
  }, [quizAnswers, quizResults, persistProgress]);

  const handleQuizSubmit = async (
    block: Block,
    questionKey: string,
    content: {
      question_id?: string;
      question?: string;
      options?: string[];
      correct_answer?: string;
      explanation?: string;
    },
  ) => {
    try {
      const answer = quizAnswers[questionKey];
      if (!answer) return;

      const isCorrect = answer === content.correct_answer;
      setQuizResults(prev => ({ ...prev, [questionKey]: isCorrect }));

      await liveBookApi.quizAttempt({
        book_id: bookId!,
        page_id: currentPage.id,
        block_id: block.id,
        question_id: content.question_id || questionKey,
        user_answer: answer,
        is_correct: isCorrect,
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
          question_id: content.question_id || questionKey,
          user_answer: answer,
          is_correct: isCorrect,
        },
        weight: isCorrect ? 1 : 0.5,
      }).catch(() => {});
    } catch {
      // Quiz attempt recorded locally even if API fails
    }
  };

  const renderBlock = (block: Block) => {
    if (block.status === 'pending' || block.status === 'generating') {
      return (
        <View key={block.id} style={styles.placeholderBlock}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.placeholderText}>正在生成 {block.title || block.type}...</Text>
        </View>
      );
    }

    if (block.status === 'error') {
      return (
        <View key={block.id} style={styles.errorBlock}>
          <Ionicons name="warning-outline" size={18} color="#FF3B30" />
          <View style={{ flex: 1 }}>
            <Text style={styles.errorBlockTitle}>内容生成失败</Text>
            <Text style={styles.errorBlockText}>{block.error || '请稍后重新打开或在 Web 端重试生成。'}</Text>
          </View>
        </View>
      );
    }

    const bridgeText = block.bridge_text?.trim();
    const withBridge = (node: React.ReactNode) => (
      <View key={block.id}>
        {bridgeText ? (
          <Text style={styles.bridgeText}>{bridgeText}</Text>
        ) : null}
        {node}
      </View>
    );

    switch (block.type) {
      case 'text':
      case 'section':
        return withBridge(
          <View style={styles.textBlock}>
            {block.title ? <Text style={styles.blockTitle}>{block.title}</Text> : null}
            <Text style={styles.textContent}>{block.content}</Text>
          </View>,
        );

      case 'callout':
        return withBridge(
          <View style={styles.calloutBlock}>
            <Ionicons name="information-circle" size={18} color="#FF9500" />
            <Text style={styles.calloutText}>{block.content}</Text>
          </View>,
        );

      case 'code':
        return withBridge(
          <View style={styles.codeBlock}>
            {block.title ? <Text style={styles.codeTitle}>{block.title}</Text> : null}
            <Text style={styles.codeText}>{block.content}</Text>
          </View>,
        );

      case 'timeline':
        return withBridge(
          <View style={styles.timelineBlock}>
            {block.content.split(/\n{2,}/).filter(Boolean).map((item, index) => (
              <View key={index} style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <Text style={styles.timelineText}>{item}</Text>
              </View>
            ))}
          </View>,
        );

      case 'flash_cards':
      case 'concept_graph':
      case 'deep_dive':
      case 'figure':
      case 'interactive':
      case 'animation':
      case 'user_note':
        return withBridge(
          <View style={styles.textBlock}>
            {block.title ? <Text style={styles.blockTitle}>{block.title}</Text> : null}
            <Text style={styles.textContent}>{block.content || `[${block.type}]`}</Text>
          </View>,
        );

      case 'quiz': {
        const questions = normalizeQuizQuestions(block);
        if (questions.length === 0) {
          return (
            <View key={block.id} style={styles.quizBlock}>
              <Text style={styles.quizError}>暂无练习题</Text>
            </View>
          );
        }

        return withBridge(
          <View style={styles.quizBlock}>
            {questions.map((quizData, questionIndex) => {
              const questionKey = `${block.id}:${quizData.question_id || questionIndex}`;
              const options = quizData.options || [];
              const selected = quizAnswers[questionKey];
              const result = quizResults[questionKey];
              return (
                <View key={questionKey} style={questionIndex > 0 ? styles.quizQuestionGroup : undefined}>
                  <Text style={styles.quizQuestion}>{quizData.question || ''}</Text>
                  {options.map((opt, i) => {
                    const isSelected = selected === opt;
                    const isCorrectOpt = result !== undefined && opt === quizData.correct_answer;
                    const isWrong = result === false && isSelected;
                    return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.quizOption,
                    isSelected && styles.quizOptionSelected,
                    isCorrectOpt && styles.quizOptionCorrect,
                    isWrong && styles.quizOptionWrong,
                  ]}
                  onPress={() => {
                    if (result === undefined) {
                      setQuizAnswers(prev => ({ ...prev, [questionKey]: opt }));
                    }
                  }}
                  disabled={result !== undefined}
                >
                  <Text style={[
                    styles.quizOptionText,
                    isCorrectOpt && styles.quizOptionTextCorrect,
                    isWrong && styles.quizOptionTextWrong,
                  ]}>
                    {String.fromCharCode(65 + i)}. {opt}
                  </Text>
                </TouchableOpacity>
                    );
                  })}
                  {selected && result === undefined && (
                    <TouchableOpacity
                      style={styles.quizSubmit}
                      onPress={() => handleQuizSubmit(block, questionKey, quizData)}
                    >
                      <Text style={styles.quizSubmitText}>提交</Text>
                    </TouchableOpacity>
                  )}
                  {result !== undefined && (
                    <View style={[styles.quizResult, result ? styles.quizResultCorrect : styles.quizResultWrong]}>
                      <Text style={styles.quizResultText}>
                        {result ? '回答正确!' : `正确答案: ${quizData.correct_answer}`}
                      </Text>
                      {quizData.explanation ? (
                        <Text style={styles.quizExplanation}>{quizData.explanation}</Text>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </View>,
        );
      }

      default:
        return withBridge(
          <View style={styles.placeholderBlock}>
            <Ionicons name="document-outline" size={16} color="#999" />
            <Text style={styles.placeholderText}>{block.content || `[${block.type}] block`}</Text>
          </View>,
        );
    }
  };

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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{bookTitle}</Text>
          {currentPage && (
            <Text style={styles.headerSub}>
              {currentPage.title || `第 ${currentPageIndex + 1} 页`} · {progressPercent}%
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => setSidebarVisible(!sidebarVisible)} style={styles.menuButton}>
          <Ionicons name="list" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Sidebar (page list) */}
      {sidebarVisible && (
        <View style={styles.sidebar}>
          <ScrollView>
            {pages.map((page, i) => (
              <TouchableOpacity
                key={page.id}
                style={[styles.sidebarItem, i === currentPageIndex && styles.sidebarItemActive]}
                onPress={() => {
                  setCurrentPageIndex(i);
                  setSidebarVisible(false);
                }}
              >
                <Text
                  style={[styles.sidebarText, i === currentPageIndex && styles.sidebarTextActive]}
                  numberOfLines={1}
                >
                  {page.title || `第 ${i + 1} 页`}
                </Text>
                {completedPageIds[page.id] && (
                  <Ionicons name="checkmark-circle" size={14} color="#34C759" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Content */}
      {currentPage ? (
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressText}>阅读进度</Text>
              <Text style={styles.progressText}>{completedCount} / {pages.length}</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>
          {currentPage.blocks.map(renderBlock)}
        </ScrollView>
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
            onPress={() => setCurrentPageIndex(prev => Math.max(0, prev - 1))}
            disabled={currentPageIndex === 0}
          >
            <Ionicons name="chevron-back" size={20} color={currentPageIndex === 0 ? '#CCC' : '#007AFF'} />
            <Text style={[styles.navText, currentPageIndex === 0 && styles.navTextDisabled]}>上一页</Text>
          </TouchableOpacity>
          <Text style={styles.navPage}>{currentPageIndex + 1} / {pages.length}</Text>
          <TouchableOpacity
            style={[styles.navButton, currentPageIndex === pages.length - 1 && styles.navButtonDisabled]}
            onPress={() => setCurrentPageIndex(prev => Math.min(pages.length - 1, prev + 1))}
            disabled={currentPageIndex === pages.length - 1}
          >
            <Text style={[styles.navText, currentPageIndex === pages.length - 1 && styles.navTextDisabled]}>下一页</Text>
            <Ionicons name="chevron-forward" size={20} color={currentPageIndex === pages.length - 1 ? '#CCC' : '#007AFF'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#999',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
  menuButton: {
    padding: 4,
  },
  errorBanner: {
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 240,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1,
    borderLeftColor: '#E5E5E5',
    zIndex: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    paddingTop: 60,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  sidebarItemActive: {
    backgroundColor: '#F0F8FF',
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  sidebarText: {
    fontSize: 14,
    color: '#333',
  },
  sidebarTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  progressCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5E5',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  progressBar: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E5E5E5',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#007AFF',
  },
  emptyText: {
    fontSize: 15,
    color: '#999',
    marginTop: 8,
  },
  // Block styles
  textBlock: {
    marginBottom: 12,
  },
  textContent: {
    fontSize: 15,
    lineHeight: 24,
    color: '#333',
  },
  blockTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222',
    marginBottom: 8,
  },
  bridgeText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#555',
    marginBottom: 10,
  },
  calloutBlock: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
    marginBottom: 12,
    gap: 8,
  },
  calloutText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#555',
  },
  codeBlock: {
    backgroundColor: '#1E1E1E',
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
  },
  codeTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    color: '#D4D4D4',
  },
  timelineBlock: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#007AFF',
    marginTop: 6,
  },
  timelineText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
  },
  quizBlock: {
    backgroundColor: '#F8F9FA',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  quizError: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
  },
  quizQuestion: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    marginBottom: 10,
    lineHeight: 22,
  },
  quizQuestionGroup: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  quizOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
  },
  quizOptionSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  quizOptionCorrect: {
    borderColor: '#4CAF50',
    backgroundColor: '#E8F5E9',
  },
  quizOptionWrong: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFEBEE',
  },
  quizOptionText: {
    fontSize: 14,
    color: '#333',
  },
  quizOptionTextCorrect: {
    color: '#2E7D32',
    fontWeight: '500',
  },
  quizOptionTextWrong: {
    color: '#C62828',
  },
  quizSubmit: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  quizSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  quizResult: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
  },
  quizResultCorrect: {
    backgroundColor: '#E8F5E9',
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  quizResultWrong: {
    backgroundColor: '#FFEBEE',
    borderLeftWidth: 3,
    borderLeftColor: '#FF3B30',
  },
  quizResultText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  quizExplanation: {
    fontSize: 13,
    color: '#555',
    marginTop: 6,
    lineHeight: 18,
  },
  placeholderBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    marginBottom: 12,
  },
  placeholderText: {
    fontSize: 13,
    color: '#999',
    flex: 1,
  },
  errorBlock: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF2F2',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF3B30',
    marginBottom: 12,
  },
  errorBlockTitle: {
    fontSize: 14,
    color: '#C62828',
    fontWeight: '600',
  },
  errorBlockText: {
    fontSize: 13,
    color: '#C62828',
    marginTop: 2,
    lineHeight: 18,
  },
  // Navigation
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  navTextDisabled: {
    color: '#CCC',
  },
  navPage: {
    fontSize: 13,
    color: '#999',
  },
});
