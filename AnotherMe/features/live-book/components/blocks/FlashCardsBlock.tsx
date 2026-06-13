"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { Block } from "@/lib/live-book/types";

interface Card {
  front?: string;
  back?: string;
  hint?: string;
}

export interface FlashCardsBlockProps {
  block: Block;
}

export default function FlashCardsBlock({ block }: FlashCardsBlockProps) {
  const cards = (block.payload?.cards as Card[] | undefined) || [];
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  if (cards.length === 0) return null;
  const card = cards[Math.min(idx, cards.length - 1)] || {};

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">
          Flash Cards
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          {idx + 1} / {cards.length}
        </span>
      </div>
      <button
        onClick={() => setShowBack((v) => !v)}
        className="mt-3 flex min-h-[10rem] w-full flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-6 text-center transition hover:border-[var(--primary)]/40 active:bg-[var(--muted)] md:px-6"
      >
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {showBack ? "Answer" : "Question"}
        </span>
        <span className="text-base font-medium text-[var(--foreground)]">
          {showBack ? card.back : card.front}
        </span>
        {!showBack && card.hint && (
          <span className="text-xs italic text-[var(--muted-foreground)]">
            Hint: {card.hint}
          </span>
        )}
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => {
            setShowBack(false);
            setIdx((i) => Math.max(0, i - 1));
          }}
          disabled={idx === 0}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs font-medium disabled:opacity-30 active:bg-[var(--muted)]"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <button
          onClick={() => setShowBack((v) => !v)}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs font-medium active:bg-[var(--muted)] hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
        >
          <RotateCcw className="h-4 w-4" /> Flip
        </button>
        <button
          onClick={() => {
            setShowBack(false);
            setIdx((i) => Math.min(cards.length - 1, i + 1));
          }}
          disabled={idx >= cards.length - 1}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs font-medium disabled:opacity-30 active:bg-[var(--muted)]"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
