import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Message } from '../lib/types';
import { FeedbackButtons } from './FeedbackButtons';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ReasoningBlock } from './ReasoningBlock';
import { SourcesBlock } from './SourcesBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { MathAnimatorPreview } from './MathAnimatorPreview';
import { VisualizePreview } from './VisualizePreview';
import { WebPreview, WebPreviewButton } from './WebPreview';

interface ChatBubbleProps {
  message: Message;
  onFeedback?: (messageId: string, rating: 'like' | 'dislike') => void;
}

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>)\]]+/g;
  return text.match(urlRegex) || [];
}

const timeCache = new Map<number, string>();
function formatTime(ts: number): string {
  let cached = timeCache.get(ts);
  if (!cached) {
    cached = new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    timeCache.set(ts, cached);
    if (timeCache.size > 200) {
      const first = timeCache.keys().next().value;
      if (first !== undefined) timeCache.delete(first);
    }
  }
  return cached;
}

export const ChatBubble = React.memo(function ChatBubble({ message, onFeedback }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const urls = useMemo(
    () => (!isUser && !message.isStreaming ? extractUrls(message.content) : []),
    [isUser, message.isStreaming, message.content],
  );
  const timeStr = useMemo(() => formatTime(message.timestamp), [message.timestamp]);

  if (isUser) {
    // ── 用户消息 ──
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
        <Text style={styles.userTime}>{timeStr}</Text>
      </View>
    );
  }

  // ── 助手消息 ──
  return (
    <View style={styles.assistantRow}>
      {/* AI 头像 */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>AI</Text>
      </View>

      <View style={styles.assistantContent}>
        {/* 思考框 — 在气泡内部，不在外部 */}
        {message.reasoning !== undefined && message.reasoning !== '' && (
          <ReasoningBlock reasoning={message.reasoning} isStreaming={!!message.isStreaming} />
        )}

        {/* 工具调用 */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <View style={styles.extraSection}>
            {message.toolCalls.map((tc, i) => (
              <ToolCallBlock key={i} toolName={tc.name} state={tc.state} input={tc.input} output={tc.output} error={tc.error} />
            ))}
          </View>
        )}

        {/* 消息气泡 */}
        <View style={styles.assistantBubble}>
          {message.content ? (
            <MarkdownRenderer content={message.content} color="#1a1a1a" />
          ) : message.isStreaming ? (
            <Text style={styles.thinkingText}>正在思考...</Text>
          ) : null}
          {message.isStreaming && message.content ? (
            <Text style={styles.cursor}>▊</Text>
          ) : null}
        </View>

        {/* 结构化结果：数学动画 */}
        {message.capabilityResult?.artifacts && message.capabilityResult.artifacts.length > 0 && (
          <View style={styles.extraSection}>
            <MathAnimatorPreview
              output_mode={message.capabilityResult.output_mode}
              artifacts={message.capabilityResult.artifacts}
              code={message.capabilityResult.code}
            />
          </View>
        )}

        {/* 结构化结果：可视化 */}
        {message.capabilityResult?.render_type && (
          <View style={styles.extraSection}>
            <VisualizePreview
              render_type={message.capabilityResult.render_type}
              code={message.capabilityResult.code}
            />
          </View>
        )}

        {/* 来源引用 */}
        {message.sources && message.sources.length > 0 && (
          <View style={styles.extraSection}>
            <SourcesBlock sources={message.sources} />
          </View>
        )}

        {/* 网页预览按钮 */}
        {urls.length > 0 && (
          <View style={styles.urlRow}>
            {urls.slice(0, 2).map((url, i) => (
              <WebPreviewButton key={i} url={url} onPress={() => setPreviewUrl(url)} />
            ))}
          </View>
        )}

        {/* 底部信息：时间 + 反馈 */}
        <View style={styles.metaRow}>
          <Text style={styles.assistantTime}>{timeStr}</Text>
          {message.serverMessageId && onFeedback && !message.isStreaming && (
            <FeedbackButtons
              messageId={message.serverMessageId}
              currentFeedback={message.feedback}
              onFeedback={onFeedback}
            />
          )}
        </View>
      </View>

      {/* 网页预览 Modal */}
      {previewUrl && (
        <WebPreview visible={!!previewUrl} url={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // ── 用户消息 ──
  userRow: {
    marginVertical: 6,
    paddingHorizontal: 14,
    alignItems: 'flex-end',
  },
  userBubble: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    maxWidth: '82%',
  },
  userText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
  },
  userTime: {
    fontSize: 11,
    color: '#aaa',
    marginTop: 3,
    marginRight: 4,
  },

  // ── 助手消息 ──
  assistantRow: {
    marginVertical: 6,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366F1',
  },
  assistantContent: {
    flex: 1,
    maxWidth: '85%',
  },
  assistantBubble: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
  },
  thinkingText: {
    color: '#999',
    fontSize: 14,
    fontStyle: 'italic',
  },
  cursor: {
    color: '#6366F1',
    fontWeight: 'bold',
    fontSize: 14,
    marginTop: 2,
  },
  urlRow: {
    marginTop: 4,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  assistantTime: {
    fontSize: 11,
    color: '#aaa',
  },
  extraSection: {
    marginTop: 4,
  },
});
