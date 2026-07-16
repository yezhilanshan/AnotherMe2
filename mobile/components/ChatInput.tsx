import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import type { MessageAttachment } from "../lib/types";
import { useUnfocusTextInput } from "../hooks/useUnfocusTextInput";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { colors } from "../lib/theme";

// ── 文件限制（2GB 内存服务器） ──
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGE_COUNT = 5;
const MAX_FILE_COUNT = 3;
const MAX_TOTAL_ATTACHMENTS = 5;
const IMAGE_UPLOAD_QUALITY = 0.78;
const SAFE_IMAGE_LONG_EDGE = 1400;
const SAFE_IMAGE_COMPRESS = 0.72;
const VOICE_BARS = [8, 14, 20, 12, 17, 10] as const;

interface ChatInputProps {
  onSend: (
    text: string,
    attachments?: MessageAttachment[],
  ) => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  onFocusChange?: (focused: boolean) => void;
}

async function pickImage(
  source: "camera" | "gallery",
): Promise<MessageAttachment | null> {
  try {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: IMAGE_UPLOAD_QUALITY,
      base64: false,
    };

    let result: ImagePicker.ImagePickerResult;
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("权限不足", "需要相机权限才能拍照");
        return null;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("权限不足", "需要相册权限才能选择图片");
        return null;
      }
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (result.canceled || !result.assets || result.assets.length === 0)
      return null;

    const asset = result.assets[0];

    // 图片大小检查
    if (asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE) {
      Alert.alert(
        "图片过大",
        `请选择 ${MAX_IMAGE_SIZE / 1024 / 1024}MB 以内的图片`,
      );
      return null;
    }

    const prepared = await prepareSafeImageAsset(asset);

    return {
      type: "image",
      uri: prepared.uri,
      previewUri: prepared.uri,
      name: asset.fileName || `photo_${Date.now()}.jpg`,
      mimeType: prepared.mimeType,
      size: prepared.size || asset.fileSize || undefined,
      metadata: {
        width: prepared.width,
        height: prepared.height,
        pixelCoordSpace: "source",
        preservesOriginalImage: false,
        sourceWidth: asset.width,
        sourceHeight: asset.height,
      },
    };
  } catch (err) {
    console.warn("[ChatInput] pickImage failed:", err);
    return null;
  }
}

async function prepareSafeImageAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<{
  uri: string;
  width?: number;
  height?: number;
  size?: number;
  mimeType: string;
}> {
  const width = asset.width || 0;
  const height = asset.height || 0;
  const longestEdge = Math.max(width, height);
  const originalMime = asset.mimeType || "image/jpeg";
  const isPng = originalMime.toLowerCase() === "image/png";
  const isHeic =
    originalMime.toLowerCase().includes("heic") ||
    originalMime.toLowerCase().includes("heif");

  if (!longestEdge) {
    let fileSize = asset.fileSize;
    if (!fileSize && asset.uri) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri);
        fileSize = info.exists ? (info as any).size : undefined;
      } catch {}
    }
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      size: fileSize,
      mimeType: isHeic ? "image/jpeg" : originalMime,
    };
  }

  const resize =
    longestEdge > SAFE_IMAGE_LONG_EDGE
      ? width >= height
        ? { width: SAFE_IMAGE_LONG_EDGE }
        : { height: SAFE_IMAGE_LONG_EDGE }
      : {};

  try {
    const outputFormat =
      isPng && !isHeic
        ? ImageManipulator.SaveFormat.PNG
        : ImageManipulator.SaveFormat.JPEG;
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      Object.keys(resize).length ? [{ resize }] : [],
      {
        compress: SAFE_IMAGE_COMPRESS,
        format: outputFormat,
      },
    );

    let resultSize: number | undefined;
    try {
      const info = await FileSystem.getInfoAsync(result.uri);
      if (info.exists) {
        resultSize = (info as any).size;
      }
    } catch {}

    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      size: resultSize,
      mimeType: isPng && !isHeic ? "image/png" : "image/jpeg",
    };
  } catch (err) {
    console.warn("[ChatInput] image resize failed, using original:", err);
    let fileSize = asset.fileSize;
    if (!fileSize && asset.uri) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri);
        fileSize = info.exists ? (info as any).size : undefined;
      } catch {}
    }
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      size: fileSize,
      mimeType: isHeic ? "image/jpeg" : originalMime,
    };
  }
}

async function pickFile(): Promise<MessageAttachment | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0)
      return null;

    const asset = result.assets[0];

    // 文件大小检查
    if (asset.size && asset.size > MAX_FILE_SIZE) {
      Alert.alert(
        "文件过大",
        `文件大小 ${Math.round(asset.size / 1024 / 1024)}MB，超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制`,
      );
      return null;
    }

    return {
      type: "file",
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType || undefined,
      size: asset.size || undefined,
    };
  } catch (err) {
    console.warn("[ChatInput] pickFile failed:", err);
    return null;
  }
}

export const ChatInput = React.memo(function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  onFocusChange,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showAttachmentPanel, setShowAttachmentPanel] = useState(false);
  // 借鉴 Open WebUI：AI 还在生成时，允许把下一条消息排队，生成结束后自动发送。
  const [queuedSend, setQueuedSend] = useState<{
    text: string;
    attachments: MessageAttachment[];
  } | null>(null);
  const submitInFlightRef = useRef(false);
  const inputRef = useUnfocusTextInput();

  // 语音输入：用 ref 存最新文本，避免闭包陈旧 + 和语音识别结果的竞态
  const textRef = useRef("");
  // 语音启动前的已有文字（语音结束后恢复/追加）
  const textBeforeVoiceRef = useRef("");
  const voicePressActiveRef = useRef(false);
  const voiceErrorRef = useRef(false);

  const handleVoiceTranscript = useCallback(
    (transcript: string, _isFinal: boolean) => {
      // 实时更新文本（语音中的识别结果）
      const merged = textBeforeVoiceRef.current
        ? textBeforeVoiceRef.current + " " + transcript
        : transcript;
      textRef.current = merged;
      setText(merged);
    },
    [],
  );

  const handleVoiceError = useCallback((error: string) => {
    Alert.alert("语音识别", error);
    // 出错时恢复之前的文字
    setText(textBeforeVoiceRef.current);
    textRef.current = textBeforeVoiceRef.current;
    voiceErrorRef.current = true;
    voicePressActiveRef.current = false;
  }, []);

  const {
    isListening,
    isProcessing,
    startListening,
    stopListening,
    abortListening,
  } = useVoiceInput({
    lang: "zh-CN",
    onTranscript: handleVoiceTranscript,
    onError: handleVoiceError,
  });

  const releaseSubmitLock = useCallback(() => {
    setTimeout(() => {
      submitInFlightRef.current = false;
    }, 250);
  }, []);

  const dispatchSend = useCallback(
    (payloadText: string, payloadAttachments?: MessageAttachment[]) => {
      const hasAttachments = Boolean(payloadAttachments?.length);
      if (
        submitInFlightRef.current ||
        disabled ||
        (!payloadText && !hasAttachments)
      ) {
        return false;
      }

      // 借鉴 Open WebUI：AI 还在生成时，把下一条消息存到队列，
      // 等当前流结束后再自动发送，而不是禁用输入或丢弃用户内容。
      if (isStreaming) {
        setQueuedSend({
          text: payloadText,
          attachments: payloadAttachments ?? [],
        });
        return true;
      }

      submitInFlightRef.current = true;
      void Promise.resolve(
        onSend(payloadText, hasAttachments ? payloadAttachments : undefined),
      ).finally(releaseSubmitLock);
      return true;
    },
    [disabled, isStreaming, onSend, releaseSubmitLock],
  );

  // AI 生成结束后，自动发送排队的下一条消息。
  // 借鉴 Open WebUI 的消息队列：用户可以在 AI 回复过程中提前输入并排队。
  useEffect(() => {
    if (!isStreaming && queuedSend) {
      const { text: queuedText, attachments: queuedAttachments } = queuedSend;
      setQueuedSend(null);
      submitInFlightRef.current = true;
      void Promise.resolve(
        onSend(
          queuedText,
          queuedAttachments.length > 0 ? queuedAttachments : undefined,
        ),
      ).finally(releaseSubmitLock);
    }
  }, [isStreaming, queuedSend, onSend, releaseSubmitLock]);

  // 语音开始：保存已有文字，清空输入框准备展示识别结果
  const handleVoiceStart = useCallback(async () => {
    if (voicePressActiveRef.current || isProcessing) return;
    voicePressActiveRef.current = true;
    voiceErrorRef.current = false;
    textBeforeVoiceRef.current = textRef.current;
    const started = await startListening();
    if (!started) {
      setText(textBeforeVoiceRef.current);
      textRef.current = textBeforeVoiceRef.current;
      textBeforeVoiceRef.current = "";
      voicePressActiveRef.current = false;
    }
  }, [isProcessing, startListening]);

  // 录音结束后，获取最终识别文字并发送
  const handleVoiceStop = useCallback(async () => {
    if (!voicePressActiveRef.current) return;
    voicePressActiveRef.current = false;
    const finalText = await stopListening();
    if (voiceErrorRef.current) {
      voiceErrorRef.current = false;
      setText(textBeforeVoiceRef.current);
      textRef.current = textBeforeVoiceRef.current;
      textBeforeVoiceRef.current = "";
      return;
    }
    const mergedText = textBeforeVoiceRef.current
      ? `${textBeforeVoiceRef.current} ${finalText}`.trim()
      : finalText;
    const trimmed = mergedText.trim();
    if (trimmed) {
      if (
        dispatchSend(trimmed, attachments.length > 0 ? attachments : undefined)
      ) {
        setText("");
        textRef.current = "";
        textBeforeVoiceRef.current = "";
        setAttachments([]);
      } else {
        // 发送失败，保留识别文字
        setText(mergedText);
        textRef.current = mergedText;
        textBeforeVoiceRef.current = "";
      }
    } else {
      // 没有识别到文字，恢复语音前的文字
      setText(textBeforeVoiceRef.current);
      textRef.current = textBeforeVoiceRef.current;
      textBeforeVoiceRef.current = "";
    }
  }, [stopListening, dispatchSend, attachments]);

  // 取消语音（不发送）
  const handleVoiceCancel = useCallback(async () => {
    await abortListening();
    setText(textBeforeVoiceRef.current);
    textRef.current = textBeforeVoiceRef.current;
    textBeforeVoiceRef.current = "";
  }, [abortListening]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (
      dispatchSend(trimmed, attachments.length > 0 ? attachments : undefined)
    ) {
      setText("");
      textRef.current = "";
      setAttachments([]);
      setShowAttachmentPanel(false);
      Keyboard.dismiss();
    }
  }, [text, attachments, dispatchSend]);

  const handleFocus = useCallback(() => {
    onFocusChange?.(true);
    setShowAttachmentPanel(false);
  }, [onFocusChange]);
  const handleBlur = useCallback(() => onFocusChange?.(false), [onFocusChange]);

  const handleCamera = useCallback(async () => {
    const att = await pickImage("camera");
    if (att) {
      setAttachments((prev) => {
        const imgCount = prev.filter((a) => a.type === "image").length;
        if (prev.length >= MAX_TOTAL_ATTACHMENTS) {
          Alert.alert("附件已满", `最多添加 ${MAX_TOTAL_ATTACHMENTS} 个附件`);
          return prev;
        }
        if (imgCount >= MAX_IMAGE_COUNT) {
          Alert.alert("图片已满", `最多添加 ${MAX_IMAGE_COUNT} 张图片`);
          return prev;
        }
        return [...prev, att];
      });
      setShowAttachmentPanel(false);
    }
  }, []);

  const handleGallery = useCallback(async () => {
    const att = await pickImage("gallery");
    if (att) {
      setAttachments((prev) => {
        const imgCount = prev.filter((a) => a.type === "image").length;
        if (prev.length >= MAX_TOTAL_ATTACHMENTS) {
          Alert.alert("附件已满", `最多添加 ${MAX_TOTAL_ATTACHMENTS} 个附件`);
          return prev;
        }
        if (imgCount >= MAX_IMAGE_COUNT) {
          Alert.alert("图片已满", `最多添加 ${MAX_IMAGE_COUNT} 张图片`);
          return prev;
        }
        return [...prev, att];
      });
      setShowAttachmentPanel(false);
    }
  }, []);

  const handleFile = useCallback(async () => {
    const att = await pickFile();
    if (att) {
      setAttachments((prev) => {
        const fileCount = prev.filter((a) => a.type === "file").length;
        if (prev.length >= MAX_TOTAL_ATTACHMENTS) {
          Alert.alert("附件已满", `最多添加 ${MAX_TOTAL_ATTACHMENTS} 个附件`);
          return prev;
        }
        if (fileCount >= MAX_FILE_COUNT) {
          Alert.alert("文件已满", `最多添加 ${MAX_FILE_COUNT} 个文件`);
          return prev;
        }
        return [...prev, att];
      });
      setShowAttachmentPanel(false);
    }
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleAttachmentPanel = useCallback(() => {
    setShowAttachmentPanel((prev) => !prev);
  }, []);

  const canSend =
    (text.trim().length > 0 || attachments.length > 0) &&
    !disabled &&
    !isStreaming;

  return (
    <View>
      {/* 附件预览 */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          style={styles.attachmentPreview}
          contentContainerStyle={styles.attachmentPreviewContent}
          showsHorizontalScrollIndicator={false}
        >
          {attachments.map((att, index) => (
            <View
              key={`${att.uri || att.objectKey || att.name || index}-${index}`}
              style={styles.attachmentItem}
            >
              {att.type === "image" && att.uri ? (
                <Image
                  source={{ uri: att.uri }}
                  style={styles.attachmentImage}
                />
              ) : (
                <View style={styles.attachmentFile}>
                  <Ionicons
                    name="document"
                    size={24}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.attachmentFileName} numberOfLines={1}>
                    {att.name || "文件"}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.attachmentRemove}
                onPress={() => handleRemoveAttachment(index)}
              >
                <Ionicons name="close-circle" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 排队提示：AI 生成中时已预约发送的下一条消息 */}
      {queuedSend && (
        <View style={styles.queuedBanner}>
          <Ionicons name="time-outline" size={16} color={colors.primary} />
          <Text style={styles.queuedBannerText} numberOfLines={1}>
            下一条消息已排队，AI 回复后自动发送
          </Text>
          <TouchableOpacity
            onPress={() => {
              setText(queuedSend.text);
              textRef.current = queuedSend.text;
              setAttachments(queuedSend.attachments);
              setQueuedSend(null);
            }}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* 附件面板：拍照 / 相册 / 本地文件 */}
      {showAttachmentPanel && !isStreaming && (
        <View style={styles.attachmentPanel}>
          <View style={styles.attachmentActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleCamera}
            >
              <Ionicons
                name="camera-outline"
                size={28}
                color={colors.textPrimary}
              />
              <Text style={styles.actionLabel}>拍照</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleGallery}
            >
              <Ionicons
                name="images-outline"
                size={28}
                color={colors.textPrimary}
              />
              <Text style={styles.actionLabel}>相册</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleFile}>
              <Ionicons
                name="folder-outline"
                size={28}
                color={colors.textPrimary}
              />
              <Text style={styles.actionLabel}>本地文件</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 输入框 */}
      <View style={styles.container}>
        <View
          style={[
            styles.inputRow,
            isListening && styles.inputRowListening,
            isProcessing && styles.inputRowProcessing,
          ]}
        >
          {/* 语音按钮：按住说话，松开发送 */}
          <TouchableOpacity
            style={[
              styles.iconButton,
              (isListening || isProcessing) && styles.iconButtonActive,
            ]}
            onPressIn={handleVoiceStart}
            onPressOut={handleVoiceStop}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isListening ? "mic" : "mic-outline"}
              size={22}
              color={
                isListening
                  ? colors.error
                  : isProcessing
                    ? colors.warning
                    : disabled
                      ? colors.textMuted
                      : colors.textSecondary
              }
            />
          </TouchableOpacity>

          {/* 录音/识别期间，用明确状态替代普通文本框。 */}
          {isListening || isProcessing ? (
            <View
              style={styles.voiceStatus}
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
            >
              <View style={styles.voiceStatusCopy}>
                <Text style={styles.voiceStatusTitle}>
                  {isListening ? "正在聆听" : "正在识别语音"}
                </Text>
                <Text style={styles.voiceStatusHint}>
                  {isListening ? "松开结束并识别" : "请稍候，识别结果将自动发送"}
                </Text>
              </View>
              {isListening ? (
                <View style={styles.voiceBars}>
                  {VOICE_BARS.map((height, index) => (
                    <View
                      key={`${height}-${index}`}
                      style={[styles.voiceBar, { height }]}
                    />
                  ))}
                </View>
              ) : (
                <ActivityIndicator size="small" color={colors.primary} />
              )}
            </View>
          ) : (
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={(t) => {
                textRef.current = t;
                setText(t);
              }}
              placeholder="发消息或按住说话..."
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
              editable={!disabled}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          )}

          {/* 相机按钮 */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={toggleAttachmentPanel}
            disabled={disabled || isStreaming}
          >
            <Ionicons
              name="camera-outline"
              size={22}
              color={
                disabled || isStreaming
                  ? colors.textMuted
                  : colors.textSecondary
              }
            />
          </TouchableOpacity>

          {/* 发送 / 停止 */}
          {isStreaming ? (
            <TouchableOpacity
              style={[styles.sendButton, styles.stopButton]}
              onPress={onStop}
            >
              <Ionicons name="stop" size={14} color={colors.textInverse} />
            </TouchableOpacity>
          ) : canSend ? (
            <TouchableOpacity
              style={[styles.sendButton, styles.sendButtonActive]}
              onPress={handleSend}
            >
              <Ionicons name="arrow-up" size={16} color={colors.textInverse} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendButton, styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // ── 附件预览 ──
  attachmentPreview: {
    backgroundColor: colors.bgInput,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    maxHeight: 90,
  },
  attachmentPreviewContent: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  attachmentItem: {
    position: "relative",
  },
  attachmentImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: colors.bgInput,
  },
  attachmentFile: {
    width: 80,
    height: 64,
    borderRadius: 8,
    backgroundColor: colors.bgInput,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  attachmentFileName: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },
  attachmentRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: colors.bgCard,
    borderRadius: 10,
  },

  // ── 附件面板 ──
  attachmentPanel: {
    backgroundColor: colors.bgCard,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingBottom: 12,
  },
  attachmentActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  actionButton: {
    alignItems: "center",
    gap: 6,
  },
  actionLabel: {
    fontSize: 12,
    color: colors.textPrimary,
  },

  queuedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.bgCard,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  queuedBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },

  // ─ 输入框 ──
  container: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgInput,
    borderRadius: 24,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
    borderWidth: 1,
    borderColor: "transparent",
  },
  inputRowListening: {
    backgroundColor: colors.errorLight,
    borderColor: colors.error,
  },
  inputRowProcessing: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  iconButton: {
    padding: 8,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 100,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  voiceStatus: {
    flex: 1,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    gap: 10,
  },
  voiceStatusCopy: {
    flex: 1,
  },
  voiceStatusTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  voiceStatusHint: {
    marginTop: 1,
    fontSize: 11,
    color: colors.textSecondary,
  },
  voiceBars: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  voiceBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.error,
  },
  iconButtonActive: {
    backgroundColor: colors.errorLight,
    borderRadius: 16,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 2,
  },
  sendButtonActive: {
    backgroundColor: colors.primary,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  stopButton: {
    backgroundColor: colors.error,
  },
});
