import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "../lib/types";
import type { MessageAttachment } from "../lib/types";
import { GATEWAY_URL } from "../lib/config";
import { colors } from "../lib/theme";
import { ReasoningBlock } from "./ReasoningBlock";
import { SourcesBlock } from "./SourcesBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { MathAnimatorPreview } from "./MathAnimatorPreview";
import { VisualizePreview } from "./VisualizePreview";
import { SafeImage } from "./SafeImage";
import { MessageBubbleShell } from "./message-renderers/MessageBubbleShell";
import { MessageContentRenderer } from "./message-renderers/MessageContentRenderer";

function resolveAttachmentUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|file:|data:)/i.test(url)) return url;
  return `${GATEWAY_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function attachmentImageUri(attachment: MessageAttachment): string | undefined {
  return resolveAttachmentUrl(
    attachment.previewUri || attachment.preview_uri || attachment.uri,
  );
}

function attachmentName(attachment: MessageAttachment): string {
  return attachment.name || attachment.file_name || "文件";
}

function normalizedText(text: string | undefined): string {
  return String(text || "").trim();
}

function isCodeOnlyCapabilityText(
  content: string | undefined,
  codeContent: string | undefined,
): boolean {
  const text = normalizedText(content);
  if (!text) return false;

  const code = normalizedText(codeContent);
  if (code && (text === code || text.includes(code))) return true;
  if (/^```[\s\S]*```$/.test(text)) return true;
  if (/^<(!doctype|html|svg|canvas|script|style)\b/i.test(text)) return true;
  if (/\bfrom\s+manim\s+import\b/i.test(text)) return true;
  if (/\bclass\s+\w+\s*\(\s*Scene\s*\)\s*:/i.test(text)) return true;
  if (/\bnew\s+Chart\s*\(/i.test(text)) return true;
  return false;
}

function stripGeneratedCodeFromCapabilityText(
  content: string | undefined,
  codeContent: string | undefined,
): string {
  let text = String(content || "");
  const code = normalizedText(codeContent);
  if (code) {
    text = text.split(code).join("");
  }
  text = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "");

  const filtered = text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^(下面|以下|这里)?是?(生成|渲染)?(的)?代码(如下)?[:：]?$/i.test(trimmed)) {
        return false;
      }
      if (/^<(!doctype|html|svg|canvas|script|style)\b/i.test(trimmed)) {
        return false;
      }
      if (/\bfrom\s+manim\s+import\b/i.test(trimmed)) return false;
      if (/\bclass\s+\w+\s*\(\s*Scene\s*\)\s*:/i.test(trimmed)) {
        return false;
      }
      if (/\bnew\s+Chart\s*\(/i.test(trimmed)) return false;
      return true;
    })
    .join("\n");

  return filtered.replace(/\n{3,}/g, "\n\n").trim();
}

interface ChatBubbleProps {
  message: Message;
  onFeedback?: (messageId: string, rating: "like" | "dislike") => void;
  onRetry?: () => void;
  onEdit?: (messageId: string, newText: string) => void;
  onContinue?: (message: Message) => void;
  onLoadFullContent?: (message: Message) => void;
  onSpeak?: (message: Message) => void;
  isSpeaking?: boolean;
  preferWebViewMarkdown?: boolean;
}

// ── 操作按钮组件 ──
function ActionButtons({
  onCopy,
  onShare,
  onRetry,
  onMore,
  onSpeak,
  isSpeaking,
}: {
  onCopy?: () => void;
  onShare?: () => void;
  onRetry?: () => void;
  onMore?: () => void;
  onSpeak?: () => void;
  isSpeaking?: boolean;
}) {
  return (
    <View style={styles.actionRow}>
      {onSpeak && (
        <TouchableOpacity style={styles.actionBtn} onPress={onSpeak}>
          <Ionicons
            name={isSpeaking ? "volume-high" : "volume-medium-outline"}
            size={18}
            color={isSpeaking ? colors.mint : colors.textMuted}
          />
        </TouchableOpacity>
      )}
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
          <Ionicons
            name="ellipsis-horizontal"
            size={18}
            color={colors.textMuted}
          />
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
  onContinue,
  onLoadFullContent,
  onSpeak,
  isSpeaking,
  preferWebViewMarkdown,
}: ChatBubbleProps) {
  const isUser = message.role === "user";
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [toastVisible, setToastVisible] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理 toast 定时器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setShowFullText(false);
  }, [message.id]);

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
                  if (!uri) {
                    return (
                      <View
                        key={`img-${i}`}
                        style={styles.userImagePlaceholder}
                      >
                        <Ionicons
                          name="image-outline"
                          size={28}
                          color={colors.textSecondary}
                        />
                        <Text
                          style={styles.userImagePlaceholderText}
                          numberOfLines={1}
                        >
                          {attachmentName(att)}
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <SafeImage
                      key={`img-${i}`}
                      uri={uri}
                      alt={attachmentName(att)}
                      style={styles.userImage}
                      resizeMode="cover"
                      defaultAspectRatio={1}
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
            <MessageBubbleShell variant="user">
              <Text style={styles.userText}>{message.content}</Text>
            </MessageBubbleShell>
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
  const showReasoningBlock =
    message.reasoning !== undefined && message.reasoning !== "";
  const handleToggleFullText = useCallback(() => {
    setShowFullText((v) => !v);
  }, []);
  const capabilityResult = message.capabilityResult;
  const capabilityArtifacts = capabilityResult?.artifacts || [];
  const hasCapabilityArtifacts = capabilityArtifacts.length > 0;
  const isVisualizeResult =
    message.capability === "visualize" || Boolean(capabilityResult?.render_type);
  const showVisualizePreview =
    Boolean(capabilityResult) &&
    isVisualizeResult &&
    (hasCapabilityArtifacts ||
      Boolean(capabilityResult?.code?.content) ||
      Boolean(capabilityResult?.render_type));
  const showMathAnimatorPreview =
    Boolean(capabilityResult) &&
    hasCapabilityArtifacts &&
    !isVisualizeResult;
  const sanitizedCapabilityContent =
    capabilityResult && (showVisualizePreview || showMathAnimatorPreview)
      ? stripGeneratedCodeFromCapabilityText(
          message.content || capabilityResult.content,
          capabilityResult.code?.content,
        )
      : message.content;
  const hideCodeOnlyCapabilityText =
    Boolean(capabilityResult) &&
    (showVisualizePreview || showMathAnimatorPreview) &&
    normalizedText(sanitizedCapabilityContent).length === 0 &&
    isCodeOnlyCapabilityText(
      message.content || capabilityResult?.content,
      capabilityResult?.code?.content,
    );
  const displayMessage =
    sanitizedCapabilityContent !== message.content
      ? {
          ...message,
          content: sanitizedCapabilityContent,
          contentPreview: undefined,
        }
      : message;
  const hasVisibleMessageText =
    normalizedText(displayMessage.content).length > 0;
  const shouldRenderMessageContent =
    !hideCodeOnlyCapabilityText &&
    (hasVisibleMessageText || Boolean(message.isStreaming) || !capabilityResult);
  const shouldShowToolCalls =
    message.toolCalls &&
    message.toolCalls.length > 0 &&
    !(capabilityResult && (showVisualizePreview || showMathAnimatorPreview));
  const visibleToolCalls = shouldShowToolCalls ? message.toolCalls || [] : [];

  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantContent}>
        {/* 思考框 — 位于消息气泡上方 */}
        {showReasoningBlock && (
          <ReasoningBlock
            reasoning={message.reasoning || ""}
            isStreaming={!!message.isStreaming}
          />
        )}

        {/* 工具调用 */}
        {shouldShowToolCalls && (
          <View style={styles.extraSection}>
            {visibleToolCalls.map((tc, i) => (
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
        {shouldRenderMessageContent ? (
          <MessageContentRenderer
            message={displayMessage}
            showFullText={showFullText}
            onToggleFullText={handleToggleFullText}
            onLoadFullContent={onLoadFullContent}
            preferWebViewMarkdown={preferWebViewMarkdown}
          />
        ) : null}

        {!message.isStreaming &&
        (message.modelIncomplete || message.serverCutoff) ? (
          <View style={styles.partialNotice}>
            <View style={styles.partialNoticeTextWrap}>
              <Text style={styles.partialNoticeTitle}>
                {message.modelIncomplete
                  ? "模型输出达到上限，已暂停"
                  : "服务端保护限制触发，已暂停"}
              </Text>
              <Text style={styles.partialNoticeSub}>
                已保留当前推导内容，可以继续生成剩余步骤。
              </Text>
            </View>
            {onContinue ? (
              <TouchableOpacity
                style={styles.continueButton}
                onPress={() => onContinue(message)}
              >
                <Ionicons
                  name="play-forward"
                  size={14}
                  color={colors.textInverse}
                />
                <Text style={styles.continueButtonText}>继续</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* 结构化结果：数学动画 */}
        {showMathAnimatorPreview ? (
          <View style={styles.extraSection}>
            <MathAnimatorPreview
              output_mode={capabilityResult?.output_mode}
              artifacts={capabilityArtifacts}
              code={capabilityResult?.code}
            />
          </View>
        ) : null}

        {/* 结构化结果：可视化 */}
        {showVisualizePreview ? (
          <View style={styles.extraSection}>
            <VisualizePreview
              render_type={capabilityResult?.render_type}
              artifacts={capabilityArtifacts}
              code={capabilityResult?.code}
            />
          </View>
        ) : null}

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

        {/* 附件警告 */}
        {message.warnings && message.warnings.length > 0 && (
          <View style={styles.warningSection}>
            {message.warnings.map((w: any, i: number) => (
              <Text key={i} style={styles.warningText}>
                ⚠️ {w.message}
              </Text>
            ))}
          </View>
        )}

        {/* AI 消息操作按钮：朗读、复制、分享、重试 */}
        {!message.isStreaming && message.content && (
          <ActionButtons
            onSpeak={onSpeak ? () => onSpeak(message) : undefined}
            isSpeaking={isSpeaking}
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
  userImagePlaceholder: {
    width: 180,
    height: 180,
    borderRadius: 12,
    marginRight: 6,
    backgroundColor: colors.bgInput,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  userImagePlaceholderText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 6,
    maxWidth: "100%",
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
  partialNotice: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    backgroundColor: colors.warningLight,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  partialNoticeTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  partialNoticeTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  partialNoticeSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  continueButton: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  continueButtonText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: "700",
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
    maxWidth: "100%",
    overflow: "hidden",
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
  warningSection: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#FFF3CD",
    borderRadius: 6,
  },
  warningText: {
    fontSize: 12,
    color: "#856404",
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
