import type { ReactNode } from 'react';

export function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function flattenText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((item) => flattenText(item)).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}