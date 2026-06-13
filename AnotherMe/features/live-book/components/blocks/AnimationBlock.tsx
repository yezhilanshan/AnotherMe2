'use client';

import { Download, ExternalLink } from 'lucide-react';

import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import type { Block } from '@/lib/live-book/types';

export interface AnimationBlockProps {
  block: Block;
}

interface Artifact {
  type?: string;
  url?: string;
  filename?: string;
  content_type?: string;
  label?: string;
}

function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const normalized = url.startsWith('/') ? url : `/${url}`;
  return `/api/live-book/assets${normalized}`;
}

export default function AnimationBlock({ block }: AnimationBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const rawVideoUrl = String(payload.video_url || '');
  const summary = String(payload.summary || '');
  const description = String(payload.description || '');
  const artifacts = (payload.artifacts as Artifact[] | undefined) || [];

  if (!rawVideoUrl && artifacts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)]/40 p-4 text-xs italic text-[var(--muted-foreground)]">
        (Animation payload is empty)
      </div>
    );
  }

  const primaryRaw = rawVideoUrl || artifacts[0]?.url || '';
  const primary = resolveAssetUrl(primaryRaw);
  const isVideo =
    primaryRaw.endsWith('.mp4') ||
    primaryRaw.endsWith('.webm') ||
    artifacts.some((a) => (a.content_type || '').startsWith('video/'));
  const filename = String(payload.filename || '') || artifacts[0]?.filename || '';

  return (
    <figure className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
      <div className="relative overflow-hidden rounded-xl bg-black">
        {isVideo ? (
          <video
            src={primary}
            controls
            playsInline
            preload="metadata"
            className="aspect-video h-auto w-full object-contain"
          />
        ) : (
          <img src={primary} alt={description || 'Animation frame'} className="h-auto w-full" />
        )}
      </div>
      {primary && (
        <div className="mt-2 flex items-center gap-2">
          <a
            href={primary}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] active:bg-[var(--muted)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
          >
            <ExternalLink size={14} />
            Open
          </a>
          {isVideo && (
            <a
              href={primary}
              download={filename || true}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] active:bg-[var(--muted)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
            >
              <Download size={14} />
              Download
            </a>
          )}
        </div>
      )}
      {(summary || description) && (
        <figcaption className="mt-3 text-xs leading-snug text-[var(--muted-foreground)]">
          <MarkdownRenderer content={summary || description} variant="default" />
        </figcaption>
      )}
    </figure>
  );
}
