import React, { useState, useCallback, useRef } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  Image,
  Alert,
  ScrollView,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import type { MessageAttachment } from "../lib/types";
import { useUnfocusTextInput } from "../hooks/useUnfocusTextInput";
import { useVoiceInput, SPEECH_HTML } from "../hooks/useVoiceInput";
import { colors } from "../lib/theme";

// ── 文件大小限制 ──
const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const IMAGE_UPLOAD_QUALITY = 0.78;

interface ChatInputProps {
  onSend: (text: string, attachments?: MessageAttachment[]) => void | Promise<void>;
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

    return {
      type: "image",
      uri: asset.uri,
      name: asset.fileName || `photo_${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
      size: asset.fileSize || undefined,
      metadata: {
        width: asset.width,
        height: asset.height,
        pixelCoordSpace: "source",
        preservesOriginalImage: true,
      },
    };
  } catch (err) {
    console.warn("[ChatInput] pickImage failed:", err);
    return null;
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
  const submitInFlightRef = useRef(false);
  const inputRef = useUnfocusTextInput();

  // 语音输入
  const handleVoiceTranscript = useCallback(
    (transcript: string, isFinal: boolean) => {
      setText((prev) => {
        // 直播中的文字实时更新，最终结果追加到末尾
        return transcript;
      });
    },
    [],
  );

  const handleVoiceError = useCallback((error: string) => {
    Alert.alert("语音识别", error);
  }, []);

  const {
    isListening,
    webViewRef,
    handleMessage,
    startListening,
    stopListening,
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
        isStreaming ||
        (!payloadText && !hasAttachments)
      ) {
        return false;
      }

      submitInFlightRef.current = true;
      void Promise.resolve(
        onSend(payloadText, hasAttachments ? payloadAttachments : undefined),
      ).finally(releaseSubmitLock);
      return true;
    },
    [disabled, isStreaming, onSend, releaseSubmitLock],
  );

  // 录音结束后，将识别文字发送
  const handleVoiceStop = useCallback(async () => {
    await stopListening();
    // 延迟一下让最终结果写入
    setTimeout(() => {
      setText((prev) => {
        if (
          dispatchSend(
            prev.trim(),
            attachments.length > 0 ? attachments : undefined,
          )
        ) {
          setAttachments([]);
          return "";
        }
        return prev;
      });
    }, 200);
  }, [stopListening, dispatchSend, attachments]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (
      dispatchSend(trimmed, attachments.length > 0 ? attachments : undefined)
    ) {
      setText("");
      setAttachments([]);
      setShowAttachmentPanel(false);
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
      setAttachments((prev) => [...prev, att]);
      setShowAttachmentPanel(false);
    }
  }, []);

  const handleGallery = useCallback(async () => {
    const att = await pickImage("gallery");
    if (att) {
      setAttachments((prev) => [...prev, att]);
      setShowAttachmentPanel(false);
    }
  }, []);

  const handleFile = useCallback(async () => {
    const att = await pickFile();
    if (att) {
      setAttachments((prev) => [...prev, att]);
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
      {/* 隐藏 WebView，提供 Web Speech API 语音识别 */}
      <WebView
        ref={webViewRef}
        source={{ html: SPEECH_HTML }}
        style={styles.speechWebView}
        javaScriptEnabled
        onMessage={handleMessage}
        originWhitelist={["*"]}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
      />
      {/* 附件预览 */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          style={styles.attachmentPreview}
          contentContainerStyle={styles.attachmentPreviewContent}
          showsHorizontalScrollIndicator={false}
        >
          {attachments.map((att, index) => (
            <View key={`${att.uri || att.objectKey || att.name || index}-${index}`} style={styles.attachmentItem}>
              {att.type === "image" && att.uri ? (
                <Image
                  source={{ uri: att.uri }}
                  style={styles.attachmentImage}
                />
              ) : (
                <View style={styles.attachmentFile}>
                  <Ionicons name="document" size={24} color={colors.textSecondary} />
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

      {/* 附件面板：拍照 / 相册 / 本地文件 */}
      {showAttachmentPanel && !isStreaming && (
        <View style={styles.attachmentPanel}>
          <View style={styles.attachmentActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleCamera}
            >
              <Ionicons name="camera-outline" size={28} color={colors.textPrimary} />
              <Text style={styles.actionLabel}>拍照</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleGallery}
            >
              <Ionicons name="images-outline" size={28} color={colors.textPrimary} />
              <Text style={styles.actionLabel}>相册</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleFile}>
              <Ionicons name="folder-outline" size={28} color={colors.textPrimary} />
              <Text style={styles.actionLabel}>本地文件</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 输入框 */}
      <View style={styles.container}>
        <View style={styles.inputRow}>
          {/* 语音按钮 */}
          <TouchableOpacity
            style={[styles.iconButton, isListening && styles.iconButtonActive]}
            onPress={isListening ? handleVoiceStop : startListening}
            disabled={disabled || isStreaming}
            onLongPress={startListening}
          >
            <Ionicons
              name={isListening ? "mic" : "mic-outline"}
              size={22}
              color={
                isListening
                  ? colors.error
                  : disabled || isStreaming
                    ? colors.textMuted
                    : colors.textSecondary
              }
            />
          </TouchableOpacity>

          {/* 文本输入 */}
          <TextInput
            ref={inputRef}
            style={[styles.input, isListening && { color: colors.error }]}
            value={text}
            onChangeText={setText}
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

          {/* 相机按钮 */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={toggleAttachmentPanel}
            disabled={disabled || isStreaming}
          >
            <Ionicons
              name="camera-outline"
              size={22}
              color={disabled || isStreaming ? colors.textMuted : colors.textSecondary}
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

  // ─ 输入框 ──
  speechWebView: {
    width: 0,
    height: 0,
    opacity: 0,
    position: "absolute",
  },
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
