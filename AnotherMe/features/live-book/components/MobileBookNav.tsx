"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  List,
} from "lucide-react";
import type { Book, Page } from "@/lib/live-book/types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  planning: "Planning",
  generating: "Compiling",
  ready: "Ready",
  partial: "Partial",
  error: "Failed",
};

export interface MobileBookNavProps {
  book: Book | null;
  pages: Page[];
  selectedPageId: string | null;
  onBackToLibrary: () => void;
  onSelectPage: (id: string) => void;
}

export default function MobileBookNav({
  book,
  pages,
  selectedPageId,
  onBackToLibrary,
  onSelectPage,
}: MobileBookNavProps) {
  const [showPageList, setShowPageList] = useState(false);

  const currentIdx = pages.findIndex((p) => p.id === selectedPageId);
  const selectedPage = currentIdx >= 0 ? pages[currentIdx] : null;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < pages.length - 1;

  const goToPrev = () => {
    if (hasPrev) onSelectPage(pages[currentIdx - 1].id);
  };
  const goToNext = () => {
    if (hasNext) onSelectPage(pages[currentIdx + 1].id);
  };

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--card)]/80 px-2 py-1.5 backdrop-blur">
        <button
          onClick={onBackToLibrary}
          className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-[var(--muted-foreground)] active:bg-[var(--muted)]"
          title="Back to library"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1 px-1">
          <div
            className="truncate text-sm font-semibold text-[var(--foreground)]"
            title={book?.title || "Untitled book"}
          >
            {book?.title || "Untitled book"}
          </div>
          {selectedPage && (
            <div className="truncate text-[11px] text-[var(--muted-foreground)]">
              {selectedPage.title || "Untitled chapter"}
              {pages.length > 1 && (
                <span className="ml-1 opacity-60">
                  ({currentIdx + 1}/{pages.length})
                </span>
              )}
            </div>
          )}
        </div>

        {/* Prev / Next quick nav */}
        {pages.length > 1 && (
          <>
            <button
              onClick={goToPrev}
              disabled={!hasPrev}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-[var(--muted-foreground)] disabled:opacity-30 active:bg-[var(--muted)]"
              title="Previous page"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={goToNext}
              disabled={!hasNext}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-[var(--muted-foreground)] disabled:opacity-30 active:bg-[var(--muted)]"
              title="Next page"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {pages.length > 0 && (
          <button
            onClick={() => setShowPageList((v) => !v)}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] active:bg-[var(--muted)]"
            title="Page list"
          >
            <List className="h-4 w-4" />
            {showPageList ? (
              <ChevronUp className="ml-0.5 h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="ml-0.5 h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Page list dropdown */}
      {showPageList && (
        <div className="border-b border-[var(--border)] bg-[var(--card)]/90 backdrop-blur">
          <ul className="max-h-60 overflow-y-auto px-2 py-1">
            {pages.map((page, i) => {
              const active = page.id === selectedPageId;
              return (
                <li key={page.id}>
                  <button
                    onClick={() => {
                      onSelectPage(page.id);
                      setShowPageList(false);
                    }}
                    className={`flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-xs ${
                      active
                        ? "bg-[var(--primary)]/15 text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)] active:bg-[var(--muted)]/40"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 tabular-nums opacity-50">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate">
                        {page.title || "Untitled"}
                      </span>
                    </span>
                    <span className="ml-2 shrink-0 rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      {STATUS_LABEL[page.status] || page.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
