'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  BookMarked,
  Brain,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  ListChecks,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/features/ai-tutor/components/markdown/MarkdownRenderer';
import {
  parseTutorResponseBlocks,
  type TutorResponseBlock,
  type TutorSemanticBlockType,
} from './tutor-response-blocks';

type CardTone = {
  icon: LucideIcon;
  label: string;
  className: string;
  iconClassName: string;
};

const CARD_TONES: Record<TutorSemanticBlockType, CardTone> = {
  hint: {
    icon: Lightbulb,
    label: '提示',
    className:
      'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-100',
    iconClassName: 'text-amber-600 dark:text-amber-300',
  },
  steps: {
    icon: ListChecks,
    label: '步骤',
    className:
      'border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100',
    iconClassName: 'text-sky-600 dark:text-sky-300',
  },
  knowledge_card: {
    icon: BookMarked,
    label: '知识点',
    className:
      'border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/25 dark:text-emerald-100',
    iconClassName: 'text-emerald-600 dark:text-emerald-300',
  },
  mistake: {
    icon: AlertTriangle,
    label: '错因',
    className:
      'border-rose-200 bg-rose-50/80 text-rose-950 dark:border-rose-800/60 dark:bg-rose-950/25 dark:text-rose-100',
    iconClassName: 'text-rose-600 dark:text-rose-300',
  },
  quiz: {
    icon: HelpCircle,
    label: '小测',
    className:
      'border-violet-200 bg-violet-50/80 text-violet-950 dark:border-violet-800/60 dark:bg-violet-950/25 dark:text-violet-100',
    iconClassName: 'text-violet-600 dark:text-violet-300',
  },
  learning_state: {
    icon: Brain,
    label: '学习状态',
    className:
      'border-slate-200 bg-slate-50/80 text-slate-950 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100',
    iconClassName: 'text-slate-600 dark:text-slate-300',
  },
};

function TutorMarkdownBlock({ content }: { content: string }) {
  return (
    <MarkdownRenderer
      content={content}
      variant="prose"
      className={cn(
        'ai-tutor-response-markdown min-w-0 max-w-full',
        'prose-sm sm:prose',
        'prose-p:my-2 prose-headings:mt-3 prose-headings:mb-2',
        'prose-ul:my-2 prose-ol:my-2 prose-li:my-1',
        'prose-pre:max-w-full prose-pre:overflow-x-auto',
        'prose-table:text-[12px] sm:prose-table:text-sm',
        '[&_a]:break-words [&_code]:break-words [&_pre_code]:break-normal',
      )}
    />
  );
}

function SemanticCard({
  block,
}: {
  block: Extract<TutorResponseBlock, { type: TutorSemanticBlockType }>;
}) {
  const tone = CARD_TONES[block.type];
  const Icon = tone.icon;
  const showTarget = block.type === 'learning_state';

  return (
    <section
      className={cn(
        'not-prose w-full min-w-0 rounded-lg border px-3 py-3 sm:px-4',
        'shadow-[0_1px_0_rgba(15,23,42,0.03)]',
        tone.className,
      )}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <Icon className={cn('h-4 w-4 shrink-0', tone.iconClassName)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold leading-tight sm:text-[13px]">
            {block.title || tone.label}
          </div>
        </div>
        {showTarget ? <Target className={cn('h-3.5 w-3.5 shrink-0', tone.iconClassName)} /> : null}
        {block.type === 'knowledge_card' ? (
          <CheckCircle2 className={cn('h-3.5 w-3.5 shrink-0', tone.iconClassName)} />
        ) : null}
      </div>
      <div className="min-w-0 text-[13px] leading-relaxed sm:text-sm">
        <MarkdownRenderer
          content={block.content}
          variant="compact"
          className={cn(
            'ai-tutor-response-markdown max-w-full',
            'prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5',
            'prose-li:my-0.5 prose-blockquote:my-2',
            '[&_a]:break-words [&_code]:break-words [&_pre_code]:break-normal',
          )}
        />
      </div>
    </section>
  );
}

export function TutorResponseRenderer({ content }: { content: string }) {
  const blocks = useMemo(() => parseTutorResponseBlocks(content), [content]);

  if (blocks.length === 0) return null;

  return (
    <div className="ai-tutor-response flex w-full min-w-0 flex-col gap-3">
      {blocks.map((block, index) => {
        if (block.type === 'markdown') {
          return <TutorMarkdownBlock key={`${block.type}-${index}`} content={block.content} />;
        }

        return <SemanticCard key={`${block.type}-${index}`} block={block} />;
      })}
    </div>
  );
}
