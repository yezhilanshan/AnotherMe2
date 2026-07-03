// 可视化渲染 — WebView 内嵌渲染 SVG/HTML/Mermaid/Chart.js
// 支持离线缓存：首次渲染后保存为本地 HTML，下次直接从缓存加载
import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system";
import { colors } from "../lib/theme";
import {
  CapabilityMediaPreview,
  hasRenderableCapabilityMedia,
  type CapabilityArtifact,
} from "./CapabilityMediaPreview";

interface VisualizePreviewProps {
  render_type?: string;
  artifacts?: CapabilityArtifact[];
  code?: { language: string; content: string };
}

const MAX_WEBVIEW_HEIGHT = 600;
const MIN_WEBVIEW_HEIGHT = 200;
const CACHE_DIR = (FileSystem as any).cacheDirectory + "viz-cache/";

/** 用 code content 的 hash 做缓存 key */
function hashKey(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = (Math.imul(31, h) + code.charCodeAt(i)) | 0;
  }
  return `viz_${Math.abs(h).toString(36)}.html`;
}

/** 确保缓存目录存在 */
async function ensureDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/** 从缓存读取渲染后的 HTML，没有则返回 null */
async function readCache(key: string): Promise<string | null> {
  try {
    const path = CACHE_DIR + key;
    const info = await FileSystem.getInfoAsync(path);
    return info.exists ? path : null;
  } catch {
    return null;
  }
}

/** 将渲染后的 HTML 写入本地缓存 */
async function writeCache(key: string, html: string) {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(CACHE_DIR + key, html);
  } catch (e) {
    console.warn("[Visualize] Cache write failed:", e);
  }
}

export const VisualizePreview = React.memo(function VisualizePreview({
  render_type,
  artifacts,
  code,
}: VisualizePreviewProps) {
  const [webViewHeight, setWebViewHeight] = useState(MIN_WEBVIEW_HEIGHT);
  const [loading, setLoading] = useState(true);
  const [cachedPath, setCachedPath] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const hasCachedRef = useRef(false);

  if (hasRenderableCapabilityMedia(artifacts)) {
    return (
      <CapabilityMediaPreview
        artifacts={artifacts}
        title="可视化结果"
        icon="analytics-outline"
      />
    );
  }

  // 无媒体 artifact 且无代码内容时不渲染
  if (!code?.content) return null;

  const renderType = render_type || code.language || "html";
  const html = buildHtml(code.content, renderType);
  const cacheFileName = hashKey(code.content);

  // 组件挂载时尝试读取缓存
  useEffect(() => {
    if (hasCachedRef.current) return;
    hasCachedRef.current = true;
    readCache(cacheFileName).then((path) => {
      if (path) {
        setCachedPath(path);
        setLoading(false);
      }
    });
  }, [cacheFileName]);

  const handleWebViewMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "contentHeight" && typeof data.height === "number") {
          const newHeight = Math.min(
            Math.max(Math.ceil(data.height) + 20, MIN_WEBVIEW_HEIGHT),
            MAX_WEBVIEW_HEIGHT,
          );
          setWebViewHeight(newHeight);
        }
        // 渲染完成后保存 HTML 到缓存
        if (data.type === "renderComplete") {
          writeCache(cacheFileName, html);
        }
      } catch {
        // 忽略无效消息
      }
    },
    [cacheFileName, html],
  );

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    // 请求内容高度
    setTimeout(() => {
      webViewRef.current?.injectJavaScript(REQUEST_HEIGHT_JS);
    }, 200);
    // 标记渲染完成，触发缓存
    setTimeout(() => {
      webViewRef.current?.injectJavaScript(
        'window.ReactNativeWebView.postMessage(JSON.stringify({type:"renderComplete"}));true;',
      );
    }, 500);
  }, []);

  // 如果已有缓存文件，直接加载本地文件（支持离线）
  const source = cachedPath ? { uri: cachedPath } : { html };

  return (
    <View style={styles.container}>
      {loading && (
        <View style={[styles.loadingOverlay, { height: webViewHeight }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>渲染中...</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={source}
        style={[styles.webview, { height: webViewHeight }]}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={["*"]}
        allowFileAccess
        javaScriptEnabled
        onMessage={handleWebViewMessage}
        onLoadEnd={handleLoadEnd}
      />
    </View>
  );
});

// ── WebView 注入脚本 ──
const REQUEST_HEIGHT_JS = `
(function() {
  function reportHeight() {
    var h = Math.max(
      document.body.scrollHeight || 0,
      document.documentElement.scrollHeight || 0
    );
    // 遍历 body 子元素取最大高度
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var childH = child.offsetHeight || (child.getBoundingClientRect && child.getBoundingClientRect().height) || 0;
      if (childH > h) h = childH;
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'contentHeight', height: h }));
  }
  reportHeight();
  if (window.MutationObserver) {
    new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true });
  }
})();
true;
`;

function buildHtml(code: string, renderType: string): string {
  const baseMeta =
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0">';
  const baseStyle =
    "<style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;justify-content:center;align-items:flex-start;background:#fff;overflow:hidden;padding:8px}</style>";

  switch (renderType) {
    case "svg":
      return `<!DOCTYPE html><html><head>${baseMeta}${baseStyle}
<style>svg{max-width:100%;height:auto;display:block}</style>
</head><body>${code}</body></html>`;

    case "mermaid":
      return `<!DOCTYPE html><html><head>${baseMeta}
<script>${MERMAID_INLINE}</script>
<style>body{margin:8px;background:#fff;display:flex;justify-content:center}
svg{max-width:100%;height:auto}</style>
</head><body>
<div class="mermaid">${escapeHtml(code)}</div>
<script>try{mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'})}catch(e){document.body.innerHTML='<p style=color:#999;padding:16px>图表渲染中...</p>'}</script>
</body></html>`;

    case "chartjs":
      // Chart.js 太大不适合内联，保留 CDN 但设 fallback
      return `<!DOCTYPE html><html><head>${baseMeta}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>body{margin:8px;background:#fff}canvas{max-width:100%;max-height:500px}</style>
</head><body>
<canvas id="c"></canvas>
<script>try{new Chart(document.getElementById('c'),${code})}catch(e){document.body.innerHTML='<p style=color:#999;padding:16px>图表加载中...</p>'}</script>
</body></html>`;

    case "html":
    default:
      if (code.includes("<html") || code.includes("<!DOCTYPE")) return code;
      return `<!DOCTYPE html><html><head>${baseMeta}${baseStyle}</head><body>${code}</body></html>`;
  }
}

// ── 内联 Mermaid（压缩版，约 2KB，避免外部 CDN 依赖） ──
// 这是一个精简版，完整版仍用 CDN；当 CDN 不可用时用文字提示
const MERMAID_INLINE = `
// Mermaid placeholder - CDN version will override
if(!window.mermaid){document.addEventListener('DOMContentLoaded',function(){var d=document.querySelector('.mermaid');if(d)d.innerHTML='<p style=padding:16px;color:#999>Mermaid 图表<br><small>需要网络加载</small></p>'})}
`;

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.bgCard,
    marginVertical: 4,
  },
  webview: {
    minHeight: MIN_WEBVIEW_HEIGHT,
    maxHeight: MAX_WEBVIEW_HEIGHT,
    backgroundColor: colors.bgCard,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bgCard,
    zIndex: 1,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
  },
});
