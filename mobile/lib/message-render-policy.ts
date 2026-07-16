import type { Message } from "./types";

export const FINAL_WEBVIEW_MESSAGE_BUDGET = Number.POSITIVE_INFINITY;
export const SHORT_PLAIN_FINAL_CHARS = 900;
export const ARCHIVED_FINAL_PREVIEW_CHARS = 16000;

const DISPLAY_MATH_RE = /(^|\n)\s*(\$\$|\\\[)/;
const INLINE_MATH_RE =
  /(\$[^$\n]{1,300}\$|\\\([^)]{1,300}\\\)|\\(?:frac|sqrt|sum|prod|int|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|begin)\b)/;
const BLOCK_MARKDOWN_RE =
  /(^|\n)\s*(#{1,6}\s+|```|>\s+|[-*+]\s+\S|\d+[.)]\s+\S)/;
const TABLE_RE = /\|.+\|\s*\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?/;
const INLINE_MARKDOWN_RE = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)]+\))/;

export function hasRichMarkdownForWebView(content: string): boolean {
  if (!content) return false;
  return (
    DISPLAY_MATH_RE.test(content) ||
    INLINE_MATH_RE.test(content) ||
    BLOCK_MARKDOWN_RE.test(content) ||
    TABLE_RE.test(content) ||
    INLINE_MARKDOWN_RE.test(content)
  );
}

export function shouldUseChatWebViewMarkdown(
  content: string,
  options: { preferWebView: boolean; forceWebView?: boolean },
): boolean {
  if (!content.trim()) return false;
  if (options.forceWebView) return true;
  return options.preferWebView;
}

export function shouldTruncateLightweightFinal(
  content: string,
  options: { usingWebView: boolean; forceFullText?: boolean },
): boolean {
  if (options.usingWebView || options.forceFullText) return false;
  return (
    content.length > ARCHIVED_FINAL_PREVIEW_CHARS ||
    (content.length > SHORT_PLAIN_FINAL_CHARS &&
      hasRichMarkdownForWebView(content))
  );
}

export function buildWebViewEligibleMessageIds(
  messages: Message[],
  budget = FINAL_WEBVIEW_MESSAGE_BUDGET,
): Set<string> {
  const ids = new Set<string>();
  let finalAssistantCount = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (message.isStreaming) {
      ids.add(message.id);
      continue;
    }
    finalAssistantCount += 1;
    if (!Number.isFinite(budget) || finalAssistantCount <= budget) {
      ids.add(message.id);
    }
  }

  return ids;
}
