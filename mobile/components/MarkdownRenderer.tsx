import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { colors } from "../lib/theme";
import { RenderDebugBoundary } from "./RenderDebugBoundary";

interface MarkdownRendererProps {
  content: string;
  color?: string;
  isStreaming?: boolean;
}

const MIN_HEIGHT = 36;
const MAX_HEIGHT = 4800;
const BODY_FONT_SIZE = 15;
const BODY_LINE_HEIGHT = 22;

function clampHeight(value: number): number {
  if (!Number.isFinite(value)) return MIN_HEIGHT;
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(value)));
}

function normalizeContent(value: string): string {
  return String(value || "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/<\/?(think|reasoning|analysis)>/gi, "")
    .trim();
}

function estimateHeight(markdown: string): number {
  if (!markdown.trim()) return MIN_HEIGHT;
  const lines = markdown.split(/\r?\n/);
  let visualLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      visualLines += 0.45;
    } else if (/^```/.test(trimmed)) {
      visualLines += 1.2;
    } else if (/^#{1,6}\s+/.test(trimmed)) {
      visualLines += 1.65;
    } else if (/^(\$\$|\\\[)/.test(trimmed)) {
      visualLines += 1.8;
    } else {
      visualLines += Math.max(1, Math.ceil(trimmed.length / 28));
    }
  }
  return clampHeight(visualLines * BODY_LINE_HEIGHT + 22);
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
  return colors.textPrimary;
}

function buildMarkdownHtml(markdown: string, color: string): string {
  const theme = {
    text: cssColor(color),
    muted: colors.textMuted,
    primary: colors.primary,
    primaryDark: colors.primaryDark,
    primaryLight: colors.primaryLight,
    bgInput: colors.bgInput,
    border: colors.border,
    quoteBg: colors.quoteBg,
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: ${theme.text};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: ${BODY_FONT_SIZE}px;
    line-height: ${BODY_LINE_HEIGHT}px;
    -webkit-text-size-adjust: 100%;
  }
  body { overflow: hidden; }
  #app { width: 100%; padding: 1px 0 3px; overflow-wrap: anywhere; word-break: break-word; }
  p { margin: 0 0 9px; }
  p:last-child { margin-bottom: 0; }
  h1, h2, h3, h4, h5, h6 {
    margin: 14px 0 7px;
    color: ${theme.text};
    font-weight: 700;
    line-height: 1.28;
  }
  h1 { font-size: 1.38em; }
  h2 { font-size: 1.24em; }
  h3 { font-size: 1.13em; }
  h4, h5, h6 { font-size: 1.04em; }
  a { color: ${theme.primary}; text-decoration: underline; }
  ul, ol { margin: 0 0 9px 21px; padding: 0; }
  li { margin: 4px 0; padding-left: 2px; }
  blockquote {
    margin: 8px 0 9px;
    padding: 8px 10px;
    border-left: 4px solid ${theme.primary};
    background: ${theme.quoteBg};
    border-radius: 6px;
    color: ${theme.muted};
  }
  pre {
    margin: 8px 0 9px;
    padding: 10px 12px;
    overflow-x: auto;
    border-radius: 8px;
    background: ${theme.bgInput};
    color: ${theme.primaryDark};
    -webkit-overflow-scrolling: touch;
  }
  code, .math-inline, .math-display {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
  }
  :not(pre) > code {
    padding: 2px 5px;
    border-radius: 4px;
    background: ${theme.bgInput};
    color: ${theme.primaryDark};
  }
  .math-display {
    margin: 9px 0;
    padding: 8px 10px;
    overflow-x: auto;
    border-radius: 8px;
    background: ${theme.bgInput};
    color: ${theme.primaryDark};
    white-space: pre;
  }
  .table-wrap { width: 100%; overflow-x: auto; margin: 8px 0 9px; }
  table { min-width: 100%; border-collapse: collapse; border: 1px solid ${theme.border}; }
  th, td { border: 1px solid ${theme.border}; padding: 7px 9px; text-align: left; vertical-align: top; }
  th { background: ${theme.primaryLight}; font-weight: 700; }
  hr { height: 1px; border: 0; background: ${theme.border}; margin: 12px 0; }
</style>
</head>
<body>
<main id="app"></main>
<script>
(function() {
  var markdown = ${jsonForInlineScript(markdown)};
  var app = document.getElementById("app");

  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
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
    return /^(https?:|mailto:|tel:)/i.test(href) ? href : "#";
  }

  function renderInline(text) {
    var code = [];
    var tick = String.fromCharCode(96);
    var inlineCodePattern = new RegExp(
      tick + "([^" + tick + "\\\\n]+)" + tick,
      "g"
    );
    var value = String(text || "").replace(inlineCodePattern, function(match, inner) {
      var token = "\\u0000CODE_" + code.length + "\\u0000";
      code.push("<code>" + escapeHtml(inner) + "</code>");
      return token;
    });
    var html = escapeHtml(value);
    html = html.replace(/\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g, function(match, label, href) {
      var url = safeHref(href.replace(/&amp;/g, "&"));
      if (url === "#") return match;
      return '<a href="' + escapeHtml(url) + '">' + label + "</a>";
    });
    html = html.replace(/\\$([^$\\n]{1,300})\\$/g, function(match, formula) {
      return '<span class="math-inline">$' + formula + "$</span>";
    });
    html = html.replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, "$1<em>$2</em>");
    html = html.replace(/\\u0000CODE_(\\d+)\\u0000/g, function(match, index) {
      return code[Number(index)] || "";
    });
    return html;
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

  function renderMarkdown(source) {
    var lines = String(source || "").replace(/\\r\\n/g, "\\n").split("\\n");
    var html = [];
    var paragraph = [];
    var listItems = [];
    var orderedList = false;
    var fence = String.fromCharCode(96, 96, 96);

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push("<p>" + renderInline(paragraph.join(" ")) + "</p>");
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
      var raw = lines[i];
      var trimmed = raw.trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      if (trimmed.indexOf(fence) === 0) {
        flushParagraph();
        flushList();
        var lang = trimmed.slice(3).trim();
        var code = [];
        i += 1;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) {
          code.push(lines[i]);
          i += 1;
        }
        html.push("<pre><code>" + escapeHtml(code.join("\\n")) + "</code></pre>");
        continue;
      }

      if ((trimmed === "$$" || trimmed.indexOf("$$") === 0) && trimmed.lastIndexOf("$$") !== 0) {
        flushParagraph();
        flushList();
        html.push('<div class="math-display">' + escapeHtml(trimmed.replace(/^\\$\\$|\\$\\$$/g, "").trim()) + "</div>");
        continue;
      }

      if (trimmed === "$$" || trimmed === "\\\\[") {
        flushParagraph();
        flushList();
        var close = trimmed === "$$" ? "$$" : "\\\\]";
        var formula = [];
        i += 1;
        while (i < lines.length && lines[i].trim() !== close) {
          formula.push(lines[i]);
          i += 1;
        }
        html.push('<div class="math-display">' + escapeHtml(formula.join("\\n").trim()) + "</div>");
        continue;
      }

      if (i + 1 < lines.length && trimmed.indexOf("|") !== -1 && isTableSeparator(lines[i + 1])) {
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

  function postHeight() {
    var height = Math.max(
      app ? app.scrollHeight : 0,
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    post({ type: "height", height: height });
  }

  try {
    app.innerHTML = renderMarkdown(markdown);
  } catch (error) {
    app.textContent = markdown;
  }
  document.addEventListener("click", function(event) {
    var target = event.target;
    while (target && target !== document && target.tagName !== "A") {
      target = target.parentNode;
    }
    if (!target || target === document) return;
    event.preventDefault();
    post({ type: "link", href: target.href });
  });
  requestAnimationFrame(postHeight);
  setTimeout(postHeight, 60);
})();
</script>
</body>
</html>`;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  color = colors.textPrimary,
  isStreaming = false,
}: MarkdownRendererProps) {
  const normalized = useMemo(() => normalizeContent(content), [content]);
  const initialHeight = useMemo(() => estimateHeight(normalized), [normalized]);
  const [height, setHeight] = useState(initialHeight);
  const [contentScrollEnabled, setContentScrollEnabled] = useState(
    initialHeight >= MAX_HEIGHT,
  );
  const [webViewFailed, setWebViewFailed] = useState(false);

  useEffect(() => {
    setHeight(initialHeight);
    setContentScrollEnabled(initialHeight >= MAX_HEIGHT);
    setWebViewFailed(false);
  }, [initialHeight, normalized]);

  const html = useMemo(
    () => buildMarkdownHtml(normalized, color),
    [color, normalized],
  );
  const source = useMemo(() => ({ html }), [html]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        height?: number;
        href?: string;
      };
      if (payload.type === "height" && typeof payload.height === "number") {
        const measuredHeight = payload.height;
        setContentScrollEnabled(measuredHeight > MAX_HEIGHT);
        setHeight((current) => {
          const next = clampHeight(measuredHeight + 4);
          return Math.abs(next - current) > 2 ? next : current;
        });
      } else if (payload.type === "link" && typeof payload.href === "string") {
        Linking.openURL(payload.href).catch(() => {});
      }
    } catch {
      // Ignore unrelated WebView messages.
    }
  }, []);

  if (!normalized) return null;

  if (isStreaming || webViewFailed) {
    return (
      <View style={styles.textFallback}>
        <Text style={[styles.fallbackText, { color } as StyleProp<TextStyle>]}>
          {normalized}
        </Text>
      </View>
    );
  }

  return (
    <RenderDebugBoundary
      name="MarkdownWebView"
      meta={{ chars: normalized.length }}
      fallback={
        <View style={styles.textFallback}>
          <Text style={[styles.fallbackText, { color }]}>{normalized}</Text>
        </View>
      }
    >
      <View style={[styles.webViewFrame, { height } as StyleProp<ViewStyle>]}>
        <WebView
          source={source}
          style={styles.webView}
          containerStyle={styles.webViewContainer}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled={false}
          scrollEnabled={contentScrollEnabled}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          setSupportMultipleWindows={false}
          onMessage={handleMessage}
          onError={() => setWebViewFailed(true)}
        />
      </View>
    </RenderDebugBoundary>
  );
});

const styles = StyleSheet.create({
  webViewFrame: {
    width: "100%",
    minHeight: MIN_HEIGHT,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  webViewContainer: {
    backgroundColor: "transparent",
  },
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  textFallback: {
    width: "100%",
  },
  fallbackText: {
    fontSize: BODY_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
  },
});

export default MarkdownRenderer;
