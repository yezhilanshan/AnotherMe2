import type { ReactNode } from 'react';
import type { NotebookNote } from '@/lib/notebook/storage';
import type { HeadingItem, NoteDraft, ThemeOption } from './types';

export function toDraft(note: NotebookNote): NoteDraft {
  return {
    title: note.title,
    subject: note.subject,
    tags: note.tags.join(', '),
    content: note.content,
  };
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function getNotePreview(content: string, maxLength = 60): string {
  const plain = content
    .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
    .replace(/\[.*?\]\(.*?\)/g, '$1')
    .replace(/[#*`~>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '无内容';
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}

export function getSubjectColor(subject: string): string {
  const colors: Record<string, string> = {
    数学: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    物理: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    化学: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    英语: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    语文: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    历史: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    地理: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    生物: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300',
    课堂: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    综合: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return colors[subject] || colors['综合'];
}

export function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitMarkdownBlocks(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) return [''];

  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const isFence = /^(```|~~~)/.test(trimmed);

    if (isFence) {
      inCodeFence = !inCodeFence;
      current.push(line);
      return;
    }

    if (!inCodeFence && trimmed === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      return;
    }

    current.push(line);
  });

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks.length > 0 ? blocks : [''];
}

export function joinMarkdownBlocks(blocks: string[]): string {
  const compact = blocks.map((block) => block.replace(/\s+$/g, '')).filter((block) => block !== '');
  return compact.join('\n\n');
}

export function getHeadingText(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { level: match[1].length, text: match[2].trim() };
}

export function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function extractHeadings(markdown: string): HeadingItem[] {
  const counts = new Map<string, number>();
  return markdown
    .split('\n')
    .map(getHeadingText)
    .filter((item): item is { level: number; text: string } => item !== null)
    .map((item) => {
      const base = slugifyHeading(item.text) || 'section';
      const current = counts.get(base) || 0;
      counts.set(base, current + 1);
      const slug = current === 0 ? base : `${base}-${current + 1}`;
      return { ...item, slug };
    });
}

export function flattenText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((item) => flattenText(item)).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

export function buildExportHtml(title: string, articleHtml: string, theme: ThemeOption): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title || '笔记本导出'}</title>
  <style>
    body { margin: 0; padding: 32px; font-family: "PingFang SC","Microsoft YaHei UI",sans-serif; line-height: 1.8; }
    .doc { max-width: 860px; margin: 0 auto; border: 1px solid #ddd; border-radius: 12px; padding: 28px; }
    h1,h2,h3,h4,h5,h6 { margin-top: 1.3em; margin-bottom: 0.5em; }
    pre { background: #111827; color: #e5e7eb; border-radius: 8px; padding: 14px; overflow: auto; }
    code { font-family: "Sarasa Mono SC","Consolas",monospace; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th,td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; }
    blockquote { margin: 0; padding: 0 14px; border-left: 4px solid #9ca3af; color: #4b5563; }
    img { max-width: 100%; border-radius: 8px; }
    .meta { color: #6b7280; margin-bottom: 16px; font-size: 13px; }
    .theme { margin-left: 8px; }
  </style>
</head>
<body>
  <article class="doc">
    <div class="meta">导出自笔记本<span class="theme">主题：${theme.label}</span></div>
    ${articleHtml}
  </article>
</body>
</html>`;
}

export function autoGrowTextarea(node: HTMLTextAreaElement | null): void {
  if (!node) return;
  node.style.height = '0px';
  node.style.height = `${Math.max(76, node.scrollHeight)}px`;
}
