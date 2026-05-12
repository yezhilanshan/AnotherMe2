'use client';

import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';
import { flattenText, slugifyHeading } from './utils';

export function MarkdownBlockPreview({
  block,
  fileToneClass,
}: {
  block: string;
  fileToneClass: string;
}) {
  if (!block.trim()) {
    return <p className={cn('my-0 text-sm italic', fileToneClass)}>&nbsp;</p>;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        h1: ({ children }) => <h1 id={headingId(children)}>{children}</h1>,
        h2: ({ children }) => <h2 id={headingId(children)}>{children}</h2>,
        h3: ({ children }) => <h3 id={headingId(children)}>{children}</h3>,
        code: ({ className, children }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="rounded-sm bg-black/8 px-1.5 py-0.5 text-[13px]">{children}</code>
            );
          }
          return <code className={className}>{children}</code>;
        },
      }}
    >
      {block}
    </ReactMarkdown>
  );
}

function headingId(children: ReactNode) {
  return slugifyHeading(flattenText(children));
}
