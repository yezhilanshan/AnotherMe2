'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain, Trash2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Memory {
  id: string;
  user_id: string;
  memory_type: string;
  content: string;
  source_session_id: string | null;
  importance: number;
  created_at: string | null;
}

interface MemoryPanelProps {
  userId: string;
  className?: string;
  open: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  weakness: '薄弱点',
  preference: '学习偏好',
  common_mistake: '常见错误',
  recent_focus: '近期关注',
  note: '学习笔记',
};

const TYPE_COLORS: Record<string, string> = {
  weakness: 'bg-red-50 text-red-700 border-red-200',
  preference: 'bg-blue-50 text-blue-700 border-blue-200',
  common_mistake: 'bg-amber-50 text-amber-700 border-amber-200',
  recent_focus: 'bg-green-50 text-green-700 border-green-200',
  note: 'bg-gray-50 text-gray-700 border-gray-200',
};

export function MemoryPanel({ userId, className, open, onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${userId}/memories?limit=100`);
      if (!res.ok) throw new Error('Failed to load memories');
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open && userId) {
      void fetchMemories();
    }
  }, [open, userId, fetchMemories]);

  const handleDelete = async (memoryId: string) => {
    setDeletingId(memoryId);
    try {
      const res = await fetch(`/api/students/${userId}/memories/${memoryId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    } catch {
      // Silently fail
    } finally {
      setDeletingId(null);
    }
  };

  const toggleType = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Group by type
  const grouped = memories.reduce<Record<string, Memory[]>>((acc, m) => {
    (acc[m.memory_type] ||= []).push(m);
    return acc;
  }, {});

  if (!open) return null;

  return (
    <div
      className={cn(
        'border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden flex flex-col',
        className,
      )}
      style={{ maxHeight: '50vh' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-500" />
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
            AI 学习记忆
          </span>
          <span className="text-[10px] text-gray-400">
            ({memories.length} 条)
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          关闭
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="text-xs text-red-500 text-center py-4">{error}</div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-8">
            暂无学习记忆
          </div>
        )}

        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleType(type)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {expandedTypes.has(type) ? (
                <ChevronDown className="w-3 h-3 text-gray-400" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-400" />
              )}
              <span
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border font-medium',
                  TYPE_COLORS[type] || TYPE_COLORS.note,
                )}
              >
                {TYPE_LABELS[type] || type}
              </span>
              <span className="text-[10px] text-gray-400">{items.length}</span>
            </button>

            {expandedTypes.has(type) && (
              <div className="px-3 pb-2 space-y-1.5">
                {items.map((mem) => (
                  <div
                    key={mem.id}
                    className="group flex items-start gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed break-words">
                        {mem.content}
                      </p>
                      <p className="text-[9px] text-gray-400 mt-0.5">
                        {mem.created_at ? new Date(mem.created_at).toLocaleDateString('zh-CN') : ''}
                        {mem.importance > 0 && ` · 重要度 ${mem.importance}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(mem.id)}
                      disabled={deletingId === mem.id}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-opacity"
                      title="删除此记忆"
                    >
                      {deletingId === mem.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                      ) : (
                        <Trash2 className="w-3 h-3 text-red-400" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
