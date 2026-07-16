import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "../../../lib/theme";
import { RenderDebugBoundary } from "../../RenderDebugBoundary";

interface WebViewBlockProps {
  html: string;
  height?: number;
}

/**
 * 沙箱 WebView 包装器，用于渲染 Figure/Interactive/ConceptGraph。
 * 注入 HTML 内容，禁用滚动和缩放，自适应高度。
 */
export default function WebViewBlock({
  html,
  height = 320,
}: WebViewBlockProps) {
  const source = useMemo(() => ({ html: wrapHtml(html) }), [html]);

  return (
    <RenderDebugBoundary
      name="WebViewBlock"
      meta={{ htmlLength: html.length }}
      fallback={
        <View style={[styles.container, { height, justifyContent: "center", alignItems: "center" }]}>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            交互内容加载失败
          </Text>
        </View>
      }
    >
      <View style={[styles.container, { height }]}>
        <WebView
          source={source}
          style={styles.webview}
          scrollEnabled={false}
          javaScriptEnabled
          originWhitelist={["*"]}
          allowsInlineMediaPlayback
          mixedContentMode="compatibility"
        />
      </View>
    </RenderDebugBoundary>
  );
}

/**
 * 将内容包装为完整的 HTML 页面，设置安全策略和自适应样式。
 */
function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: transparent;
    color-scheme: light dark;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  #app { padding: 8px; }
</style>
</head>
<body>
<div id="app">
${body}
</div>
</body>
</html>`;
}

/** 辅助：生成注入 Chart.js 的 HTML */
export function wrapChartJsHtml(code: string, type: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4"></script>
<style>
  * { margin:0; padding:0; }
  body { background:transparent; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  #chart { width:100%; max-width:100%; }
</style>
</head>
<body>
<canvas id="chart"></canvas>
<script>
try {
  ${code}
} catch(e) {
  document.getElementById('chart').insertAdjacentText('afterend', 'Chart error: ' + e.message);
}
</script>
</body>
</html>`;
}

/** 辅助：生成注入 Mermaid 的 HTML */
export function wrapMermaidHtml(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'default'});</script>
<style>
  * { margin:0; padding:0; }
  body { background:transparent; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:8px; }
  svg { max-width:100% !important; height:auto !important; }
</style>
</head>
<body>
<div class="mermaid">
${content}
</div>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
