'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, PenLine, Plus, Trash2 } from 'lucide-react';
import {
  createCoWriterDocument,
  deleteCoWriterDocument,
  listCoWriterDocuments,
  type CoWriterDocumentSummary,
} from '@/lib/co-writer-api';
import { notifyCoWriterChanged } from '@/lib/co-writer-events';
import { CO_WRITER_SAMPLE_TEMPLATE } from './sampleTemplate';

function relativeTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '';
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return '刚刚';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

export default function CoWriterHomePage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<CoWriterDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const docs = await listCoWriterDocuments();
      setDocuments(docs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (withTemplate: boolean) => {
      if (creating) return;
      setCreating(true);
      setError('');
      try {
        const document = await createCoWriterDocument({
          content: withTemplate ? CO_WRITER_SAMPLE_TEMPLATE : '',
        });
        notifyCoWriterChanged();
        router.push(`/co-writer/${document.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setCreating(false);
      }
    },
    [creating, router],
  );

  const handleDelete = useCallback(
    async (docId: string) => {
      if (deletingId) return;
      setDeletingId(docId);
      try {
        await deleteCoWriterDocument(docId);
        setDocuments((prev) => prev.filter((doc) => doc.id !== docId));
        setPendingDeleteId(null);
        notifyCoWriterChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  const renderEmpty = () => (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--secondary)]/30 px-8 py-16 text-center">
      <PenLine size={28} className="text-[var(--muted-foreground)]/50" />
      <div>
        <p className="text-base font-medium text-[var(--foreground)]">暂无草稿</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          创建新的 Markdown 草稿开始写作。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleCreate(false)}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          新建草稿
        </button>
        <button
          type="button"
          onClick={() => handleCreate(true)}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-60"
        >
          <FileText size={14} />
          从模板创建
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-full flex-col overflow-hidden bg-[var(--background)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-3">
        <div className="flex items-center gap-3">
          <PenLine size={18} className="text-[var(--muted-foreground)]" />
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">协作写作</div>
            <div className="text-xs text-[var(--muted-foreground)]">
              管理你的 Markdown 草稿和项目。
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleCreate(true)}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-60"
          >
            <FileText size={13} />
            从模板
          </button>
          <button
            type="button"
            onClick={() => handleCreate(false)}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            新建草稿
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {error ? (
          <div className="mb-4 rounded-md border border-rose-300/30 bg-rose-50/40 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            加载草稿中…
          </div>
        ) : documents.length === 0 ? (
          renderEmpty()
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((doc) => {
              const isPendingDelete = pendingDeleteId === doc.id;
              const isDeleting = deletingId === doc.id;
              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/co-writer/${doc.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      router.push(`/co-writer/${doc.id}`);
                    }
                  }}
                  className="group relative flex h-44 cursor-pointer flex-col rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-4 transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--secondary)]/70 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--muted-foreground)]"
                      />
                      <div className="min-w-0">
                        <div
                          className="truncate text-sm font-medium text-[var(--foreground)]"
                          title={doc.title || '未命名草稿'}
                        >
                          {doc.title || '未命名草稿'}
                        </div>
                        <div className="text-[10px] text-[var(--muted-foreground)]/70">
                          更新于 {relativeTime(doc.updated_at)}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isPendingDelete) {
                          void handleDelete(doc.id);
                        } else {
                          setPendingDeleteId(doc.id);
                        }
                      }}
                      disabled={isDeleting}
                      title={isPendingDelete ? '再次点击确认删除' : '删除草稿'}
                      className={`shrink-0 rounded-md p-1 transition-colors disabled:opacity-50 ${
                        isPendingDelete
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          : 'text-[var(--muted-foreground)]/60 opacity-0 hover:bg-rose-500/10 hover:text-rose-600 group-hover:opacity-100 dark:hover:text-rose-400'
                      }`}
                    >
                      {isDeleting ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  </div>
                  <p className="mt-3 line-clamp-4 flex-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                    {doc.preview || '空草稿'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
