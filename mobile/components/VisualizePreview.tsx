import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface VisualizePreviewProps {
  render_type?: string;
  code?: { language: string; content: string };
}

/**
 * 可视化渲染 — WebView 内嵌渲染 SVG / HTML / Mermaid / Chart.js
 * 不展示代码，只展示最终可视化结果
 */
export const VisualizePreview = React.memo(function VisualizePreview({
  render_type,
  code,
}: VisualizePreviewProps) {
  if (!code?.content) return null;

  const renderType = render_type || code.language || 'html';
  const html = buildHtml(code.content, renderType);

  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={['*']}
        javaScriptEnabled
      />
    </View>
  );
});

function buildHtml(code: string, renderType: string): string {
  const baseMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0">';
  const baseStyle = '<style>*{margin:0;padding:0}body{display:flex;justify-content:center;background:#fff;overflow:hidden}</style>';

  switch (renderType) {
    case 'svg':
      return `<!DOCTYPE html><html><head>${baseMeta}${baseStyle}</head><body>${code}</body></html>`;

    case 'mermaid':
      return `<!DOCTYPE html><html><head>${baseMeta}
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>body{margin:8px;background:#fff;display:flex;justify-content:center}</style>
</head><body>
<div class="mermaid">${escapeHtml(code)}</div>
<script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'})</script>
</body></html>`;

    case 'chartjs':
      return `<!DOCTYPE html><html><head>${baseMeta}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>body{margin:8px;background:#fff}canvas{max-width:100%;max-height:260px}</style>
</head><body>
<canvas id="c"></canvas>
<script>try{new Chart(document.getElementById('c'),${code})}catch(e){document.body.innerHTML='<p style="color:#999;padding:16px">图表加载中...</p>'}</script>
</body></html>`;

    case 'html':
    default:
      if (code.includes('<html') || code.includes('<!DOCTYPE')) return code;
      return `<!DOCTYPE html><html><head>${baseMeta}${baseStyle}</head><body>${code}</body></html>`;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e8e8e8',
    backgroundColor: '#fff',
    marginVertical: 4,
  },
  webview: {
    height: 280,
    backgroundColor: '#fff',
  },
});
