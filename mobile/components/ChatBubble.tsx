import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Share,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "../lib/types";
import type { MessageAttachment } from "../lib/types";
import { GATEWAY_URL } from "../lib/config";
import { colors } from "../lib/theme";
import { FeedbackButtons } from "./FeedbackButtons";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReasoningBlock } from "./ReasoningBlock";
import { SourcesBlock } from "./SourcesBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { MathAnimatorPreview } from "./MathAnimatorPreview";
import { VisualizePreview } from "./VisualizePreview";

/**
 * 当存在可视化结果时，从消息文本中剥离所有代码和无关内容，
 * 只保留文字说明部分，避免代码与渲染结果重复显示
 */
function stripCodeBlocksFromContent(text: string): string {
  let result = text
    // 移除围栏代码块 ```lang\n...\n```
    .replace(/```[\s\S]*?```/g, "")
    // 移除缩进代码块（连续 4 空格或 tab 开头的行）
    .replace(/(?:^|\n)( {4}|\t)[^\n]*(?:\n( {4}|\t)[^\n]*)*/g, "")
    // 移除行内代码 `code`（但保留反引号内的普通文本）
    .replace(/`[^`]+`/g, "")
    // 合并多余空行（最多保留 1 个空行）
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result;
}

function resolveAttachmentUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|file:|data:)/i.test(url)) return url;
  return `${GATEWAY_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function attachmentImageUri(attachment: MessageAttachment): string | undefined {
  return resolveAttachmentUrl(
    attachment.uri || attachment.url || attachment.file_url,
  );
}

function attachmentName(attachment: MessageAttachment): string {
  return attachment.name || attachment.file_name || "文件";
}

/**
 * 从消息文本中移除裸 URL（单独占一行的网址），
 * 避免在消息下方显示网址链接
 */
function stripBareUrls(text: string): string {
  // 移除独立行中的裸 URL（不以 ]( 开头的，即非 markdown 链接）
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !/^https?:\/\/[^\s<>)\]]+$/.test(trimmed);
    })
    .join("\n")
    .trim();
}

interface ChatBubbleProps {
  message: Message;
  onFeedback?: (messageId: string, rating: "like" | "dislike") => void;
  onRetry?: () => void;
  onEdit?: (messageId: string, newText: string) => void;
}

// ── 操作按钮组件 ──
function ActionButtons({
  onCopy,
  onShare,
  onRetry,
  onMore,
}: {
  onCopy?: () => void;
  onShare?: () => void;
  onRetry?: () => void;
  onMore?: () => void;
}) {
  return (
    <View style={styles.actionRow}>
      {onCopy && (
        <TouchableOpacity style={styles.actionBtn} onPress={onCopy}>
          <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onShare && (
        <TouchableOpacity style={styles.actionBtn} onPress={onShare}>
          <Ionicons name="share-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onRetry && (
        <TouchableOpacity style={styles.actionBtn} onPress={onRetry}>
          <Ionicons name="refresh-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onMore && (
        <TouchableOpacity style={styles.actionBtn} onPress={onMore}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── 用户消息操作按钮（复制 + 编辑） ──
function UserActionButtons({
  onCopy,
  onEdit,
}: {
  onCopy?: () => void;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.userActionRow}>
      {onCopy && (
        <TouchableOpacity style={styles.userActionBtn} onPress={onCopy}>
          <Ionicons name="copy-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onEdit && (
        <TouchableOpacity style={styles.userActionBtn} onPress={onEdit}>
          <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export const ChatBubble = React.memo(function ChatBubble({
  message,
  onFeedback,
  onRetry,
  onEdit,
}: ChatBubbleProps) {
  const isUser = message.role === "user";
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理 toast 定时器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    let copied = false;
    try {
      const Clipboard = require("expo-clipboard");
      await Clipboard.setStringAsync(message.content);
      copied = true;
    } catch {
      try {
        const Clipboard = require("@react-native-clipboard/clipboard").default;
        Clipboard.setString(message.content);
        copied = true;
      } catch {
        // 无可用剪贴板模块
      }
    }
    if (!copied) return;
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1500);
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: message.content });
    } catch {
      // 用户取消了分享
    }
  };

  const handleEditConfirm = () => {
    if (editText.trim()) {
      onEdit?.(message.id, editText.trim());
      setEditModalVisible(false);
    }
  };

  if (isUser) {
    // ─ 用户消息 ──
    const hasImages = message.attachments?.some((a) => a.type === "image");
    const hasFiles = message.attachments?.some((a) => a.type === "file");

    return (
      <>
        <View style={styles.userRow}>
          {/* 图片附件 */}
          {hasImages && (
            <ScrollView
              horizontal
              style={styles.userImageRow}
              showsHorizontalScrollIndicator={false}
            >
              {message
                .attachments!.filter((a) => a.type === "image")
                .map((att, i) => {
                  const uri = attachmentImageUri(att);
                  if (!uri) return null;
                  return (
                    <Image
                      key={`img-${i}`}
                      source={{ uri }}
                      style={styles.userImage}
                      resizeMode="cover"
                    />
                  );
                })}
            </ScrollView>
          )}
          {/* 文件附件 */}
          {hasFiles &&
            message
              .attachments!.filter((a) => a.type === "file")
              .map((att, i) => (
                <View key={`file-${i}`} style={styles.userFileRow}>
                  <Text style={styles.userFileText} numberOfLines={1}>
                    {attachmentName(att)}
                  </Text>
                </View>
              ))}
          {/* 文字气泡 */}
          {message.content ? (
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{message.content}</Text>
            </View>
          ) : null}
          {/* 用户消息操作按钮 */}
          <UserActionButtons
            onCopy={handleCopy}
            onEdit={() => {
              setEditText(message.content);
              setEditModalVisible(true);
            }}
          />
        </View>

        {/* 编辑弹窗 */}
        <Modal
          visible={editModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setEditModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>编辑消息</Text>
              <TextInput
                style={styles.modalInput}
                value={editText}
                onChangeText={setEditText}
                multiline
                autoFocus
                placeholder="输入消息..."
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setEditModalVisible(false)}
                >
                  <Text style={styles.modalCancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirmBtn}
                  onPress={handleEditConfirm}
                >
                  <Text style={styles.modalConfirmText}>重新发送</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Toast 提示 */}
        {toastVisible && (
          <View style={styles.toastContainer}>
            <Text style={styles.toastText}>复制成功</Text>
          </View>
        )}
      </>
    );
  }

  // ── 助手消息 ──
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantContent}>
        {/* 思考框 — 在气泡内部，不在外部 */}
        {message.reasoning !== undefined && message.reasoning !== "" && (
          <ReasoningBlock
            reasoning={message.reasoning}
            isStreaming={!!message.isStreaming}
          />
        )}

        {/* 工具调用 */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <View style={styles.extraSection}>
            {message.toolCalls.map((tc, i) => (
              <ToolCallBlock
                key={i}
                toolName={tc.name}
                state={tc.state}
                input={tc.input}
                output={tc.output}
                error={tc.error}
              />
            ))}
          </View>
        )}

        {/* 消息气泡 */}
        <View style={styles.assistantBubble}>
          {message.content ? (
            <MarkdownRenderer
              content={
                // 存在可视化/动画结果时，只展示文字说明，剥离代码块和裸 URL
                message.capabilityResult?.render_type ||
                message.capabilityResult?.artifacts?.length
                  ? stripBareUrls(stripCodeBlocksFromContent(message.content))
                  : stripBareUrls(message.content)
              }
              color={colors.textPrimary}
              isStreaming={message.isStreaming}
            />
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
          ) : null}
          {message.isStreaming && message.content ? (
            <Text style={styles.cursor}>▊</Text>
          ) : null}
        </View>

        {/* 结构化结果：数学动画 */}
        {message.capabilityResult?.artifacts &&
          message.capabilityResult.artifacts.length > 0 && (
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

        {/* 检索引用来源 */}
        {message.retrievalResults?.chunks &&
          message.retrievalResults.chunks.length > 0 && (
            <View style={styles.extraSection}>
              <Text style={styles.sourceLabel}>已参考：</Text>
              {message.retrievalResults.chunks.map((c, i) => (
                <Text key={i} style={styles.sourceItem} numberOfLines={1}>
                  · {c.filename}
                  {c.page !== null ? ` 第${c.page}页` : ""}
                  {c.sheet_name ? ` ${c.sheet_name}` : ""} (
                  {Math.round(c.score * 100)}%)
                </Text>
              ))}
            </View>
          )}

        {/* 来源引用 */}
        {message.sources && message.sources.length > 0 && (
          <View style={styles.extraSection}>
            <SourcesBlock sources={message.sources} />
          </View>
        )}

        {/* AI 消息操作按钮：复制、分享、重试 */}
        {!message.isStreaming && message.content && (
          <ActionButtons
            onCopy={handleCopy}
            onShare={handleShare}
            onRetry={onRetry}
          />
        )}
      </View>

      {/* Toast 提示 */}
      {toastVisible && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>复制成功</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // ─ 用户消息 ──
  userRow: {
    marginVertical: 6,
    paddingHorizontal: 14,
    alignItems: "flex-end",
  },
  userBubble: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    maxWidth: "82%",
  },
  userText: {
    color: colors.textInverse,
    fontSize: 15,
    lineHeight: 22,
  },
  userTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
    marginRight: 4,
  },
  userImageRow: {
    maxHeight: 200,
    marginBottom: 4,
  },
  userImage: {
    width: 180,
    height: 180,
    borderRadius: 12,
    marginRight: 6,
    backgroundColor: colors.bgInput,
  },
  userFileRow: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 4,
    alignSelf: "flex-end",
  },
  userFileText: {
    color: colors.textSecondary,
    fontSize: 13,
  },

  // ── 用户消息操作按钮 ──
  userActionRow: {
    flexDirection: "row",
    marginTop: 4,
    gap: 12,
    marginRight: 4,
  },
  userActionBtn: {
    padding: 4,
  },

  // ── 助手消息 ──
  assistantRow: {
    marginVertical: 6,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  assistantContent: {
    flex: 1,
    maxWidth: "100%",
    minWidth: 0,
  },
  assistantBubble: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderBottomLeftRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 8,
  },
  assistantTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  extraSection: {
    marginTop: 4,
  },
  sourceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
    fontWeight: "500",
  },
  sourceItem: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },

  // ── AI 消息操作按钮 ──
  actionRow: {
    flexDirection: "row",
    marginTop: 6,
    gap: 8,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 8,
  },

  // ── 编辑弹窗 ──
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: colors.textPrimary,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: colors.bgInput,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "500",
  },
  modalConfirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  modalConfirmText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "600",
  },

  // ── Toast 提示 ──
  toastContainer: {
    position: "absolute",
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toastText: {
    backgroundColor: "rgba(0,0,0,0.75)",
    color: colors.textInverse,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    fontSize: 14,
    fontWeight: "500",
  },
});
