import type { BookPage } from "./types";

export interface LiveBookWebViewTheme {
  bgPage: string;
  bgCard: string;
  bgInput: string;
  bgElevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  border: string;
  divider: string;
  quoteBg: string;
  warning: string;
  warningLight: string;
  error: string;
  errorLight: string;
  success: string;
  successLight: string;
  infoLight: string;
}

export interface LiveBookWebViewProgress {
  completedCount: number;
  totalPages: number;
  progressPercent: number;
}

export type LiveBookWebViewInboundEvent = {
  type: "set_page";
  bookTitle: string;
  page: BookPage;
  progress: LiveBookWebViewProgress;
};

export interface LiveBookWebViewHtmlOptions {
  theme: LiveBookWebViewTheme;
  assetBaseUrl: string;
  katexCss?: string;
  katexJs?: string;
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

function cssColor(value: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  if (/^rgba?\([0-9.,\s%]+\)$/.test(value)) return value;
  if (value === "transparent") return value;
  return "#000000";
}

function safeStyleContent(value: string): string {
  return String(value || "").replace(/<\/style/gi, "<\\/style");
}

function safeScriptContent(value: string): string {
  return String(value || "").replace(/<\/script/gi, "<\\/script");
}

function cssVars(theme: LiveBookWebViewTheme): string {
  const pairs: Array<[string, string]> = [
    ["--bg-page", theme.bgPage],
    ["--bg-card", theme.bgCard],
    ["--bg-input", theme.bgInput],
    ["--bg-elevated", theme.bgElevated],
    ["--text-primary", theme.textPrimary],
    ["--text-secondary", theme.textSecondary],
    ["--text-muted", theme.textMuted],
    ["--primary", theme.primary],
    ["--primary-dark", theme.primaryDark],
    ["--primary-light", theme.primaryLight],
    ["--border", theme.border],
    ["--divider", theme.divider],
    ["--quote-bg", theme.quoteBg],
    ["--warning", theme.warning],
    ["--warning-light", theme.warningLight],
    ["--error", theme.error],
    ["--error-light", theme.errorLight],
    ["--success", theme.success],
    ["--success-light", theme.successLight],
    ["--info-light", theme.infoLight],
  ];
  return pairs.map(([name, value]) => `${name}: ${cssColor(value)};`).join("\n");
}

export function buildLiveBookWebViewEventScript(
  event: LiveBookWebViewInboundEvent,
): string {
  return `
(function() {
  if (window.__ANOTHERME_LIVE_BOOK_WEBVIEW_EVENT) {
    window.__ANOTHERME_LIVE_BOOK_WEBVIEW_EVENT(${jsonForInlineScript(event)});
  }
})();
true;
`;
}

export function buildLiveBookWebViewHtml({
  theme,
  assetBaseUrl,
  katexCss = "",
  katexJs = "",
}: LiveBookWebViewHtmlOptions): string {
  const normalizedAssetBaseUrl = assetBaseUrl.replace(/\/+$/, "");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
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
    font-size: 16px;
    line-height: 25px;
    -webkit-text-size-adjust: 100%;
  }
  body { overflow-x: hidden; }
  button, input { font: inherit; }
  img,
  svg,
  video,
  canvas {
    max-width: 100%;
  }
  #live-book-root {
    min-height: 100vh;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 16px 14px 96px;
  }
  .progress-card {
    margin-bottom: 16px;
    padding: 12px 13px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-input);
  }
  .progress-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
  }
  .progress-bar {
    height: 5px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--border);
  }
  .progress-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--primary);
  }
  .page-title {
    margin: 2px 2px 14px;
    color: var(--text-primary);
    font-size: 24px;
    line-height: 31px;
    font-weight: 800;
  }
  .block {
    margin: 0 0 14px;
    padding: 15px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .block-plain {
    padding: 0;
    border: 0;
    background: transparent;
  }
  .block-title {
    margin: 0 0 9px;
    color: var(--text-primary);
    font-size: 18px;
    line-height: 24px;
    font-weight: 750;
  }
  .subsection-title {
    margin: 13px 0 7px;
    color: var(--text-primary);
    font-size: 16px;
    line-height: 22px;
    font-weight: 720;
  }
  .block-kicker {
    margin: 0 0 6px;
    color: var(--primary);
    font-size: 11px;
    line-height: 16px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .bridge {
    margin: 0 0 10px;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 22px;
  }
  .markdown p { margin: 0 0 10px; }
  .markdown p:last-child { margin-bottom: 0; }
  .markdown {
    color: var(--text-primary);
  }
  .markdown h1,
  .markdown h2,
  .markdown h3,
  .markdown h4,
  .markdown h5,
  .markdown h6 {
    margin: 16px 0 8px;
    color: var(--text-primary);
    font-weight: 750;
    line-height: 1.3;
  }
  .markdown h1 { font-size: 1.45em; }
  .markdown h2 { font-size: 1.28em; }
  .markdown h3 { font-size: 1.15em; }
  .markdown h4,
  .markdown h5,
  .markdown h6 { font-size: 1.05em; }
  .markdown a {
    color: var(--primary);
    text-decoration: underline;
  }
  .markdown img,
  .markdown svg {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    margin: 10px auto;
    border-radius: 8px;
  }
  .markdown ul,
  .markdown ol {
    margin: 0 0 10px 21px;
    padding: 0;
  }
  .markdown li {
    margin: 5px 0;
    padding-left: 2px;
  }
  .markdown blockquote {
    margin: 8px 0 10px;
    padding: 8px 10px;
    border-left: 4px solid var(--primary);
    border-radius: 6px;
    background: var(--quote-bg);
    color: var(--text-secondary);
  }
  .markdown pre,
  .code-pre,
  .diagram-source {
    margin: 9px 0 11px;
    padding: 11px 12px;
    overflow-x: auto;
    border-radius: 8px;
    background: var(--bg-input);
    color: var(--primary-dark);
    line-height: 19px;
    white-space: pre;
    -webkit-overflow-scrolling: touch;
  }
  .markdown code,
  .code-pre,
  .diagram-source {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }
  .markdown :not(pre) > code {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--primary-dark);
  }
  .markdown hr {
    height: 1px;
    border: 0;
    background: var(--border);
    margin: 12px 0;
  }
  .table-wrap {
    width: 100%;
    overflow-x: auto;
    margin: 9px 0 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    -webkit-overflow-scrolling: touch;
  }
  table {
    min-width: max(100%, 520px);
    border-collapse: collapse;
    border: 0;
  }
  th, td {
    border: 1px solid var(--border);
    min-width: 118px;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: rgba(0, 122, 255, 0.08);
    font-weight: 700;
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
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    background: var(--bg-input);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--primary);
    animation: statusPulse 1.4s ease-in-out infinite;
  }
  @keyframes statusPulse {
    0%, 100% { opacity: 0.35; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  .status.error {
    align-items: flex-start;
    border-color: rgba(220, 38, 38, 0.32);
    background: var(--error-light);
    color: var(--error);
  }
  .callout {
    border-left: 4px solid var(--primary);
    background: var(--info-light);
  }
  .callout.warning {
    border-left-color: var(--warning);
    background: var(--warning-light);
  }
  .code-label {
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .timeline-item {
    position: relative;
    padding-left: 20px;
    padding-bottom: 14px;
    border-left: 2px solid var(--divider);
  }
  .timeline-item:last-child {
    padding-bottom: 0;
  }
  .timeline-item::before {
    content: "";
    position: absolute;
    left: -5px;
    top: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--primary);
  }
  .timeline-date {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
  }
  .timeline-title {
    color: var(--text-primary);
    font-weight: 700;
  }
  .flash-card {
    margin-top: 9px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-page);
    overflow: hidden;
  }
  .flash-card summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    color: var(--text-primary);
    font-weight: 650;
    list-style: none;
    cursor: pointer;
  }
  .flash-card summary::-webkit-details-marker {
    display: none;
  }
  .flash-card summary::after {
    content: "展开";
    flex: 0 0 auto;
    color: var(--primary);
    font-size: 12px;
    font-weight: 700;
  }
  .flash-card[open] summary {
    border-bottom: 1px solid var(--divider);
  }
  .flash-card[open] summary::after {
    content: "收起";
  }
  .flash-card-body {
    padding: 12px;
    color: var(--text-secondary);
  }
  .quiz-question {
    padding: 14px 0;
    border-top: 1px solid var(--divider);
  }
  .quiz-question:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .quiz-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .quiz-prompt {
    flex: 1;
    min-width: 0;
  }
  .difficulty {
    flex: 0 0 auto;
    max-width: 96px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .options {
    display: grid;
    gap: 7px;
    margin-top: 10px;
  }
  .option {
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    color: var(--text-primary);
    text-align: left;
    touch-action: manipulation;
  }
  .option.selected {
    border-color: var(--primary);
    background: var(--primary-light);
  }
  .option.correct {
    border-color: var(--success);
    background: var(--success-light);
  }
  .option.wrong {
    border-color: var(--error);
    background: var(--error-light);
  }
  .option-key {
    flex: 0 0 auto;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .option-text {
    flex: 1;
    min-width: 0;
  }
  .reveal-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
  }
  .reveal {
    min-height: 42px;
    padding: 9px 13px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-card);
    color: var(--text-secondary);
    font-weight: 650;
  }
  .answer-key {
    color: var(--text-secondary);
    font-size: 12px;
  }
  .answer-box,
  .explanation-box {
    margin-top: 8px;
    padding: 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .media {
    display: block;
    width: 100%;
    max-height: 52vh;
    object-fit: contain;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #000;
  }
  .media-link {
    display: inline-flex;
    margin-top: 8px;
    color: var(--primary);
    font-weight: 650;
    text-decoration: none;
  }
  .embedded-frame {
    display: block;
    width: 100%;
    height: clamp(260px, 54vh, 420px);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }
  .figure-caption,
  .media-summary {
    margin-top: 9px;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 22px;
  }
  .chapter-list {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }
  .chapter-item {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 9px;
    border-radius: 7px;
    background: var(--bg-input);
  }
  .chapter-num {
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
  .chapter-title {
    flex: 1;
    color: var(--text-primary);
    font-weight: 650;
    min-width: 0;
  }
  .deep-dive-list {
    display: grid;
    gap: 8px;
  }
  .deep-dive-item .chapter-title {
    font-weight: 700;
  }
  .empty {
    min-height: 46vh;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    color: var(--text-muted);
    text-align: center;
  }
  .empty-title {
    color: var(--text-primary);
    font-size: 19px;
    font-weight: 750;
  }
  @media (max-width: 380px) {
    html, body {
      font-size: 15px;
      line-height: 24px;
    }
    #live-book-root {
      padding-left: 12px;
      padding-right: 12px;
    }
    .page-title {
      font-size: 22px;
      line-height: 29px;
    }
    .block {
      padding: 13px;
    }
    .quiz-head,
    .reveal-row {
      align-items: stretch;
      flex-direction: column;
    }
    .difficulty {
      max-width: none;
      width: fit-content;
    }
    .reveal {
      width: 100%;
    }
    .embedded-frame {
      height: 300px;
    }
  }
  @media (min-width: 600px) {
    #live-book-root {
      padding-left: 24px;
      padding-right: 24px;
    }
    .block {
      padding: 18px;
    }
  }
</style>
</head>
<body>
<main id="live-book-root"></main>
<script id="katex-js">${safeScriptContent(katexJs)}</script>
<script id="live-book-webview-bridge">
(function() {
  var ASSET_BASE = ${jsonForInlineScript(normalizedAssetBaseUrl)};
  var state = {
    bookTitle: "",
    page: null,
    progress: { completedCount: 0, totalPages: 0, progressPercent: 0 }
  };
  var quizState = {};
  var root = document.getElementById("live-book-root");

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

  function attr(value) {
    return escapeHtml(value).replace(/\\n/g, "&#10;");
  }

  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return value == null ? "" : String(value);
  }

  function pickText() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = text(arguments[i]).trim();
      if (value) return value;
    }
    return "";
  }

  function safeHref(value) {
    var href = String(value || "").trim();
    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
    return "#";
  }

  function safeMediaSrc(value) {
    var src = String(value || "").trim();
    if (!src) return "";
    if (/^(https?:|file:|data:|content:|blob:)/i.test(src)) return src;
    var normalized = src.charAt(0) === "/" ? src : "/" + src;
    return ASSET_BASE + normalized;
  }

  function isEscaped(source, index) {
    var count = 0;
    var i = index - 1;
    while (i >= 0 && source[i] === "\\\\") {
      count += 1;
      i -= 1;
    }
    return count % 2 === 1;
  }

  function findClosingDollar(source, start) {
    for (var i = start; i < source.length; i += 1) {
      if (source[i] === "$" && !isEscaped(source, i)) return i;
    }
    return -1;
  }

  function renderMath(formula, displayMode) {
    var source = String(formula || "").trim();
    if (!source) return "";
    if (window.katex && window.katex.renderToString) {
      try {
        var html = window.katex.renderToString(source, {
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
    var escaped = escapeHtml(source);
    return displayMode
      ? '<div class="math-display"><span class="math-fallback">$$' + escaped + "$$</span></div>"
      : '<span class="math-fallback">$' + escaped + "$</span>";
  }

  function renderTextInline(value) {
    var code = [];
    var backtick = String.fromCharCode(96);
    var inlineCodePattern = new RegExp(
      backtick + "([^" + backtick + "\\\\n]+)" + backtick,
      "g"
    );
    var input = String(value || "").replace(inlineCodePattern, function(match, inner) {
      var token = "\\u0000CODE_" + code.length + "\\u0000";
      code.push("<code>" + escapeHtml(inner) + "</code>");
      return token;
    });
    var html = escapeHtml(input);
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function(match, label, href) {
      var url = safeHref(href.replace(/&amp;/g, "&"));
      if (url === "#") return match;
      return '<a href="' + attr(url) + '">' + label + "</a>";
    });
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, "$1<em>$2</em>");
    html = html.replace(/\\u0000CODE_(\\d+)\\u0000/g, function(match, index) {
      return code[Number(index)] || "";
    });
    return html;
  }

  function renderInline(source) {
    var segments = [];
    var lastIndex = 0;
    var i = 0;
    var value = String(source || "");
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

      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      if (trimmed.indexOf(fence) === 0 || trimmed.indexOf(tildeFence) === 0) {
        flushParagraph();
        flushList();
        var activeFence = trimmed.indexOf(fence) === 0 ? fence : tildeFence;
        var language = trimmed.slice(activeFence.length).trim();
        var end = findClosingFence(lines, i, activeFence);
        if (end < 0) {
          html.push('<p class="raw-block">' + escapeHtml(lines.slice(i).join("\\n")).replace(/\\n/g, "<br>") + "</p>");
          break;
        }
        html.push(
          '<pre><code data-lang="' + attr(language) + '">' +
            escapeHtml(lines.slice(i + 1, end).join("\\n")) +
          "</code></pre>"
        );
        i = end;
        continue;
      }

      if (trimmed === "$$" || trimmed.indexOf("$$") === 0) {
        flushParagraph();
        flushList();
        var formulaParts = [];
        var inlineStart = trimmed.indexOf("$$");
        var rest = trimmed.slice(inlineStart + 2);
        var inlineEnd = rest.indexOf("$$");
        if (inlineEnd >= 0) {
          formulaParts.push(rest.slice(0, inlineEnd));
        } else {
          if (rest.trim()) formulaParts.push(rest);
          while (i + 1 < lines.length) {
            i += 1;
            var mathLine = lines[i];
            var mathEnd = mathLine.indexOf("$$");
            if (mathEnd >= 0) {
              formulaParts.push(mathLine.slice(0, mathEnd));
              break;
            }
            formulaParts.push(mathLine);
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
    return '<div class="markdown">' + html.join("\\n") + "</div>";
  }

  function renderTitle(block, fallback) {
    var title = pickText(block && block.title, fallback);
    return title ? '<h2 class="block-title">' + escapeHtml(title) + "</h2>" : "";
  }

  function renderBridge(block) {
    var payload = record(block && block.payload);
    var bridge = pickText(payload.bridge_text, block && block.bridge_text);
    return bridge ? '<p class="bridge">' + escapeHtml(bridge) + "</p>" : "";
  }

  function blockBodyText(block) {
    var payload = record(block && block.payload);
    return pickText(payload.body, payload.content, payload.text, block && block.content);
  }

  function renderTextBlock(block) {
    var body = blockBodyText(block);
    return renderTitle(block, "") + (body ? renderMarkdown(body) : "");
  }

  function renderSectionBlock(block) {
    var payload = record(block && block.payload);
    var html = renderTitle(block, "");
    var intro = pickText(payload.intro, block && block.content);
    var renderedBody = false;
    if (intro) html += renderMarkdown(intro);
    if (intro) renderedBody = true;
    list(payload.subsections).forEach(function(subsection) {
      var item = record(subsection);
      var title = pickText(item.title, item.heading);
      if (title) html += '<h3 class="block-title">' + escapeHtml(title) + "</h3>";
      var body = pickText(item.body, item.content, item.text);
      if (body) html += renderMarkdown(body);
      if (body) renderedBody = true;
    });
    var takeaway = pickText(payload.key_takeaway, payload.takeaway);
    if (takeaway) {
      html += '<div class="callout">' + renderMarkdown(takeaway) + "</div>";
      renderedBody = true;
    }
    if (!renderedBody) html += renderMarkdown(blockBodyText(block));
    return html;
  }

  function renderCalloutBlock(block) {
    var payload = record(block && block.payload);
    var tone = text(payload.tone || payload.kind || "").toLowerCase();
    var label = pickText(payload.label, block && block.title, "提示");
    var body = pickText(payload.body, payload.content, block && block.content);
    return '<div class="callout ' + (tone === "warning" ? "warning" : "") + '">' +
      '<p class="block-kicker">' + escapeHtml(label) + "</p>" +
      (body ? renderMarkdown(body) : "") +
      "</div>";
  }

  function renderCodeBlock(block) {
    var payload = record(block && block.payload);
    var code = pickText(payload.code, block && block.content);
    var language = pickText(payload.language, payload.lang, "code");
    var explanation = pickText(payload.explanation, payload.description);
    return renderTitle(block, "") +
      '<div class="code-label">' + escapeHtml(language) + "</div>" +
      '<pre class="code-pre"><code>' + escapeHtml(code) + "</code></pre>" +
      (explanation ? renderMarkdown(explanation) : "");
  }

  function renderTimelineBlock(block) {
    var payload = record(block && block.payload);
    var events = list(payload.events);
    if (!events.length) return renderTextBlock(block);
    var html = renderTitle(block, "时间线") + '<ol class="timeline">';
    events.forEach(function(event) {
      var item = record(event);
      html += '<li class="timeline-item">' +
        (item.date ? '<div class="timeline-date">' + escapeHtml(item.date) + "</div>" : "") +
        (item.title ? '<div class="timeline-title">' + escapeHtml(item.title) + "</div>" : "") +
        (item.description ? renderMarkdown(item.description) : "") +
      "</li>";
    });
    html += "</ol>";
    return html;
  }

  function renderFlashCardsBlock(block) {
    var payload = record(block && block.payload);
    var cards = list(payload.cards);
    if (!cards.length) return renderTextBlock(block);
    var html = renderTitle(block, "Flash Cards");
    cards.forEach(function(card, index) {
      var item = record(card);
      var front = pickText(item.front, item.question, "Card " + (index + 1));
      var back = pickText(item.back, item.answer);
      var hint = pickText(item.hint);
      html += '<details class="flash-card">' +
        '<summary>' + escapeHtml(front) + "</summary>" +
        '<div class="flash-card-body">' +
        (hint ? '<p><strong>Hint:</strong> ' + escapeHtml(hint) + "</p>" : "") +
        (back ? renderMarkdown(back) : '<p class="raw-block">No answer.</p>') +
        "</div></details>";
    });
    return html;
  }

  function normalizeQuestionType(value) {
    return String(value || "").toLowerCase().replace(/[\\s-]+/g, "_");
  }

  function questionKey(block, question, index) {
    return String(block.id || "block") + ":" + String(question.question_id || index);
  }

  function correctChoiceKey(question) {
    var options = record(question.options);
    var raw = pickText(question.correct_answer, question.answer).trim();
    if (!raw) return "";
    var upper = raw.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(options, upper)) return upper;
    var keys = Object.keys(options);
    for (var i = 0; i < keys.length; i += 1) {
      if (String(options[keys[i]] || "").trim() === raw) return keys[i].toUpperCase();
    }
    return upper;
  }

  function findQuestion(blockId, key) {
    var blocks = list(state.page && state.page.blocks);
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      if (String(block.id || "") !== String(blockId || "")) continue;
      var questions = list(record(block.payload).questions);
      for (var j = 0; j < questions.length; j += 1) {
        var question = record(questions[j]);
        if (questionKey(block, question, j) === key) {
          return { block: block, question: question, index: j };
        }
      }
    }
    return null;
  }

  function renderQuizBlock(block) {
    var payload = record(block && block.payload);
    var questions = list(payload.questions);
    if (!questions.length) return '<p class="raw-block">No quiz questions generated.</p>';
    var html = '<p class="block-kicker">Quick Check</p>';
    questions.forEach(function(rawQuestion, index) {
      var question = record(rawQuestion);
      var key = questionKey(block, question, index);
      var local = quizState[key] || {};
      var options = record(question.options);
      var optionKeys = Object.keys(options);
      var normalizedType = normalizeQuestionType(question.question_type);
      var isChoice = optionKeys.length > 0 && normalizedType !== "written" && normalizedType !== "open_response";
      var correct = correctChoiceKey(question);
      html += '<div class="quiz-question" data-question-key="' + attr(key) + '">' +
        '<div class="quiz-head"><div class="quiz-prompt">' +
        '<strong>' + (index + 1) + ".</strong> " +
        renderMarkdown(pickText(question.question, "(missing)")) +
        '</div>' +
        (question.difficulty ? '<span class="difficulty">' + escapeHtml(question.difficulty) + "</span>" : "") +
        "</div>";
      if (isChoice) {
        html += '<div class="options">';
        optionKeys.forEach(function(optionKey) {
          var upperKey = optionKey.toUpperCase();
          var isSelected = local.selected === upperKey;
          var isCorrect = local.revealed && upperKey === correct;
          var isWrong = local.revealed && isSelected && upperKey !== correct;
          var classes = ["option"];
          if (isSelected) classes.push("selected");
          if (isCorrect) classes.push("correct");
          if (isWrong) classes.push("wrong");
          html += '<button type="button" class="' + classes.join(" ") + '" data-action="quiz-option" data-block-id="' +
            attr(block.id || "") + '" data-question-key="' + attr(key) + '" data-value="' + attr(upperKey) + '">' +
            '<span class="option-key">' + escapeHtml(upperKey) + ".</span>" +
            '<span class="option-text">' + escapeHtml(options[optionKey]) + "</span>" +
            "</button>";
        });
        html += "</div>";
      } else {
        html += '<p class="raw-block">先想一想答案，再查看解析。</p>';
      }
      html += '<div class="reveal-row">' +
        '<button type="button" class="reveal" data-action="quiz-reveal" data-block-id="' +
        attr(block.id || "") + '" data-question-key="' + attr(key) + '">' +
        (local.revealed ? "隐藏答案" : "查看答案") +
        "</button>";
      if (local.revealed && correct && isChoice) {
        html += '<span class="answer-key">答案：<strong>' + escapeHtml(correct) + "</strong></span>";
      }
      html += "</div>";
      var answer = pickText(question.correct_answer, question.answer);
      if (local.revealed && answer && !isChoice) {
        html += '<div class="answer-box"><p class="block-kicker">Answer</p>' + renderMarkdown(answer) + "</div>";
      }
      if (local.revealed && question.explanation) {
        html += '<div class="explanation-box">' + renderMarkdown(question.explanation) + "</div>";
      }
      html += "</div>";
    });
    return html;
  }

  function iframeHtml(content) {
    return '<iframe class="embedded-frame" sandbox="allow-scripts allow-same-origin allow-forms" srcdoc="' +
      attr(content) + '"></iframe>';
  }

  function wrapBareHtml(content) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=yes"><style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,sans-serif}svg,canvas,img{max-width:100%;height:auto}</style></head><body>' +
      content +
      "</body></html>";
  }

  function wrapMermaid(content) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\\/script><script>mermaid.initialize({startOnLoad:true,theme:\\'default\\'});<\\/script><style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif}svg{max-width:100%!important;height:auto!important}</style></head><body><div class="mermaid">' +
      escapeHtml(content) +
      "</div></body></html>";
  }

  function wrapChartJs(code) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4"><\\/script><style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#fff}canvas{width:100%;max-width:100%}</style></head><body><canvas id="chart"></canvas><script>try{' +
      code.replace(/<\\/script/gi, "<\\\\/script") +
      '}catch(e){document.body.insertAdjacentText("beforeend","Chart error: "+e.message)}<\\/script></body></html>';
  }

  function renderFigureBlock(block) {
    var payload = record(block && block.payload);
    var code = record(payload.code);
    var language = String(code.language || "svg").toLowerCase();
    var content = pickText(code.content, payload.content, block && block.content);
    var renderType = String(payload.render_type || language).toLowerCase();
    var description = pickText(payload.description, payload.caption);
    var html = renderTitle(block, "");
    if (!content) {
      html += '<p class="raw-block">(Figure payload is empty)</p>';
    } else if (renderType === "mermaid" || language === "mermaid") {
      html += iframeHtml(wrapMermaid(content));
    } else if (renderType === "chartjs" || language === "chartjs" || language === "javascript") {
      html += iframeHtml(wrapChartJs(content));
    } else if (content.indexOf("<svg") !== -1 || content.indexOf("<") === 0) {
      html += iframeHtml(wrapBareHtml(content));
    } else {
      html += '<pre class="diagram-source">' + escapeHtml(content) + "</pre>";
    }
    if (description) html += renderMarkdown(description);
    return html;
  }

  function renderInteractiveBlock(block) {
    var payload = record(block && block.payload);
    var code = record(payload.code);
    var content = pickText(code.content, payload.html, payload.content);
    var description = pickText(payload.description, block && block.content);
    var html = renderTitle(block, "交互组件");
    if (content) html += iframeHtml(wrapBareHtml(content));
    if (description) html += renderMarkdown(description);
    if (!content && !description) html += '<p class="raw-block">(Interactive payload is empty)</p>';
    return html;
  }

  function firstArtifactUrl(artifacts) {
    for (var i = 0; i < artifacts.length; i += 1) {
      var artifact = record(artifacts[i]);
      if (artifact.url) return String(artifact.url);
    }
    return "";
  }

  function isVideoUrl(url, artifacts) {
    if (/\\.(mp4|webm|mov)(\\?|#|$)/i.test(url)) return true;
    return artifacts.some(function(artifact) {
      return String(record(artifact).content_type || "").indexOf("video/") === 0;
    });
  }

  function renderAnimationBlock(block) {
    var payload = record(block && block.payload);
    var artifacts = list(payload.artifacts);
    var rawUrl = pickText(payload.video_url, payload.image_url, payload.url, firstArtifactUrl(artifacts));
    var assetUrl = safeMediaSrc(rawUrl);
    var summary = pickText(payload.summary, payload.description, block && block.content);
    var html = renderTitle(block, "动画演示");
    if (assetUrl) {
      if (isVideoUrl(assetUrl, artifacts)) {
        html += '<video class="media" controls playsinline preload="metadata" src="' + attr(assetUrl) + '"></video>';
      } else {
        html += '<img class="media" src="' + attr(assetUrl) + '" alt="' + attr(block.title || "media") + '">';
      }
      html += '<a class="media-link" href="' + attr(assetUrl) + '">打开媒体</a>';
    } else {
      html += '<p class="raw-block">(Animation payload is empty)</p>';
    }
    if (summary) html += renderMarkdown(summary);
    return html;
  }

  function renderDeepDiveBlock(block) {
    var payload = record(block && block.payload);
    var suggestions = list(payload.suggestions);
    if (!suggestions.length) return "";
    var html = renderTitle(block, "Go Deeper");
    suggestions.forEach(function(suggestion) {
      var item = record(suggestion);
      var topic = pickText(item.topic, item.title);
      var rationale = pickText(item.rationale, item.description);
      html += '<div class="chapter-item"><span class="chapter-num">+</span><div class="chapter-title">' +
        escapeHtml(topic) +
        (rationale ? '<div class="markdown">' + renderMarkdown(rationale) + "</div>" : "") +
        "</div></div>";
    });
    return html;
  }

  function renderConceptGraphBlock(block) {
    var payload = record(block && block.payload);
    var code = record(payload.code);
    var mermaid = pickText(code.content);
    var index = record(payload.index);
    var chapters = list(index.chapters);
    var html = renderTitle(block, "概念图");
    if (mermaid) html += iframeHtml(wrapMermaid(mermaid));
    var graph = record(payload.graph);
    if (!mermaid && graph.nodes) {
      html += '<pre class="diagram-source">' + escapeHtml(JSON.stringify(graph, null, 2)) + "</pre>";
    }
    if (chapters.length) {
      html += '<div class="chapter-list">';
      chapters.forEach(function(chapter, index) {
        var item = record(chapter);
        html += '<div class="chapter-item">' +
          '<span class="chapter-num">' + String(index + 1).padStart(2, "0") + "</span>" +
          '<span class="chapter-title">' + escapeHtml(item.title || item.id || "Untitled") + "</span>" +
          "</div>";
      });
      html += "</div>";
    }
    return html;
  }

  function renderUnknownBlock(block) {
    var body = blockBodyText(block);
    return renderTitle(block, block && block.type ? "[" + block.type + "]" : "") +
      (body ? renderMarkdown(body) : '<p class="raw-block">[' + escapeHtml(block && block.type || "block") + "] block</p>");
  }

  function renderBlock(block, index) {
    var type = String((block && block.type) || "text");
    var status = String((block && block.status) || "ready");
    if (status === "pending" || status === "generating") {
      return '<section class="block status"><span class="status-dot"></span><span>正在生成 ' +
        escapeHtml((block && (block.title || block.type)) || "内容") +
        "...</span></section>";
    }
    if (status === "error") {
      return '<section class="block status error"><span class="status-dot"></span><div><strong>' +
        escapeHtml(type) +
        " block failed</strong><br>" +
        escapeHtml((block && block.error) || "Unknown error") +
        "</div></section>";
    }
    var body = "";
    if (type === "text") body = renderTextBlock(block);
    else if (type === "section") body = renderSectionBlock(block);
    else if (type === "callout") body = renderCalloutBlock(block);
    else if (type === "code") body = renderCodeBlock(block);
    else if (type === "timeline") body = renderTimelineBlock(block);
    else if (type === "flash_cards") body = renderFlashCardsBlock(block);
    else if (type === "quiz") body = renderQuizBlock(block);
    else if (type === "figure") body = renderFigureBlock(block);
    else if (type === "interactive") body = renderInteractiveBlock(block);
    else if (type === "animation") body = renderAnimationBlock(block);
    else if (type === "deep_dive") body = renderDeepDiveBlock(block);
    else if (type === "concept_graph") body = renderConceptGraphBlock(block);
    else body = renderUnknownBlock(block);

    if (!String(body || "").trim()) return "";
    var plain = type === "text" || type === "section";
    return '<section class="block ' + (plain ? "block-plain" : "") + '" data-block-index="' + index + '" data-block-id="' +
      attr((block && block.id) || "") + '">' +
      renderBridge(block) +
      body +
      "</section>";
  }

  function renderAll() {
    var page = state.page;
    if (!page) {
      root.innerHTML = '<div class="empty"><div class="empty-title">正在准备活书</div><div>页面内容加载中...</div></div>';
      return;
    }
    var progress = state.progress || {};
    var percent = Math.max(0, Math.min(100, Number(progress.progressPercent) || 0));
    var blocks = list(page.blocks);
    var html = '<div class="progress-card">' +
      '<div class="progress-row"><span>阅读进度</span><span>' +
      escapeHtml(progress.completedCount || 0) + " / " + escapeHtml(progress.totalPages || 0) +
      "</span></div>" +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + percent + '%"></div></div>' +
      "</div>";
    html += '<h1 class="page-title">' + escapeHtml(page.title || "未命名页面") + "</h1>";
    if (!blocks.length) {
      html += '<div class="empty"><div class="empty-title">暂无页面内容</div><div>当前页面还没有可显示的块。</div></div>';
    } else {
      html += blocks.map(renderBlock).join("");
    }
    root.innerHTML = html;
  }

  function handleOption(target) {
    var blockId = target.getAttribute("data-block-id") || "";
    var key = target.getAttribute("data-question-key") || "";
    var value = target.getAttribute("data-value") || "";
    var local = quizState[key] || {};
    local.selected = value;
    quizState[key] = local;
    renderAll();
  }

  function handleReveal(target) {
    var blockId = target.getAttribute("data-block-id") || "";
    var key = target.getAttribute("data-question-key") || "";
    var local = quizState[key] || {};
    local.revealed = !local.revealed;
    quizState[key] = local;
    if (local.revealed && local.selected && !local.reported) {
      var found = findQuestion(blockId, key);
      if (found) {
        var correct = correctChoiceKey(found.question);
        local.reported = true;
        post({
          type: "quiz_attempt",
          blockId: blockId,
          questionId: String(found.question.question_id || ""),
          userAnswer: local.selected,
          isCorrect: String(local.selected).toUpperCase() === correct
        });
      }
    }
    renderAll();
  }

  window.__ANOTHERME_LIVE_BOOK_WEBVIEW_EVENT = function(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "set_page") {
      var previousPageId = state.page && state.page.id;
      var nextPageId = event.page && event.page.id;
      state.bookTitle = String(event.bookTitle || "");
      state.page = event.page || null;
      state.progress = event.progress || state.progress;
      if (String(previousPageId || "") !== String(nextPageId || "")) {
        quizState = {};
      }
      renderAll();
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
    if (action === "quiz-option") {
      handleOption(target);
      return;
    }
    if (action === "quiz-reveal") {
      handleReveal(target);
    }
  });

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
