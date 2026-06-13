'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { bookApi, openBookSocket, type BookWsEvent } from '@/lib/live-book/api';
import { useSettingsStore } from '@/lib/store/settings';
import {
  emptyBookProgress,
  progressIsComplete,
  progressHasActivity,
  reduceBookEvent,
} from '@/lib/live-book/progress';
import type {
  Block,
  BlockType,
  Book,
  BookDetail,
  BookProposal,
  Page,
  Spine,
} from '@/lib/live-book/types';

import BookLibrary from '@/features/live-book/components/BookLibrary';
import BookCreator from '@/features/live-book/components/BookCreator';
import BookSidebar from '@/features/live-book/components/BookSidebar';
import SpineEditor from '@/features/live-book/components/SpineEditor';
import PageReader from '@/features/live-book/components/PageReader';
import MobileBookNav from '@/features/live-book/components/MobileBookNav';

import BookProgressTimeline from '@/features/live-book/components/BookProgressTimeline';
import BookHealthBanner from '@/features/live-book/components/BookHealthBanner';

type View = 'list' | 'creator' | 'spine' | 'reader';

export default function LiveBookPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [view, setView] = useState<View>('list');

  // LLM provider config from global settings
  const llmProviderId = useSettingsStore((s) => s.providerId);
  const llmModelId = useSettingsStore((s) => s.modelId);
  const llmProvidersConfig = useSettingsStore((s) => s.providersConfig);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [confirmingProposal, setConfirmingProposal] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<BookProposal | null>(null);
  const [pendingBook, setPendingBook] = useState<Book | null>(null);

  const [confirmingSpine, setConfirmingSpine] = useState(false);
  const [compilingPageId, setCompilingPageId] = useState<string | null>(null);

  const [pendingDeepDiveTopic, setPendingDeepDiveTopic] = useState<string | null>(null);

  const [progress, dispatchProgress] = useReducer(reduceBookEvent, null, emptyBookProgress);

  // ── Data loaders ───────────────────────────────────────────────────

  const refreshBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const data = await bookApi.list();
      setBooks(data.books);
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  const loadBookDetail = useCallback(async (id: string) => {
    const data = await bookApi.get(id);
    setDetail(data);
    return data;
  }, []);

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  // ── WebSocket subscription ─────────────────────────────────────────

  useEffect(() => {
    if (!selectedBookId) return;
    let active = true;
    let socket: WebSocket | null = null;

    void (async () => {
      try {
        const s = await openBookSocket((event: BookWsEvent) => {
          if (!active) return;
          dispatchProgress(event);
          const meta = (event.metadata as Record<string, unknown> | undefined) || {};
          const kind = String((event.content as string) || (meta.kind as string) || '');
          if (
            kind === 'block_ready' ||
            kind === 'block_error' ||
            kind === 'page_compiled' ||
            kind === 'page_planned' ||
            kind === 'spine_ready'
          ) {
            void loadBookDetail(selectedBookId);
          }
        });
        if (active) {
          socket = s;
        } else {
          s.close();
        }
      } catch {
        // ignore connection errors
      }
    })();

    return () => {
      active = false;
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    };
  }, [selectedBookId, loadBookDetail]);

  // ── Selectors ──────────────────────────────────────────────────────

  const selectedPage: Page | null = useMemo(() => {
    if (!detail || !selectedPageId) return null;
    return detail.pages.find((p) => p.id === selectedPageId) || null;
  }, [detail, selectedPageId]);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleNewBook = () => {
    setSelectedBookId(null);
    setDetail(null);
    setPendingBook(null);
    setPendingProposal(null);
    setSelectedPageId(null);
    setView('creator');
  };

  const lastDeepLinkedBookId = useRef<string | null>(null);

  const handleSelectBook = useCallback(
    async (id: string | null) => {
      if (!id) {
        setSelectedBookId(null);
        setDetail(null);
        setView('list');
        return;
      }
      setSelectedBookId(id);
      const data = await loadBookDetail(id);
      if (data.book.status === 'draft' && data.book.proposal) {
        setPendingBook(data.book);
        setPendingProposal(data.book.proposal);
        setView('creator');
      } else if (data.book.status === 'spine_ready' && data.spine) {
        setView('spine');
      } else {
        const firstReady = data.pages.find((p) => p.status === 'ready');
        const firstAny = data.pages[0] || null;
        setSelectedPageId((firstReady || firstAny)?.id || null);
        setView('reader');
      }
    },
    [loadBookDetail],
  );

  // Deep-linking via ?book=<id>
  const searchParams = useSearchParams();
  const requestedBookId = searchParams?.get('book') || null;
  useEffect(() => {
    if (!requestedBookId || requestedBookId === selectedBookId) return;
    if (requestedBookId === lastDeepLinkedBookId.current) return;
    lastDeepLinkedBookId.current = requestedBookId;
    void handleSelectBook(requestedBookId);
  }, [requestedBookId, selectedBookId, handleSelectBook]);

  const handleDeleteBook = async (id: string) => {
    if (!confirm('Delete this book? This cannot be undone.')) return;
    await bookApi.delete(id);
    if (selectedBookId === id) {
      setSelectedBookId(null);
      setDetail(null);
      setView('list');
    }
    await refreshBooks();
  };

  const handleCreate = async (payload: {
    topic: string;
    chat_session_id: string;
    chat_selections: Array<{ session_id: string; message_ids: number[] }>;
    knowledge_bases: string[];
    notebook_refs: Array<Record<string, unknown>>;
    question_categories: number[];
    question_entries: number[];
    language: string;
  }) => {
    const providerCfg = llmProvidersConfig[llmProviderId];
    setCreating(true);
    try {
      const result = await bookApi.create({
        ...payload,
        providerConfig: {
          apiKey: providerCfg?.apiKey || undefined,
          model: llmModelId ? `${llmProviderId}:${llmModelId}` : undefined,
          baseUrl: providerCfg?.baseUrl || undefined,
        },
      });
      setPendingBook(result.book);
      setPendingProposal(result.proposal);
      setSelectedBookId(result.book.id);
      await refreshBooks();
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmProposal = async (edited: BookProposal) => {
    if (!pendingBook) return;
    setConfirmingProposal(true);
    try {
      const result = await bookApi.confirmProposal(pendingBook.id, edited);
      setPendingBook(result.book);
      setPendingProposal(null);
      await loadBookDetail(result.book.id);
      setView('spine');
      await refreshBooks();
    } finally {
      setConfirmingProposal(false);
    }
  };

  const handleConfirmSpine = async (spine: Spine) => {
    if (!detail) return;
    setConfirmingSpine(true);
    try {
      await bookApi.confirmSpine(detail.book.id, spine, true);
      const refreshed = await loadBookDetail(detail.book.id);
      const firstPage = refreshed.pages[0] || null;
      setSelectedPageId(firstPage?.id || null);
      setView('reader');
      if (firstPage) {
        void compilePage(firstPage.id);
      }
      await refreshBooks();
    } finally {
      setConfirmingSpine(false);
    }
  };

  const compilePage = useCallback(
    async (pageId: string, force = false) => {
      if (!selectedBookId) return;
      setCompilingPageId(pageId);
      try {
        await bookApi.compilePage(selectedBookId, pageId, force);
      } finally {
        setCompilingPageId((current) => (current === pageId ? null : current));
        await loadBookDetail(selectedBookId);
      }
    },
    [selectedBookId, loadBookDetail],
  );

  const handleSelectPage = (pageId: string) => {
    setSelectedPageId(pageId);
    if (!detail) return;
    const page = detail.pages.find((p) => p.id === pageId);
    if (page && page.status !== 'ready' && page.status !== 'generating') {
      void compilePage(pageId);
    }
  };

  const handleRegenerateBlock = async (block: Block) => {
    if (!detail || !selectedPage) return;
    await bookApi.regenerateBlock(detail.book.id, selectedPage.id, block.id);
    await loadBookDetail(detail.book.id);
  };

  const handleDeleteBlock = async (block: Block) => {
    if (!detail || !selectedPage) return;
    if (!confirm(`Delete this ${block.type} block?`)) return;
    await bookApi.deleteBlock(detail.book.id, selectedPage.id, block.id);
    await loadBookDetail(detail.book.id);
  };

  const handleMoveBlock = async (block: Block, direction: 'up' | 'down') => {
    if (!detail || !selectedPage) return;
    const idx = selectedPage.blocks.findIndex((b) => b.id === block.id);
    if (idx < 0) return;
    const newPos = direction === 'up' ? idx - 1 : idx + 1;
    if (newPos < 0 || newPos >= selectedPage.blocks.length) return;
    await bookApi.moveBlock(detail.book.id, selectedPage.id, block.id, newPos);
    await loadBookDetail(detail.book.id);
  };

  const handleChangeBlockType = async (block: Block, newType: BlockType) => {
    if (!detail || !selectedPage) return;
    await bookApi.changeBlockType({
      book_id: detail.book.id,
      page_id: selectedPage.id,
      block_id: block.id,
      new_type: newType,
    });
    await loadBookDetail(detail.book.id);
  };

  const handleInsertBlock = async (block_type: BlockType) => {
    if (!detail || !selectedPage) return;
    await bookApi.insertBlock({
      book_id: detail.book.id,
      page_id: selectedPage.id,
      block_type,
    });
    await loadBookDetail(detail.book.id);
  };

  const handleDeepDive = async (topic: string, blockId: string) => {
    if (!detail || !selectedPage) return;
    setPendingDeepDiveTopic(topic);
    try {
      const result = await bookApi.deepDive({
        book_id: detail.book.id,
        parent_page_id: selectedPage.id,
        topic,
        block_id: blockId,
      });
      const refreshed = await loadBookDetail(detail.book.id);
      const newPage = refreshed.pages.find((p) => p.id === result.page.id);
      if (newPage) {
        setSelectedPageId(newPage.id);
      }
    } finally {
      setPendingDeepDiveTopic(null);
    }
  };

  const handleQuizAttempt = async (
    block: Block,
    args: { questionId?: string; userAnswer?: string; isCorrect: boolean },
  ) => {
    if (!detail || !selectedPage) return;
    await bookApi.recordQuizAttempt({
      book_id: detail.book.id,
      page_id: selectedPage.id,
      block_id: block.id,
      question_id: args.questionId,
      user_answer: args.userAnswer,
      is_correct: args.isCorrect,
    });
    if (!args.isCorrect) {
      const topic =
        (block.params?.topic as string | undefined) || selectedPage.title || 'this topic';
      try {
        await bookApi.supplement(detail.book.id, selectedPage.id, topic);
      } catch {
        // best-effort
      }
      await loadBookDetail(detail.book.id);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex h-mobile-app w-full md:h-[calc(var(--app-dvh)-4rem)]">
      {view !== 'list' && (
        <BookSidebar
          book={detail?.book || pendingBook || null}
          onBackToLibrary={() => void handleSelectBook(null)}
          pages={detail?.pages || []}
          selectedPageId={selectedPageId}
          onSelectPage={handleSelectPage}
          className="hidden md:flex"
        />
      )}

      <main className="relative flex flex-1 overflow-hidden bg-[var(--background)]">
        {progressHasActivity(progress) && !progressIsComplete(progress) && (
          <div className="pointer-events-none absolute right-3 top-3 z-30">
            <BookProgressTimeline progress={progress} mini />
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {view !== 'list' && (
            <MobileBookNav
              book={detail?.book || pendingBook || null}
              pages={detail?.pages || []}
              selectedPageId={selectedPageId}
              onBackToLibrary={() => void handleSelectBook(null)}
              onSelectPage={handleSelectPage}
            />
          )}

          {view === 'list' && (
            <BookLibrary
              books={books}
              loading={loadingBooks}
              onNewBook={handleNewBook}
              onSelectBook={(id) => void handleSelectBook(id)}
              onDeleteBook={(id) => void handleDeleteBook(id)}
            />
          )}

          {view === 'creator' && (
            <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
              {(confirmingProposal || progressHasActivity(progress)) && (
                <div className="mx-auto mt-4 max-w-4xl px-4">
                  <BookProgressTimeline progress={progress} />
                </div>
              )}
              <BookCreator
                onCreate={handleCreate}
                loading={creating}
                proposal={pendingProposal}
                onConfirmProposal={handleConfirmProposal}
                confirmLoading={confirmingProposal}
              />
            </div>
          )}

          {view === 'spine' && detail?.spine && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <SpineEditor
                  spine={detail.spine}
                  onConfirm={handleConfirmSpine}
                  loading={confirmingSpine}
                />
              </div>
            </div>
          )}

          {view === 'reader' && (
            <>
              <BookHealthBanner
                bookId={selectedBookId}
                refreshKey={detail?.book.updated_at}
                onRecompile={(pageId) => {
                  setSelectedPageId(pageId);
                  void compilePage(pageId, true);
                }}
              />
              <PageReader
                page={selectedPage}
                bookId={detail?.book.id}
                bookLanguage={detail?.book.language}
                loading={!!compilingPageId && compilingPageId === selectedPage?.id}
                onRegenerateBlock={(block) => void handleRegenerateBlock(block)}
                onDeleteBlock={(block) => void handleDeleteBlock(block)}
                onMoveBlock={(block, dir) => void handleMoveBlock(block, dir)}
                onChangeBlockType={(block, t) => void handleChangeBlockType(block, t)}
                onInsertBlock={(t) => handleInsertBlock(t)}
                onDeepDive={(topic, blockId) => handleDeepDive(topic, blockId)}
                onNavigateToPage={handleSelectPage}
                onQuizAttempt={(block, args) => void handleQuizAttempt(block, args)}
                pendingDeepDiveTopic={pendingDeepDiveTopic}
                onRecompile={
                  selectedPage ? () => void compilePage(selectedPage.id, true) : undefined
                }
              />
            </>
          )}

          {view === 'spine' && !detail?.spine && (
            <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading spine…
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
