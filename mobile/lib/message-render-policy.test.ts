import {
  ARCHIVED_FINAL_PREVIEW_CHARS,
  FINAL_WEBVIEW_MESSAGE_BUDGET,
  buildWebViewEligibleMessageIds,
  hasRichMarkdownForWebView,
  shouldUseChatWebViewMarkdown,
  shouldTruncateLightweightFinal,
} from "./message-render-policy";
import type { Message } from "./types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`  x ${label}`);
  }
}

function msg(id: string, role: Message["role"], content = "ok"): Message {
  return {
    id,
    role,
    content,
    timestamp: Date.now(),
  };
}

console.log("\n-- message render policy --");

assert(
  FINAL_WEBVIEW_MESSAGE_BUDGET === Number.POSITIVE_INFINITY,
  "default WebView budget is unlimited",
);
assert(
  hasRichMarkdownForWebView("Inline $x^2$ formula"),
  "inline math is rich content",
);
assert(
  hasRichMarkdownForWebView("$$\n\\frac{1}{2}\n$$"),
  "display math is rich content",
);
assert(hasRichMarkdownForWebView("## Heading"), "heading is rich content");
assert(
  hasRichMarkdownForWebView("| A | B |\n|---|---|\n| 1 | 2 |"),
  "table is rich content",
);
assert(
  !hasRichMarkdownForWebView("A short plain answer."),
  "short plain text is not rich content",
);

assert(
  shouldUseChatWebViewMarkdown("A".repeat(901), {
    preferWebView: true,
  }),
  "long plain answer uses WebView",
);
assert(
  shouldUseChatWebViewMarkdown("Inline $x$", {
    preferWebView: true,
  }),
  "math answer uses WebView",
);
assert(
  shouldUseChatWebViewMarkdown("A short plain answer.", {
    preferWebView: true,
  }),
  "short plain answer also uses WebView",
);
assert(
  !shouldUseChatWebViewMarkdown("Inline $x$", {
    preferWebView: false,
  }),
  "explicit fallback can still disable WebView",
);
assert(
  shouldUseChatWebViewMarkdown("Inline $x$", {
    preferWebView: false,
    forceWebView: true,
  }),
  "forceWebView overrides budget",
);

assert(
  shouldTruncateLightweightFinal("A".repeat(ARCHIVED_FINAL_PREVIEW_CHARS + 1), {
    usingWebView: false,
  }),
  "old very long answer is truncated in lightweight mode",
);
assert(
  !shouldTruncateLightweightFinal("A".repeat(ARCHIVED_FINAL_PREVIEW_CHARS + 1), {
    usingWebView: true,
  }),
  "WebView answer is not lightweight-truncated",
);

const messages: Message[] = [
  msg("u1", "user"),
  msg("a1", "assistant"),
  msg("u2", "user"),
  msg("a2", "assistant"),
  msg("a3", "assistant"),
  msg("a4", "assistant"),
  msg("a5", "assistant"),
];
const ids = buildWebViewEligibleMessageIds(messages);
assert(ids.has("a1"), "oldest assistant is inside unlimited WebView budget");
assert(ids.has("a2"), "middle assistant is inside unlimited WebView budget");
assert(ids.has("a5"), "latest assistant is inside unlimited WebView budget");

const streamingMessages = [
  ...messages,
  { ...msg("a-stream", "assistant"), isStreaming: true },
];
const streamingIds = buildWebViewEligibleMessageIds(streamingMessages);
assert(streamingIds.has("a-stream"), "streaming assistant remains eligible");

console.log(`\nPassed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(failure);
  process.exit(1);
}
