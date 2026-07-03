import React, { useMemo, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "../../lib/types";
import { colors } from "../../lib/theme";
import { debugLog, reportDebugEvent } from "../../lib/debug";
import {
  normalizeMarkdownForDisplay,
  hasVisibleMarkdownContent,
} from "../../lib/latex-utils";
import {
  ARCHIVED_FINAL_PREVIEW_CHARS,
  shouldTruncateLightweightFinal,
} from "../../lib/message-render-policy";
import { MessageBubbleShell } from "./MessageBubbleShell";
import { StreamingMathRenderer } from "./StreamingMathRenderer";
import { useSmoothStreamText } from "../../hooks/useSmoothStreamText";

/**
 * 从消息文本中移除裸 URL（单独占一行的网址），
 * 避免在消息下方显示网址链接
 */
function stripBareUrls(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !/^https?:\/\/[^\s<>)\]]+$/.test(trimmed);
    })
    .join("\n")
    .trim();
}

// 流式期间 live preview 的上限，避免 flush 时卡顿。
const STREAMING_PREVIEW_LIMIT = 16000;

interface MessageContentRendererProps {
  message: Message;
  showFullText: boolean;
  onToggleFullText: () => void;
  onLoadFullContent?: (message: Message) => void;
  preferWebViewMarkdown?: boolean;
}

export function MessageContentRenderer({
  message,
  showFullText,
  onToggleFullText,
  onLoadFullContent,
  preferWebViewMarkdown: _preferWebViewMarkdown = false,
}: MessageContentRendererProps) {
  const remotePreviewOnly =
    message.historyPreviewOnly || message.storagePreviewOnly;

  // 显示内容优先级：
  //   1. 流式期间：使用 contentPreview（避免 state.content 持续增长导致重渲染），兜底 content
  //   2. 历史/存储 preview：使用 contentPreview，并提供"加载完整内容"
  //   3. 普通最终消息：直接使用完整 content（chatSlice 已在流结束时清除 preview 标记）
  const displayContent = message.isStreaming
    ? message.contentPreview || message.content
    : remotePreviewOnly
      ? message.contentPreview || message.content
      : message.content;

  const assistantContent = useMemo(() => {
    return stripBareUrls(displayContent);
  }, [displayContent]);

  // 借鉴 DeepTutor：显示前统一归一化 Markdown，清理零宽字符、空 HTML 块、
  // 非法伪 HTML 标签等，减少解析器异常和渲染抖动。
  const normalizedContent = useMemo(() => {
    return normalizeMarkdownForDisplay(assistantContent);
  }, [assistantContent]);

  // 借鉴 DeepTutor useSmoothStreamText：把后端推送频率和 UI 渲染频率解耦，
  // 流式期间按帧逐步 reveal 内容，避免突发大 chunk 导致 RN 卡顿。
  const streamingContent = useSmoothStreamText(
    normalizedContent,
    Boolean(message.isStreaming),
    {
      maxCharsPerFrame: 80,
      minCharsPerFrame: 2,
      catchUpDivisor: 5,
      enabled: true,
    },
  );

  const renderContent = message.isStreaming
    ? streamingContent
    : normalizedContent;

  const hasContent = hasVisibleMarkdownContent(renderContent);

  // ChatBubble 走原生轻量渲染，避免每条消息都创建 WebView。
  const shouldRenderMarkdown = hasVisibleMarkdownContent(normalizedContent);
  const shouldUseWebViewMarkdown = false;
  const shouldTruncateFinalLightweight =
    shouldRenderMarkdown &&
    shouldTruncateLightweightFinal(normalizedContent, {
      usingWebView: shouldUseWebViewMarkdown,
      forceFullText: showFullText,
    });
  // 轻量渲染时是否需要截断：流式消息截断 live preview，旧最终消息截断
  // archived preview，用户可按需切到完整排版。
  const lightweightShouldTruncate =
    (message.isStreaming && renderContent.length > STREAMING_PREVIEW_LIMIT) ||
    shouldTruncateFinalLightweight;
  const lightweightLimit = message.isStreaming
    ? STREAMING_PREVIEW_LIMIT
    : ARCHIVED_FINAL_PREVIEW_CHARS;

  useEffect(() => {
    if (
      message.isStreaming ||
      normalizedContent.length > 1000 ||
      message.contentPreview
    ) {
      debugLog("MessageContentRenderer", "render_decision", {
        id: message.id,
        isStreaming: message.isStreaming,
        displayChars: displayContent.length,
        normalizedChars: normalizedContent.length,
        renderedChars: renderContent.length,
        previewChars: message.contentPreview?.length || 0,
        contentLength: message.contentLength,
        shouldRenderMarkdown,
        shouldUseWebViewMarkdown,
        preferWebViewMarkdown: _preferWebViewMarkdown,
        remotePreviewOnly,
      });
      // #region debug-point C:renderer-decision
      reportDebugEvent(
        "C",
        "MessageContentRenderer.tsx:render_decision",
        "renderer decision",
        {
          id: message.id,
          isStreaming: message.isStreaming,
          displayChars: displayContent.length,
          normalizedChars: normalizedContent.length,
          renderedChars: renderContent.length,
          previewChars: message.contentPreview?.length || 0,
          contentLength: message.contentLength,
          shouldRenderMarkdown,
          shouldUseWebViewMarkdown,
          preferWebViewMarkdown: _preferWebViewMarkdown,
          remotePreviewOnly,
        },
      );
      // #endregion
    }
  }, [
    message.id,
    message.isStreaming,
    message.contentPreview,
    message.contentLength,
    displayContent.length,
    normalizedContent.length,
    renderContent.length,
    shouldRenderMarkdown,
    shouldUseWebViewMarkdown,
    _preferWebViewMarkdown,
    remotePreviewOnly,
  ]);

  return (
    <MessageBubbleShell variant="assistant">
      {hasContent ? (
        <View>
          <StreamingMathRenderer
            content={
              lightweightShouldTruncate
                ? renderContent.slice(0, lightweightLimit)
                : renderContent
            }
            color={colors.textPrimary}
            maxVisibleChars={
              message.isStreaming
                ? STREAMING_PREVIEW_LIMIT
                : Math.max(renderContent.length, lightweightLimit)
            }
            showFromStart
          />
          {lightweightShouldTruncate ? (
            <Text style={styles.heavyMessageHint}>
              {message.isStreaming
                ? "内容较长，当前仅渲染预览，完整内容仍在生成…"
                : "已用轻量模式显示预览，减少长会话内存占用。"}
            </Text>
          ) : null}
          {!message.isStreaming && shouldTruncateFinalLightweight ? (
            <TouchableOpacity
              style={styles.fullRenderButton}
              onPress={onToggleFullText}
            >
              <Text style={styles.fullRenderButtonText}>完整排版</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : message.isStreaming && !message.reasoning ? (
        <View style={styles.thinkingRow}>
          <Ionicons name="sparkles" size={14} color={colors.warning} />
          <Text style={styles.thinkingText}>正在思考</Text>
          <View style={styles.thinkingDots}>
            <Text style={styles.thinkingDot}>·</Text>
            <Text style={[styles.thinkingDot, { opacity: 0.6 }]}>·</Text>
            <Text style={[styles.thinkingDot, { opacity: 0.3 }]}>·</Text>
          </View>
        </View>
      ) : !message.isStreaming ? (
        <Text style={styles.emptyAssistantText}>
          这条回复没有可显示内容，请重试。
        </Text>
      ) : null}
      {message.isStreaming && hasVisibleMarkdownContent(renderContent) ? (
        <Text style={styles.cursor}>▊</Text>
      ) : null}
      {remotePreviewOnly && onLoadFullContent ? (
        <TouchableOpacity
          style={styles.expandTextButton}
          onPress={() => onLoadFullContent(message)}
        >
          <Text style={styles.expandTextButtonText}>加载完整内容</Text>
        </TouchableOpacity>
      ) : null}
    </MessageBubbleShell>
  );
}

const styles = StyleSheet.create({
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  thinkingText: {
    color: colors.reasoningText,
    fontSize: 14,
    fontWeight: "500",
  },
  thinkingDots: {
    flexDirection: "row",
    gap: 1,
  },
  thinkingDot: {
    color: colors.warning,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 18,
  },
  cursor: {
    color: colors.lavender,
    fontWeight: "bold",
    fontSize: 14,
    marginTop: 2,
  },
  heavyMessageHint: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
  },
  fullRenderButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.primaryLight,
  },
  fullRenderButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  expandTextButton: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  expandTextButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "500",
  },
  emptyAssistantText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontStyle: "italic",
  },
});
