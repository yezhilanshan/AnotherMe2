import type { Message } from "./types";

export interface ChatWebViewTheme {
  bgPage: string;
  bgCard: string;
  bgInput: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  border: string;
  quoteBg: string;
  warning: string;
  warningLight: string;
  error: string;
  success: string;
}

export interface ChatWebViewAttachment {
  type: "image" | "file";
  uri?: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface ChatWebViewMessage
  extends Pick<
    Message,
    | "id"
    | "role"
    | "content"
    | "contentPreview"
    | "isStreaming"
    | "timestamp"
    | "reasoning"
    | "agentName"
    | "modelIncomplete"
    | "serverCutoff"
    | "contentTruncated"
    | "contentLength"
    | "clientPreviewOnly"
    | "historyPreviewOnly"
    | "storagePreviewOnly"
    | "queued"
    | "sources"
    | "retrievalResults"
    | "warnings"
    | "capabilityResult"
  > {
  attachments?: ChatWebViewAttachment[];
}

export type ChatWebViewInboundEvent =
  | {
      type: "set_messages";
      messages: ChatWebViewMessage[];
      hasOlderMessages?: boolean;
      isLoadingMessages?: boolean;
      isLoadingOlderMessages?: boolean;
    }
  | { type: "append_delta"; id: string; delta: string }
  | { type: "append_reasoning_delta"; id: string; delta: string }
  | { type: "finish_message"; id: string; content?: string; message?: ChatWebViewMessage }
  | { type: "replace_message"; message: ChatWebViewMessage }
  | { type: "set_theme"; theme: ChatWebViewTheme }
  | { type: "scroll_to_bottom"; animated?: boolean };

export interface ChatWebViewHtmlOptions {
  theme: ChatWebViewTheme;
  katexCss: string;
  katexJs: string;
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}

function safeStyleContent(value: string): string {
  return String(value || "").replace(/<\/style/gi, "<\\/style");
}

function safeScriptContent(value: string): string {
  return String(value || "").replace(/<\/script/gi, "<\\/script");
}

function cssColor(value: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  if (/^rgba?\([0-9.,\s%]+\)$/.test(value)) return value;
  if (value === "transparent") return value;
  return "#000000";
}

function cssVars(theme: ChatWebViewTheme): string {
  const pairs: Array<[string, string]> = [
    ["--bg-page", theme.bgPage],
    ["--bg-card", theme.bgCard],
    ["--bg-input", theme.bgInput],
    ["--text-primary", theme.textPrimary],
    ["--text-secondary", theme.textSecondary],
    ["--text-muted", theme.textMuted],
    ["--text-inverse", theme.textInverse],
    ["--primary", theme.primary],
    ["--primary-dark", theme.primaryDark],
    ["--primary-light", theme.primaryLight],
    ["--border", theme.border],
    ["--quote-bg", theme.quoteBg],
    ["--warning", theme.warning],
    ["--warning-light", theme.warningLight],
    ["--error", theme.error],
    ["--success", theme.success],
  ];
  return pairs.map(([name, value]) => `${name}: ${cssColor(value)};`).join("\n");
}

export function buildChatWebViewEventScript(
  event: ChatWebViewInboundEvent,
): string {
  return `
(function() {
  if (window.__ANOTHERME_CHAT_WEBVIEW_EVENT) {
    window.__ANOTHERME_CHAT_WEBVIEW_EVENT(${jsonForInlineScript(event)});
  }
})();
true;
`;
}

export function buildChatWebViewHtml({
  theme,
  katexCss,
  katexJs,
}: ChatWebViewHtmlOptions): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style id="katex-css">${safeStyleContent(katexCss)}</style>
<style>
  :root {
${cssVars(theme)}
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0;
    padding: 0;
    min-height: 100%;
    background: var(--bg-page);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 22px;
    -webkit-text-size-adjust: 100%;
  }
  body { overflow-x: hidden; }
  #chat-root {
    min-height: 100vh;
    padding: 12px 0 74px;
  }
  .empty {
    min-height: 56vh;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    color: var(--text-muted);
  }
  .empty-title {
    color: var(--text-primary);
    font-size: 21px;
    font-weight: 700;
  }
  .empty-subtitle { font-size: 14px; }
  .load-older {
    display: flex;
    justify-content: center;
    padding: 2px 0 8px;
  }
  .load-older button {
    min-height: 32px;
    min-width: 112px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text-secondary);
    font-weight: 600;
  }
  .time-separator {
    text-align: center;
    margin: 12px 0;
  }
  .time-separator span {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-muted);
    font-size: 12px;
  }
  .message-wrap {
    padding: 0 12px;
    margin: 6px 0;
  }
  .message-wrap.user {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .message-wrap.assistant {
    display: block;
  }
  .bubble {
    max-width: 100%;
    border-radius: 8px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .user .bubble {
    max-width: 82%;
    padding: 10px 12px;
    background: var(--primary);
    color: var(--text-inverse);
  }
  .assistant .bubble {
    width: 100%;
    padding: 12px 14px;
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid rgba(0,0,0,0.03);
  }
  .queued {
    margin-top: 5px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .reasoning {
    margin-bottom: 8px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid rgba(245, 158, 11, 0.22);
    background: var(--warning-light);
    color: var(--text-secondary);
  }
  .reasoning-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 8px 10px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
  }
  .reasoning-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warning);
    opacity: 0.78;
  }
  .reasoning-body {
    max-height: 132px;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 0 10px 10px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 18px;
    white-space: pre-wrap;
  }
  .reasoning.streaming .reasoning-body {
    max-height: 118px;
  }
  .reasoning-cursor {
    display: inline-block;
    margin-left: 2px;
    color: var(--warning);
  }
  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
    max-width: 100%;
    justify-content: flex-end;
  }
  .assistant .attachments { justify-content: flex-start; }
  .attachment-img {
    width: 180px;
    max-width: 58vw;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 8px;
    background: var(--bg-input);
  }
  .attachment-file {
    max-width: 82vw;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 13px;
  }
  .capability-result {
    margin-top: 8px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-card);
  }
  .capability-title {
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--primary-dark);
  }
  .capability-artifacts {
    display: grid;
    gap: 8px;
  }
  .capability-artifact {
    display: block;
    padding: 8px;
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--primary-dark);
    text-decoration: none;
  }
  .capability-artifact-img {
    display: block;
    width: 100%;
    max-height: 320px;
    object-fit: contain;
    border-radius: 6px;
    background: #fff;
  }
  .capability-code {
    margin-top: 8px;
  }
  .capability-code summary {
    color: var(--primary);
    font-size: 13px;
    font-weight: 600;
  }
  .message-body p { margin: 0 0 10px; }
  .message-body p:last-child { margin-bottom: 0; }
  .message-body h1,
  .message-body h2,
  .message-body h3,
  .message-body h4,
  .message-body h5,
  .message-body h6 {
    margin: 16px 0 8px;
    color: var(--text-primary);
    font-weight: 700;
    line-height: 1.28;
  }
  .message-body h1 { font-size: 1.42em; }
  .message-body h2 { font-size: 1.26em; }
  .message-body h3 { font-size: 1.14em; }
  .message-body h4,
  .message-body h5,
  .message-body h6 { font-size: 1.05em; }
  .message-body a {
    color: var(--primary);
    text-decoration: underline;
  }
  .user .message-body a { color: var(--text-inverse); }
  .message-body ul,
  .message-body ol {
    margin: 0 0 10px 21px;
    padding: 0;
  }
  .message-body li {
    margin: 4px 0;
    padding-left: 2px;
  }
  .message-body blockquote {
    margin: 8px 0 10px;
    padding: 8px 10px;
    border-left: 4px solid var(--primary);
    background: var(--quote-bg);
    border-radius: 6px;
    color: var(--text-secondary);
  }
  .message-body pre {
    margin: 8px 0 10px;
    padding: 10px 12px;
    overflow-x: auto;
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--primary-dark);
    -webkit-overflow-scrolling: touch;
  }
  .message-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
  }
  .message-body :not(pre) > code {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--primary-dark);
  }
  .message-body hr {
    height: 1px;
    border: 0;
    background: var(--border);
    margin: 12px 0;
  }
  .table-wrap {
    width: 100%;
    overflow-x: auto;
    margin: 8px 0 10px;
    -webkit-overflow-scrolling: touch;
  }
  table {
    min-width: 100%;
    border-collapse: collapse;
    border: 1px solid var(--border);
  }
  th, td {
    border: 1px solid var(--border);
    padding: 7px 9px;
    text-align: left;
    vertical-align: top;
  }
  th {
    font-weight: 700;
    background: rgba(126, 168, 190, 0.14);
  }
  .math-display {
    overflow-x: auto;
    overflow-y: hidden;
    margin: 10px 0;
    padding: 4px 0;
    -webkit-overflow-scrolling: touch;
  }
  .math-display .katex-display {
    margin: 0;
    text-align: left;
  }
  .math-fallback,
  .raw-block {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
  }
  .cursor {
    display: inline-block;
    margin-left: 2px;
    color: var(--primary);
    font-weight: 700;
  }
  .meta-section {
    margin-top: 8px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .meta-section div { margin-top: 2px; }
  .partial-notice {
    margin-top: 8px;
    padding: 8px 10px;
    border: 1px solid var(--warning);
    border-radius: 8px;
    background: var(--warning-light);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .user .actions {
    justify-content: flex-end;
    margin-right: 4px;
  }
  .action {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    padding: 5px 7px;
    border-radius: 6px;
  }
  .action:active { background: var(--bg-input); }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 92px;
    transform: translateX(-50%);
    z-index: 20;
    padding: 8px 16px;
    border-radius: 18px;
    background: rgba(0,0,0,0.76);
    color: #fff;
    font-size: 13px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 160ms ease;
  }
  .toast.show { opacity: 1; }
  .jump-bottom {
    position: fixed;
    right: 16px;
    bottom: 22px;
    z-index: 10;
    width: 38px;
    height: 38px;
    border-radius: 19px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--primary);
    box-shadow: 0 6px 18px rgba(15,23,42,0.16);
    font-size: 20px;
    display: none;
  }
  .jump-bottom.show { display: block; }
</style>
</head>
<body>
<main id="chat-root"></main>
<button id="jump-bottom" class="jump-bottom" type="button" aria-label="滚动到底部">↓</button>
<div id="toast" class="toast">复制成功</div>
<script id="katex-js">${safeScriptContent(katexJs)}</script>
<script id="chat-webview-bridge">
(function() {
  var FLUSH_DELAY_MS = 75;
  var messages = new Map();
  var order = [];
  var streamBuffers = new Map();
  var reasoningBuffers = new Map();
  var currentStreamMessageId = null;
  var dirtyIds = new Set();
  var flushTimer = 0;
  var autoScroll = true;
  var hasOlderMessages = false;
  var isLoadingMessages = false;
  var isLoadingOlderMessages = false;
  var root = document.getElementById("chat-root");
  var jumpBottom = document.getElementById("jump-bottom");
  var toast = document.getElementById("toast");

  function post(payload) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeHref(value) {
    var href = String(value || "").trim();
    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
    return "#";
  }

  function safeMediaSrc(value) {
    var src = String(value || "").trim();
    if (/^(https?:|file:|data:|content:|blob:)/i.test(src)) return src;
    return "";
  }

  function plainContent(message) {
    return String(
      (message &&
        (message.contentPreview ||
          message.content ||
          (message.capabilityResult && message.capabilityResult.content))) ||
        ""
    );
  }

  function isEscaped(text, index) {
    var count = 0;
    var i = index - 1;
    while (i >= 0 && text[i] === "\\\\") {
      count += 1;
      i -= 1;
    }
    return count % 2 === 1;
  }

  function findClosingDollar(text, start) {
    for (var i = start; i < text.length; i += 1) {
      if (text[i] === "$" && !isEscaped(text, i)) return i;
    }
    return -1;
  }

  function renderMath(formula, displayMode) {
    var sourceFormula = String(formula || "").trim();
    if (!sourceFormula) return "";
    if (window.katex && window.katex.renderToString) {
      try {
        var html = window.katex.renderToString(sourceFormula, {
          displayMode: !!displayMode,
          throwOnError: false,
          strict: "ignore",
          trust: false
        });
        return displayMode
          ? '<div class="math-display">' + html + "</div>"
          : html;
      } catch (error) {}
    }
    var escaped = escapeHtml(sourceFormula);
    return displayMode
      ? '<div class="math-display"><span class="math-fallback">$$' + escaped + "$$</span></div>"
      : '<span class="math-fallback">$' + escaped + "$</span>";
  }

  function renderTextInline(text) {
    var code = [];
    var backtick = String.fromCharCode(96);
    var inlineCodePattern = new RegExp(
      backtick + "([^" + backtick + "\\\\n]+)" + backtick,
      "g"
    );
    var value = String(text || "").replace(inlineCodePattern, function(match, inner) {
      var token = "\\u0000CODE_" + code.length + "\\u0000";
      code.push("<code>" + escapeHtml(inner) + "</code>");
      return token;
    });
    var html = escapeHtml(value);
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function(match, label, href) {
      var url = safeHref(href.replace(/&amp;/g, "&"));
      if (url === "#") return match;
      return '<a href="' + escapeHtml(url) + '">' + label + "</a>";
    });
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, "$1<em>$2</em>");
    html = html.replace(/\\u0000CODE_(\\d+)\\u0000/g, function(match, index) {
      return code[Number(index)] || "";
    });
    return html;
  }

  function renderInline(text) {
    var segments = [];
    var lastIndex = 0;
    var i = 0;
    var value = String(text || "");
    while (i < value.length) {
      if (value[i] === "$" && value[i + 1] !== "$" && !isEscaped(value, i)) {
        var dollarEnd = findClosingDollar(value, i + 1);
        if (dollarEnd > i + 1) {
          if (lastIndex < i) segments.push(renderTextInline(value.slice(lastIndex, i)));
          segments.push(renderMath(value.slice(i + 1, dollarEnd), false));
          i = dollarEnd + 1;
          lastIndex = i;
          continue;
        }
      }
      if (value[i] === "\\\\" && value[i + 1] === "(") {
        var parenEnd = value.indexOf("\\\\)", i + 2);
        if (parenEnd > i + 2) {
          if (lastIndex < i) segments.push(renderTextInline(value.slice(lastIndex, i)));
          segments.push(renderMath(value.slice(i + 2, parenEnd), false));
          i = parenEnd + 2;
          lastIndex = i;
          continue;
        }
      }
      i += 1;
    }
    if (lastIndex < value.length) segments.push(renderTextInline(value.slice(lastIndex)));
    return segments.join("");
  }

  function splitTableRow(row) {
    return row.trim().replace(/^\\|/, "").replace(/\\|$/, "").split("|");
  }

  function isTableSeparator(row) {
    return /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(row);
  }

  function renderTable(lines, start) {
    var headers = splitTableRow(lines[start]);
    var rows = [];
    var i = start + 2;
    while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim()) {
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }
    var html = '<div class="table-wrap"><table><thead><tr>';
    html += headers.map(function(cell) {
      return "<th>" + renderInline(cell.trim()) + "</th>";
    }).join("");
    html += "</tr></thead><tbody>";
    html += rows.map(function(row) {
      return "<tr>" + row.map(function(cell) {
        return "<td>" + renderInline(cell.trim()) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    html += "</tbody></table></div>";
    return { html: html, next: i };
  }

  function renderRawBlock(value) {
    return '<p class="raw-block">' + escapeHtml(value).replace(/\\n/g, "<br>") + "</p>";
  }

  function domId(id) {
    return "message-" + String(id).replace(/[^a-zA-Z0-9_-]/g, function(char) {
      return "_" + char.charCodeAt(0).toString(16) + "_";
    });
  }

  function findClosingFence(lines, start, fence) {
    for (var i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim().indexOf(fence) === 0) return i;
    }
    return -1;
  }

  function renderMarkdown(markdown) {
    var lines = String(markdown || "").replace(/\\r\\n/g, "\\n").split("\\n");
    var html = [];
    var paragraph = [];
    var listItems = [];
    var orderedList = false;
    var fence = String.fromCharCode(96, 96, 96);
    var tildeFence = "~~~";

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push("<p>" + renderInline(paragraph.join(" ").trim()) + "</p>");
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      var tag = orderedList ? "ol" : "ul";
      html.push("<" + tag + ">" + listItems.map(function(item) {
        return "<li>" + renderInline(item) + "</li>";
      }).join("") + "</" + tag + ">");
      listItems = [];
    }

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var trimmed = line.trim();

      var openFence =
        trimmed.indexOf(fence) === 0
          ? fence
          : trimmed.indexOf(tildeFence) === 0
            ? tildeFence
            : "";
      if (openFence) {
        flushParagraph();
        flushList();
        var closeFence = findClosingFence(lines, i, openFence);
        if (closeFence === -1) {
          html.push(renderRawBlock(lines.slice(i).join("\\n")));
          break;
        }
        var codeLang = trimmed.slice(openFence.length).trim();
        var codeLines = lines.slice(i + 1, closeFence);
        html.push(
          '<pre><code data-lang="' + escapeHtml(codeLang) + '">' +
            escapeHtml(codeLines.join("\\n")) +
            "</code></pre>"
        );
        i = closeFence;
        continue;
      }

      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      if (trimmed.indexOf("$$") === 0 || trimmed.indexOf("\\\\[") === 0) {
        flushParagraph();
        flushList();
        var closeToken = trimmed.indexOf("$$") === 0 ? "$$" : "\\\\]";
        var openLength = 2;
        var formulaParts = [];
        var first = trimmed.slice(openLength);
        var closed = false;
        if (first.endsWith(closeToken) && first.length > closeToken.length) {
          formulaParts.push(first.slice(0, -closeToken.length));
          closed = true;
        } else {
          if (first) formulaParts.push(first);
          var mathStart = i;
          while (i + 1 < lines.length) {
            i += 1;
            var mathLine = lines[i];
            var end = mathLine.indexOf(closeToken);
            if (end !== -1) {
              formulaParts.push(mathLine.slice(0, end));
              closed = true;
              break;
            }
            formulaParts.push(mathLine);
          }
          if (!closed) {
            html.push(renderRawBlock(lines.slice(mathStart).join("\\n")));
            break;
          }
        }
        html.push(renderMath(formulaParts.join("\\n"), true));
        continue;
      }

      if (lines[i + 1] && line.indexOf("|") !== -1 && isTableSeparator(lines[i + 1])) {
        flushParagraph();
        flushList();
        var table = renderTable(lines, i);
        html.push(table.html);
        i = table.next - 1;
        continue;
      }

      var heading = trimmed.match(/^(#{1,6})\\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        var level = heading[1].length;
        html.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
        continue;
      }

      if (/^(-{3,}|\\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph();
        flushList();
        html.push("<hr>");
        continue;
      }

      if (/^>\\s?/.test(trimmed)) {
        flushParagraph();
        flushList();
        var quoteLines = [trimmed.replace(/^>\\s?/, "")];
        while (i + 1 < lines.length && /^>\\s?/.test(lines[i + 1].trim())) {
          i += 1;
          quoteLines.push(lines[i].trim().replace(/^>\\s?/, ""));
        }
        html.push("<blockquote>" + renderInline(quoteLines.join("\\n")) + "</blockquote>");
        continue;
      }

      var ordered = trimmed.match(/^\\d+[.)]\\s+(.+)$/);
      var unordered = trimmed.match(/^[-*+]\\s+(.+)$/);
      if (ordered || unordered) {
        flushParagraph();
        var nextOrdered = !!ordered;
        if (listItems.length && orderedList !== nextOrdered) flushList();
        orderedList = nextOrdered;
        listItems.push((ordered ? ordered[1] : unordered && unordered[1]) || "");
        continue;
      }

      paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
    return html.join("\\n");
  }

  function formatTime(timestamp) {
    var date = new Date(Number(timestamp) || Date.now());
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);
    var hours = date.getHours();
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var period = hours < 12 ? "上午" : "下午";
    var displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return diffMins + "分钟前";
    if (diffHours < 24) return period + displayHours + ":" + minutes;
    if (diffDays === 1) return "昨天 " + period + displayHours + ":" + minutes;
    if (diffDays < 7) {
      var weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      return weekDays[date.getDay()] + " " + period + displayHours + ":" + minutes;
    }
    return (date.getMonth() + 1) + "/" + date.getDate() + " " + period + displayHours + ":" + minutes;
  }

  function shouldShowTime(index) {
    if (index === 0) return true;
    var current = messages.get(order[index]);
    var previous = messages.get(order[index - 1]);
    if (!current || !previous) return false;
    return (Number(current.timestamp) - Number(previous.timestamp)) / 60000 > 5;
  }

  function renderAttachments(message) {
    var attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.length) return "";
    var html = '<div class="attachments">';
    attachments.forEach(function(att) {
      var name = escapeHtml(att.name || "文件");
      var src = safeMediaSrc(att.uri);
      if (att.type === "image" && src) {
        html += '<img class="attachment-img" src="' + escapeHtml(src) + '" alt="' + name + '">';
      } else {
        html += '<div class="attachment-file">' + name + "</div>";
      }
    });
    html += "</div>";
    return html;
  }

  function renderMeta(message) {
    var html = "";
    if (message.sources && message.sources.length) {
      html += '<div class="meta-section"><strong>来源</strong>';
      message.sources.forEach(function(source) {
        var title = escapeHtml(source.title || source.url || "来源");
        var href = safeHref(source.url || "");
        html += href === "#"
          ? "<div>" + title + "</div>"
          : '<div><a href="' + escapeHtml(href) + '">' + title + "</a></div>";
      });
      html += "</div>";
    }
    if (message.retrievalResults && message.retrievalResults.chunks) {
      html += '<div class="meta-section"><strong>已参考</strong>';
      message.retrievalResults.chunks.forEach(function(chunk) {
        html += "<div>· " + escapeHtml(chunk.filename || "资料");
        if (chunk.page !== null && chunk.page !== undefined) html += " 第" + escapeHtml(chunk.page) + "页";
        if (chunk.sheet_name) html += " " + escapeHtml(chunk.sheet_name);
        html += "</div>";
      });
      html += "</div>";
    }
    if (message.warnings && message.warnings.length) {
      html += '<div class="partial-notice">';
      message.warnings.forEach(function(warning) {
        html += "<div>" + escapeHtml(warning.message || String(warning)) + "</div>";
      });
      html += "</div>";
    }
    if (!message.isStreaming && (message.modelIncomplete || message.serverCutoff)) {
      html += '<div class="partial-notice">' +
        (message.modelIncomplete ? "模型输出达到上限，已暂停。" : "服务端保护限制触发，已暂停。") +
        "</div>";
    }
    return html;
  }

  function renderReasoning(message) {
    var reasoning = String((message && message.reasoning) || "");
    if (!reasoning.trim()) return "";
    var title = message.isStreaming ? "思考中" : "思考过程";
    var body = escapeHtml(reasoning);
    return '<div class="reasoning ' + (message.isStreaming ? "streaming" : "done") + '">' +
      '<div class="reasoning-head"><span class="reasoning-dot"></span><span>' + title + "</span></div>" +
      '<div class="reasoning-body">' + body +
      (message.isStreaming ? '<span class="reasoning-cursor">▎</span>' : "") +
      "</div></div>";
  }

  function hasCapabilityResult(message) {
    var result = message && message.capabilityResult;
    if (!result) return false;
    if (String(result.content || "").trim()) return true;
    if (Array.isArray(result.artifacts) && result.artifacts.length) return true;
    if (result.code && String(result.code.content || "").trim()) return true;
    return false;
  }

  function renderCapabilityResult(message, body) {
    var result = message && message.capabilityResult;
    if (!result) return "";
    var html = "";
    var resultContent = String(result.content || "").trim();
    if (resultContent && resultContent !== String(body || "").trim()) {
      html += '<div class="capability-result"><div class="capability-title">生成内容</div>' +
        renderMarkdown(resultContent) + "</div>";
    }
    var artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    if (artifacts.length) {
      html += '<div class="capability-result"><div class="capability-title">生成结果</div><div class="capability-artifacts">';
      artifacts.forEach(function(artifact) {
        var label = escapeHtml(artifact.label || artifact.filename || artifact.type || "结果");
        var href = safeHref(artifact.url || "");
        var src = safeMediaSrc(artifact.url || "");
        if (src && String(artifact.type || "").toLowerCase() === "image") {
          html += '<a class="capability-artifact" href="' + escapeHtml(href) + '">' +
            '<img class="capability-artifact-img" src="' + escapeHtml(src) + '" alt="' + label + '">' +
            '<div>' + label + "</div></a>";
        } else if (href !== "#") {
          html += '<a class="capability-artifact" href="' + escapeHtml(href) + '">' + label + "</a>";
        } else {
          html += '<div class="capability-artifact">' + label + "</div>";
        }
      });
      html += "</div></div>";
    }
    var code = result.code || {};
    var codeContent = String(code.content || "").trim();
    if (codeContent) {
      var language = escapeHtml(code.language || result.render_type || "text");
      html += '<details class="capability-result capability-code"><summary>查看代码</summary>' +
        '<pre><code>' + escapeHtml(codeContent) + "</code></pre>" +
        '<div class="queued">' + language + "</div></details>";
    }
    return html;
  }

  function renderMessageHtml(message) {
    var role = message.role === "user" ? "user" : "assistant";
    var body = plainContent(message);
    var hasBody = body.trim();
    var hasReasoning = String((message && message.reasoning) || "").trim();
    var hasStructuredResult = role === "assistant" && hasCapabilityResult(message);
    var capabilityHtml = role === "assistant" ? renderCapabilityResult(message, body) : "";
    var shouldRenderBubble =
      !!hasBody ||
      role === "user" ||
      (message.isStreaming && !hasReasoning) ||
      hasStructuredResult ||
      (role === "assistant" && !message.isStreaming);
    var html = renderAttachments(message);
    if (role === "assistant") {
      html += renderReasoning(message);
    }
    if (shouldRenderBubble) {
      html += '<div class="bubble"><div class="message-body">';
      if (hasBody) {
        html += role === "assistant" ? renderMarkdown(body) : escapeHtml(body).replace(/\\n/g, "<br>");
      } else if (message.isStreaming && !hasReasoning) {
        html += '<span style="color:var(--text-secondary)">正在思考</span>';
      } else if (hasStructuredResult) {
        html += '<span style="color:var(--text-secondary)">已生成结构化结果。</span>';
      } else if (role === "assistant") {
        html += '<span style="color:var(--text-secondary)">这条回复没有可显示内容，请重试。</span>';
      }
      if (message.isStreaming && hasBody) html += '<span class="cursor">▊</span>';
      html += "</div></div>";
    }
    html += capabilityHtml;
    if (message.queued) html += '<div class="queued">等待网络恢复后发送</div>';
    html += renderMeta(message);
    if (body.trim()) {
      html += '<div class="actions"><button type="button" class="action" data-action="copy" data-id="' +
        escapeHtml(message.id) + '">复制</button></div>';
    }
    return html;
  }

  function ensureMessageNode(id) {
    var existing = document.getElementById(domId(id));
    if (existing) return existing;
    var node = document.createElement("section");
    node.id = domId(id);
    node.setAttribute("data-message-id", id);
    root.appendChild(node);
    return node;
  }

  function renderMessageNode(id) {
    var message = messages.get(id);
    var node = ensureMessageNode(id);
    if (!message) {
      node.remove();
      return;
    }
    var index = order.indexOf(id);
    var role = message.role === "user" ? "user" : "assistant";
    node.className = "message-block";
    node.innerHTML =
      (shouldShowTime(index)
        ? '<div class="time-separator"><span>' + formatTime(message.timestamp) + "</span></div>"
        : "") +
      '<div class="message-wrap ' + role + '">' + renderMessageHtml(message) + "</div>";
    if (message.isStreaming && node.querySelector) {
      var reasoningBody = node.querySelector(".reasoning-body");
      if (reasoningBody) reasoningBody.scrollTop = reasoningBody.scrollHeight;
    }
  }

  function renderAll() {
    root.innerHTML = "";
    if (hasOlderMessages || isLoadingOlderMessages) {
      var older = document.createElement("div");
      older.className = "load-older";
      older.innerHTML = '<button type="button" data-action="load-older">' +
        (isLoadingOlderMessages ? "正在加载..." : "加载更早消息") +
        "</button>";
      root.appendChild(older);
    }
    if (isLoadingMessages && order.length === 0) {
      root.innerHTML += '<div class="empty"><div class="empty-subtitle">正在加载历史对话...</div></div>';
      return;
    }
    if (order.length === 0) {
      root.innerHTML += '<div class="empty"><div class="empty-title">AI 导师</div><div class="empty-subtitle">输入消息开始对话</div></div>';
      return;
    }
    order.forEach(renderMessageNode);
    maybeScrollToBottom(false);
  }

  function flushDirty() {
    flushTimer = 0;
    dirtyIds.forEach(renderMessageNode);
    dirtyIds.clear();
    maybeScrollToBottom(false);
  }

  function scheduleFlush(id) {
    if (id) dirtyIds.add(id);
    if (flushTimer) return;
    flushTimer = setTimeout(flushDirty, FLUSH_DELAY_MS);
  }

  function nearBottom() {
    var scroller = document.scrollingElement || document.documentElement;
    return scroller.scrollHeight - (window.scrollY + window.innerHeight) < 88;
  }

  function updateJumpButton() {
    if (!jumpBottom) return;
    if (autoScroll) jumpBottom.classList.remove("show");
    else jumpBottom.classList.add("show");
  }

  function maybeScrollToBottom(animated) {
    if (!autoScroll) return;
    scrollToBottom(animated);
  }

  function scrollToBottom(animated) {
    autoScroll = true;
    updateJumpButton();
    var top = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    try {
      window.scrollTo({ top: top, behavior: animated ? "smooth" : "auto" });
    } catch (error) {
      window.scrollTo(0, top);
    }
  }

  function setMessages(nextMessages) {
    messages = new Map();
    streamBuffers = new Map();
    reasoningBuffers = new Map();
    currentStreamMessageId = null;
    order = [];
    (Array.isArray(nextMessages) ? nextMessages : []).forEach(function(message) {
      if (!message || !message.id) return;
      messages.set(message.id, message);
      order.push(message.id);
      if (message.isStreaming) {
        streamBuffers.set(message.id, plainContent(message));
        reasoningBuffers.set(message.id, String(message.reasoning || ""));
        currentStreamMessageId = message.id;
      } else if (message.reasoning) {
        reasoningBuffers.set(message.id, String(message.reasoning || ""));
      }
    });
    renderAll();
  }

  function appendDelta(id, delta) {
    if (!id) return;
    var message = messages.get(id);
    if (!message) {
      message = {
        id: id,
        role: "assistant",
        content: "",
        isStreaming: true,
        timestamp: Date.now()
      };
      messages.set(id, message);
      order.push(id);
    }
    currentStreamMessageId = id;
    var next = (streamBuffers.get(id) || plainContent(message)) + String(delta || "");
    streamBuffers.set(id, next);
    message.content = next;
    message.contentPreview = undefined;
    message.isStreaming = true;
    scheduleFlush(id);
  }

  function appendReasoningDelta(id, delta) {
    if (!id) return;
    var message = messages.get(id);
    if (!message) {
      message = {
        id: id,
        role: "assistant",
        content: "",
        reasoning: "",
        isStreaming: true,
        timestamp: Date.now()
      };
      messages.set(id, message);
      order.push(id);
    }
    currentStreamMessageId = id;
    var next = (reasoningBuffers.get(id) || String(message.reasoning || "")) + String(delta || "");
    reasoningBuffers.set(id, next);
    message.reasoning = next;
    message.isStreaming = true;
    scheduleFlush(id);
  }

  function finishMessage(id, content, finalMessage) {
    var message = messages.get(id);
    if (!message) {
      message = finalMessage && finalMessage.id
        ? finalMessage
        : {
            id: id,
            role: "assistant",
            content: "",
            isStreaming: false,
            timestamp: Date.now()
          };
      messages.set(id, message);
      if (order.indexOf(id) === -1) order.push(id);
    } else if (finalMessage && finalMessage.id) {
      Object.keys(finalMessage).forEach(function(key) {
        message[key] = finalMessage[key];
      });
    }
    if (typeof content === "string") {
      message.content = content;
      message.contentPreview = undefined;
    } else if (streamBuffers.has(id)) {
      message.content = streamBuffers.get(id) || message.content || "";
      message.contentPreview = undefined;
    }
    message.isStreaming = false;
    streamBuffers.delete(id);
    reasoningBuffers.delete(id);
    if (currentStreamMessageId === id) currentStreamMessageId = null;
    scheduleFlush(id);
  }

  function replaceMessage(message) {
    if (!message || !message.id) return;
    var exists = messages.has(message.id);
    messages.set(message.id, message);
    if (!exists) order.push(message.id);
    if (message.isStreaming) {
      streamBuffers.set(message.id, plainContent(message));
      reasoningBuffers.set(message.id, String(message.reasoning || ""));
      currentStreamMessageId = message.id;
    } else {
      streamBuffers.delete(message.id);
      reasoningBuffers.delete(message.id);
      if (currentStreamMessageId === message.id) currentStreamMessageId = null;
    }
    scheduleFlush(message.id);
  }

  function setTheme(theme) {
    if (!theme || typeof theme !== "object") return;
    var map = {
      bgPage: "--bg-page",
      bgCard: "--bg-card",
      bgInput: "--bg-input",
      textPrimary: "--text-primary",
      textSecondary: "--text-secondary",
      textMuted: "--text-muted",
      textInverse: "--text-inverse",
      primary: "--primary",
      primaryDark: "--primary-dark",
      primaryLight: "--primary-light",
      border: "--border",
      quoteBg: "--quote-bg",
      warning: "--warning",
      warningLight: "--warning-light",
      error: "--error",
      success: "--success"
    };
    Object.keys(map).forEach(function(key) {
      if (typeof theme[key] === "string") {
        document.documentElement.style.setProperty(map[key], theme[key]);
      }
    });
  }

  window.__ANOTHERME_CHAT_WEBVIEW_EVENT = function(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "set_messages") {
      hasOlderMessages = !!event.hasOlderMessages;
      isLoadingMessages = !!event.isLoadingMessages;
      isLoadingOlderMessages = !!event.isLoadingOlderMessages;
      setMessages(event.messages || []);
      return;
    }
    if (event.type === "append_delta") {
      appendDelta(event.id, event.delta);
      return;
    }
    if (event.type === "append_reasoning_delta") {
      appendReasoningDelta(event.id, event.delta);
      return;
    }
    if (event.type === "finish_message") {
      finishMessage(event.id, event.content, event.message);
      return;
    }
    if (event.type === "replace_message") {
      replaceMessage(event.message);
      return;
    }
    if (event.type === "set_theme") {
      setTheme(event.theme);
      return;
    }
    if (event.type === "scroll_to_bottom") {
      scrollToBottom(!!event.animated);
    }
  };

  document.addEventListener("click", function(event) {
    var target = event.target;
    while (target && target !== document && !target.getAttribute("data-action") && target.tagName !== "A") {
      target = target.parentNode;
    }
    if (!target || target === document) return;
    if (target.tagName === "A") {
      event.preventDefault();
      post({ type: "link", href: target.href });
      return;
    }
    var action = target.getAttribute("data-action");
    if (action === "copy") {
      var id = target.getAttribute("data-id");
      var message = id ? messages.get(id) : null;
      if (message) {
        post({ type: "copy", text: plainContent(message), id: id });
        toast.classList.add("show");
        setTimeout(function() { toast.classList.remove("show"); }, 1200);
      }
      return;
    }
    if (action === "load-older") {
      post({ type: "load_older" });
    }
  });

  if (jumpBottom) {
    jumpBottom.addEventListener("click", function() {
      scrollToBottom(true);
    });
  }

  var scrollTicking = false;
  window.addEventListener("scroll", function() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function() {
      autoScroll = nearBottom();
      updateJumpButton();
      scrollTicking = false;
    });
  }, { passive: true });

  window.addEventListener("load", function() {
    post({ type: "ready" });
  });
  if (document.readyState !== "loading") {
    setTimeout(function() { post({ type: "ready" }); }, 0);
  }
})();
</script>
</body>
</html>`;
}
