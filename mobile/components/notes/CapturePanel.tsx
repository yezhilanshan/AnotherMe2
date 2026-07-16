import React from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";
import type { MessageAttachment } from "../../lib/types";

const PURPLE = "#6B5CE7";
const PURPLE_LIGHT = "#EDE9FF";
const ORANGE = "#FF8C61";
const GLASS_BG = "rgba(255, 252, 249, 0.88)";
const GLASS_BORDER = "rgba(255, 255, 255, 0.6)";
const CARD_SHADOW = {
  shadowColor: "#5A3E36",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 4,
};

interface CapturePanelProps {
  loading: boolean;
  selectedImages: MessageAttachment[];
  manualText: string;
  error: string | null;
  knowledgeStateCount: number;
  loadingLabel?: string;
  onPickImage: (source: "camera" | "gallery") => void;
  onClearImage: (index: number) => void;
  onClearImages: () => void;
  onManualTextChange: (text: string) => void;
  onGenerate: () => void;
}

export default function CapturePanel({
  loading,
  selectedImages,
  manualText,
  error,
  knowledgeStateCount,
  loadingLabel,
  onPickImage,
  onClearImage,
  onClearImages,
  onManualTextChange,
  onGenerate,
}: CapturePanelProps) {
  const imageCount = selectedImages.length;

  return (
    <View style={styles.capturePanel}>
      <View style={styles.captureTop}>
        <View>
          <Text style={styles.panelTitle}>笔记生成活书</Text>
          <Text style={styles.panelSubtitle}>
            最多 5 张图片，按顺序整理成互动活书
          </Text>
        </View>
        {knowledgeStateCount > 0 && (
          <View style={styles.stateBadge}>
            <Ionicons
              name="analytics-outline"
              size={14}
              color={colors.primary}
            />
            <Text style={styles.stateBadgeText}>
              {knowledgeStateCount} 个知识点
            </Text>
          </View>
        )}
      </View>

      <View style={styles.pickRow}>
        <TouchableOpacity
          style={[styles.pickButton, loading && styles.disabledButton]}
          onPress={() => onPickImage("camera")}
          disabled={loading}
        >
          <Ionicons name="camera" size={18} color={colors.textInverse} />
          <Text style={styles.pickButtonText}>拍一页</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, loading && styles.disabledButton]}
          onPress={() => onPickImage("gallery")}
          disabled={loading}
        >
          <Ionicons
            name="images-outline"
            size={18}
            color={colors.primary}
          />
          <Text style={styles.secondaryButtonText}>从相册选</Text>
        </TouchableOpacity>
      </View>

      {imageCount > 0 && (
        <View style={styles.imagePreviewBox}>
          <View style={styles.imagePreviewHeader}>
            <Text style={styles.imageHint}>
              已选择 {imageCount}/5 张，会按顺序合并整理
            </Text>
            <TouchableOpacity onPress={onClearImages} disabled={loading}>
              <Text style={styles.clearAllText}>清空</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.imageStrip}
          >
            {selectedImages.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={styles.imageTile}>
                <Image source={{ uri: image.uri }} style={styles.previewImage} />
                <View style={styles.imageOrderBadge}>
                  <Text style={styles.imageOrderText}>{index + 1}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => onClearImage(index)}
                  style={styles.clearImageButton}
                  disabled={loading}
                  hitSlop={6}
                >
                  <Ionicons name="close" size={15} color={colors.textInverse} />
                </TouchableOpacity>
                <Text style={styles.imageName} numberOfLines={1}>
                  {image.name}
                </Text>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.imageHint}>
            相册可一次多选；相机每次追加一张。
          </Text>
        </View>
      )}

      <TextInput
        value={manualText}
        onChangeText={onManualTextChange}
        placeholder="可选：补充老师板书、页码、你看不懂的地方..."
        placeholderTextColor={colors.textMuted}
        style={[styles.manualInput, loading && styles.disabledButton]}
        multiline
        textAlignVertical="top"
        editable={!loading}
      />

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="warning-outline" size={16} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading && (
        <View style={styles.streamingBox}>
          <View style={styles.streamingHeader}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.streamingLabel}>
              {loadingLabel || "AI 正在整理..."}
            </Text>
          </View>
          <Text style={styles.streamingHint}>
            正在识别笔记、创建活书目录，并准备阅读页面。
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.generateButton, loading && styles.disabledButton]}
        onPress={onGenerate}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Ionicons name="sparkles" size={18} color={colors.textInverse} />
        )}
        <Text style={styles.generateButtonText}>
          {loading ? "整理中..." : "生成活书"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  capturePanel: {
    backgroundColor: GLASS_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    padding: 16,
    ...CARD_SHADOW,
  },
  captureTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  panelTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  panelSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: PURPLE_LIGHT,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  stateBadgeText: { fontSize: 11, color: PURPLE, fontWeight: "700" },
  pickRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  pickButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: PURPLE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    ...CARD_SHADOW,
  },
  pickButtonText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: PURPLE,
    backgroundColor: "#FFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryButtonText: { color: PURPLE, fontWeight: "800", fontSize: 13 },
  imagePreviewBox: {
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: "rgba(255,255,255,0.55)",
    borderRadius: 14,
    padding: 10,
    marginTop: 12,
  },
  imagePreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  imageStrip: { gap: 8, paddingVertical: 8 },
  imageTile: { width: 74, position: "relative" },
  previewImage: {
    width: 74,
    height: 74,
    borderRadius: 10,
    backgroundColor: colors.bgPage,
  },
  imageOrderBadge: {
    position: "absolute",
    left: 5,
    top: 5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE,
  },
  imageOrderText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },
  imageName: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "600",
    marginTop: 4,
  },
  imageHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  clearAllText: { color: PURPLE, fontSize: 12, fontWeight: "700" },
  clearImageButton: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  manualInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: "rgba(107,92,231,0.15)",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.6)",
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.errorLight,
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 12, lineHeight: 17 },
  streamingBox: {
    backgroundColor: PURPLE_LIGHT,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  streamingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  streamingLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: PURPLE,
  },
  streamingHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  generateButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: ORANGE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    ...CARD_SHADOW,
  },
  disabledButton: { opacity: 0.5 },
  generateButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
