'use client';

import { useState } from 'react';
import { ChevronDown, GitBranch, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeachingTraceEvent } from '@/lib/types/teaching-trace';
import { useTeachingTrace } from './use-teaching-trace';

interface TeachingTracePanelProps {
  events: TeachingTraceEvent[];
  isStreaming?: boolean;
  className?: string;
}

const toneClass = {
  neutral: 'border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300',
};

function ToneIcon({ tone }: { tone: keyof typeof toneClass }) {
  if (tone === 'success') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (tone === 'warning') return <AlertTriangle className="h-3.5 w-3.5" />;
  if (tone === 'error') return <XCircle className="h-3.5 w-3.5" />;
  return <GitBranch className="h-3.5 w-3.5" />;
}

export function TeachingTracePanel({ events, isStreaming, className }: TeachingTracePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const items = useTeachingTrace(events);

  if (!items.length) return null;

  const visibleItems = expanded ? items : items.slice(-5);

  return (
    <div className={cn('mb-2 rounded-xl border border-gray-200 bg-white/80 p-2 dark:border-gray-800 dark:bg-gray-900/80', className)}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          <GitBranch className="h-3 w-3" />
        </span>
        <span className="flex-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
          系统决策轨迹
        </span>
        {isStreaming && (
          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            running
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', expanded && 'rotate-180')} />
      </button>

      <div className="mt-2 space-y-1.5">
        {visibleItems.map((item) => (
          <div key={item.id} className={cn('rounded-lg border px-2 py-1.5', toneClass[item.tone])}>
            <div className="flex items-center gap-1.5">
              <ToneIcon tone={item.tone} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{item.title}</span>
              <span className="shrink-0 text-[10px] opacity-60">{item.time}</span>
            </div>
            {item.detail && (
              <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed opacity-75">
                {item.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
