"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
  ArrowUp,
  ArrowDown,
  Replace,
} from "lucide-react";
import type { Block, BlockType } from "@/lib/live-book/types";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";

import TextBlock from "./TextBlock";
import CalloutBlock from "./CalloutBlock";
import QuizBlock from "./QuizBlock";
import UserNoteBlock from "./UserNoteBlock";
import FigureBlock from "./FigureBlock";
import InteractiveBlock from "./InteractiveBlock";
import AnimationBlock from "./AnimationBlock";
import CodeBlock from "./CodeBlock";
import TimelineBlock from "./TimelineBlock";
import FlashCardsBlock from "./FlashCardsBlock";
import DeepDiveBlock from "./DeepDiveBlock";
import ConceptGraphBlock from "./ConceptGraphBlock";
import SectionBlock from "./SectionBlock";
import PlaceholderBlock from "./PlaceholderBlock";

const CHANGEABLE_TYPES: BlockType[] = [
  "text",
  "section",
  "callout",
  "quiz",
  "code",
  "timeline",
  "flash_cards",
  "figure",
  "interactive",
  "animation",
  "deep_dive",
];

export interface BlockRendererProps {
  block: Block;
  onRegenerate?: (block: Block) => void;
  onDelete?: (block: Block) => void;
  onMove?: (block: Block, direction: "up" | "down") => void;
  onChangeType?: (block: Block, newType: BlockType) => void;
  onDeepDive?: (topic: string, blockId: string) => Promise<void> | void;
  onNavigateToPage?: (pageId: string) => void;
  onQuizAttempt?: (
    block: Block,
    args: { questionId?: string; userAnswer?: string; isCorrect: boolean },
  ) => void;
  pendingDeepDiveTopic?: string | null;
  bookId?: string;
  currentPageId?: string;
  bookLanguage?: string;
}

export default function BlockRenderer({
  block,
  onRegenerate,
  onDelete,
  onMove,
  onChangeType,
  onDeepDive,
  onNavigateToPage,
  onQuizAttempt,
  pendingDeepDiveTopic,
  bookId,
  currentPageId,
  bookLanguage,
}: BlockRendererProps) {
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  if (block.status === "pending" || block.status === "generating") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Generating {block.type}…</span>
      </div>
    );
  }
  if (block.status === "error") {
    return (
      <div className="rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
        <div className="mb-1 flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          {block.type} block failed
        </div>
        <div className="text-xs opacity-80">
          {block.error || "Unknown error"}
        </div>
        {onRegenerate && (
          <button
            onClick={() => onRegenerate(block)}
            className="mt-2 inline-flex rounded-md border border-rose-400/60 bg-white/40 px-2 py-1 text-xs font-medium hover:bg-white/60 dark:bg-white/10"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  let body: React.ReactNode;
  switch (block.type) {
    case "text":
      body = <TextBlock block={block} />;
      break;
    case "section":
      body = <SectionBlock block={block} />;
      break;
    case "callout":
      body = <CalloutBlock block={block} />;
      break;
    case "quiz":
      body = <QuizBlock block={block} onAttempt={onQuizAttempt} />;
      break;
    case "user_note":
      body = <UserNoteBlock block={block} />;
      break;
    case "figure":
      body = <FigureBlock block={block} />;
      break;
    case "interactive":
      body = <InteractiveBlock block={block} />;
      break;
    case "animation":
      body = <AnimationBlock block={block} />;
      break;
    case "code":
      body = <CodeBlock block={block} />;
      break;
    case "timeline":
      body = <TimelineBlock block={block} />;
      break;
    case "flash_cards":
      body = <FlashCardsBlock block={block} />;
      break;
    case "deep_dive":
      body = (
        <DeepDiveBlock
          block={block}
          onDeepDive={onDeepDive}
          onNavigateToPage={onNavigateToPage}
          pendingTopic={pendingDeepDiveTopic}
        />
      );
      break;
    case "concept_graph":
      body = (
        <ConceptGraphBlock
          block={block}
          bookId={bookId}
          currentPageId={currentPageId}
          language={bookLanguage}
          onNavigateToPage={onNavigateToPage}
        />
      );
      break;
    default:
      body = <PlaceholderBlock block={block} />;
  }

  const hasActions = !!onRegenerate || !!onDelete || !!onMove || !!onChangeType;

  const bridgeText = String(
    (block.payload as Record<string, unknown> | undefined)?.bridge_text ?? "",
  ).trim();
  const showBridge = bridgeText.length > 0;

  return (
    <div className="group relative">
      {showBridge && (
        <div className="mb-3 text-[var(--foreground)]">
          <MarkdownRenderer content={bridgeText} variant="prose" />
        </div>
      )}
      {hasActions && (
        <>
          {/* Desktop: hover-triggered toolbar */}
          <div className="pointer-events-none absolute -top-3 right-2 z-10 hidden translate-y-1 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-1 py-0.5 text-[var(--muted-foreground)] opacity-0 shadow-sm transition group-hover:translate-y-0 group-hover:opacity-100 md:flex">
            {onMove && (
              <>
                <button
                  onClick={() => onMove(block, "up")}
                  className="pointer-events-auto rounded p-1 hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  title="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onMove(block, "down")}
                  className="pointer-events-auto rounded p-1 hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  title="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {onChangeType && (
              <div className="relative pointer-events-auto">
                <button
                  onClick={() => setShowTypeMenu((v) => !v)}
                  className="rounded p-1 hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  title="Change type"
                >
                  <Replace className="h-3.5 w-3.5" />
                </button>
                {showTypeMenu && (
                  <div className="absolute right-0 top-full mt-1 max-h-60 w-44 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
                    {CHANGEABLE_TYPES.filter((t) => t !== block.type).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setShowTypeMenu(false);
                          onChangeType(block, t);
                        }}
                        className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(block)}
                className="pointer-events-auto rounded p-1 hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                title="Regenerate"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(block)}
                className="pointer-events-auto rounded p-1 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Mobile: tap-triggered "more" button + dropdown */}
          <div className="absolute -top-1 right-1 z-10 md:hidden">
            <button
              onClick={() => setShowMobileMenu((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)]/90 text-[var(--muted-foreground)] shadow-sm backdrop-blur active:bg-[var(--muted)]"
              title="Block actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {showMobileMenu && (
              <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
                {onMove && (
                  <>
                    <button
                      onClick={() => { onMove(block, "up"); setShowMobileMenu(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-xs text-[var(--foreground)] active:bg-[var(--muted)]"
                    >
                      <ArrowUp className="h-4 w-4" /> Move up
                    </button>
                    <button
                      onClick={() => { onMove(block, "down"); setShowMobileMenu(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-xs text-[var(--foreground)] active:bg-[var(--muted)]"
                    >
                      <ArrowDown className="h-4 w-4" /> Move down
                    </button>
                  </>
                )}
                {onChangeType && (
                  <button
                    onClick={() => { setShowTypeMenu((v) => !v); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-xs text-[var(--foreground)] active:bg-[var(--muted)]"
                  >
                    <Replace className="h-4 w-4" /> Change type
                  </button>
                )}
                {onRegenerate && (
                  <button
                    onClick={() => { onRegenerate(block); setShowMobileMenu(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-xs text-[var(--foreground)] active:bg-[var(--muted)]"
                  >
                    <RefreshCw className="h-4 w-4" /> Regenerate
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => { onDelete(block); setShowMobileMenu(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-xs text-rose-600 active:bg-rose-50 dark:text-rose-400 dark:active:bg-rose-500/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                )}
                {showTypeMenu && onChangeType && (
                  <div className="border-t border-[var(--border)] pt-1 mt-1">
                    {CHANGEABLE_TYPES.filter((t) => t !== block.type).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setShowTypeMenu(false);
                          setShowMobileMenu(false);
                          onChangeType(block, t);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-xs text-[var(--foreground)] active:bg-[var(--muted)]"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {body}
    </div>
  );
}
