'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import type { BookProposal } from '@/lib/live-book/types';

export interface BookCreatorProps {
  onCreate: (payload: {
    topic: string;
    chat_session_id: string;
    chat_selections: Array<{ session_id: string; message_ids: number[] }>;
    knowledge_bases: string[];
    notebook_refs: Array<Record<string, unknown>>;
    question_categories: number[];
    question_entries: number[];
    language: string;
  }) => Promise<void> | void;
  loading?: boolean;
  proposal?: BookProposal | null;
  onConfirmProposal?: (proposal: BookProposal) => Promise<void> | void;
  confirmLoading?: boolean;
}

export default function BookCreator({
  onCreate,
  loading = false,
  proposal,
  onConfirmProposal,
  confirmLoading = false,
}: BookCreatorProps) {
  const [intent, setIntent] = useState('');
  const [language, setLanguage] = useState('zh');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editScope, setEditScope] = useState('');
  const [editLevel, setEditLevel] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [proposalExpanded, setProposalExpanded] = useState(true);

  const hasProposal = !!proposal;

  const handleCreate = async () => {
    if (!intent.trim()) return;
    await onCreate({
      topic: intent.trim(),
      chat_session_id: '',
      chat_selections: [],
      knowledge_bases: [],
      notebook_refs: [],
      question_categories: [],
      question_entries: [],
      language,
    });
  };

  const handleConfirm = async () => {
    if (!proposal || !onConfirmProposal) return;
    const edited: BookProposal = {
      title: editTitle || proposal.title,
      description: editDescription || proposal.description,
      scope: editScope || proposal.scope,
      target_level: editLevel || proposal.target_level,
      estimated_chapters: proposal.estimated_chapters,
      rationale: proposal.rationale,
    };
    await onConfirmProposal(edited);
  };

  const toggleEdit = () => {
    if (!isEditing && proposal) {
      setEditTitle(proposal.title);
      setEditDescription(proposal.description);
      setEditScope(proposal.scope);
      setEditLevel(proposal.target_level);
    }
    setIsEditing((v) => !v);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">创建新活书</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          描述你想学习的内容，AI 将为你生成结构化互动书籍。
        </p>
      </div>

      {/* Create form */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        <div className="space-y-5 px-4 pb-4 pt-4 md:px-6 md:pb-6 md:pt-6">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              学习主题
            </span>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
              placeholder="例如：用推导和练习建立对Transformer注意力机制的直觉"
              className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm outline-none transition-all focus:border-[var(--primary)]/40 focus:ring-2 focus:ring-[var(--primary)]/10"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              语言
            </span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>

          <button
            onClick={handleCreate}
            disabled={loading || !intent.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            生成提案
          </button>
        </div>
      </div>

      {/* Proposal review */}
      {hasProposal && proposal && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 md:p-6 shadow-sm">
          <button
            onClick={() => setProposalExpanded((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">提案预览</h2>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                确认以下内容，然后生成章节目录。
              </p>
            </div>
            {proposalExpanded ? (
              <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
          </button>

          {proposalExpanded && (
            <>
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    标题
                  </p>
                  {isEditing ? (
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm"
                    />
                  ) : (
                    <p className="text-sm text-[var(--foreground)] mt-1.5">{proposal.title}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    描述
                  </p>
                  {isEditing ? (
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={2}
                      className="mt-1.5 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
                    />
                  ) : (
                    <p className="text-sm text-[var(--muted-foreground)] mt-1.5 leading-relaxed">
                      {proposal.description}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      范围
                    </p>
                    {isEditing ? (
                      <input
                        value={editScope}
                        onChange={(e) => setEditScope(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <p className="text-sm text-[var(--foreground)] mt-1.5">{proposal.scope}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      目标水平
                    </p>
                    {isEditing ? (
                      <input
                        value={editLevel}
                        onChange={(e) => setEditLevel(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <p className="text-sm text-[var(--foreground)] mt-1.5">
                        {proposal.target_level}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  onClick={toggleEdit}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] active:bg-[var(--muted)] hover:bg-[var(--background)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {isEditing ? '取消编辑' : '编辑提案'}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirmLoading}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] active:opacity-80 hover:opacity-90 disabled:opacity-50"
                >
                  {confirmLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  确认并生成目录
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
