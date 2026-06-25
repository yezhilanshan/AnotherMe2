// 数学动画预览 — 下载并本地缓存，直接展示视频/图片，不展示代码
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { GATEWAY_URL } from "../lib/config";
import { colors } from "../lib/theme";

interface Artifact {
  type: string;
  url: string;
  filename: string;
  label: string;
}

interface MathAnimatorPreviewProps {
  output_mode?: string;
  artifacts?: Artifact[];
  code?: { language: string; content: string };
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const CACHE_DIR = (FileSystem as any).cacheDirectory + "math-animations/";

/** 确保缓存目录存在 */
async function ensureCacheDir() {
  const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/** 下载 artifact 到本地缓存，返回本地 URI */
async function downloadArtifact(artifact: Artifact): Promise<string | null> {
  try {
    await ensureCacheDir();
    const url = artifact.url.startsWith("http")
      ? artifact.url
      : `${GATEWAY_URL}${artifact.url}`;
    const ext = artifact.filename.split(".").pop() || artifact.type;
    const localUri = `${CACHE_DIR}${encodeURIComponent(artifact.filename)}.${ext}`;

    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (fileInfo.exists) return localUri; // 已缓存，直接返回

    const downloadResult = await FileSystem.downloadAsync(url, localUri);
    return downloadResult.uri;
  } catch (e) {
    console.warn("[MathAnimator] Download failed:", e);
    return null;
  }
}

/** 单个 artifact 卡片（内嵌展示，不是外部链接） */
const ArtifactCard = React.memo(function ArtifactCard({
  artifact,
}: {
  artifact: Artifact;
}) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    downloadArtifact(artifact).then((uri) => {
      if (mountedRef.current) {
        setLocalUri(uri);
        setLoading(false);
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, [artifact.url, artifact.filename]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  if (!localUri) {
    return (
      <View style={styles.card}>
        <Ionicons name="alert-circle" size={32} color={colors.error} />
        <Text style={styles.title}>加载失败</Text>
        <Text style={styles.subtitle}>
          {artifact.label || artifact.filename}
        </Text>
      </View>
    );
  }

  // 视频：显示缩略图 + 播放提示（Android 原生视频播放较复杂，保留外部打开）
  if (artifact.type === "video") {
    return (
      <View style={styles.videoCard}>
        <View style={styles.videoPlaceholder}>
          <Ionicons name="play-circle" size={48} color={colors.primary} />
          <Text style={styles.videoLabel}>{artifact.label || "数学动画"}</Text>
          <Text style={styles.videoHint}>已缓存至本地 · 点击播放</Text>
        </View>
        {/* 使用本地文件 URI */}
        <TouchableOpacity
          style={styles.playBtn}
          onPress={() => {
            // 使用系统播放器打开本地文件
            const Linking = require("react-native").Linking;
            Linking.openURL(localUri);
          }}
        >
          <Ionicons name="play" size={16} color={colors.textInverse} />
          <Text style={styles.playBtnText}>播放动画</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 图片：直接内嵌展示
  return (
    <View style={styles.imageCard}>
      <Image
        source={{ uri: localUri }}
        style={styles.imagePreview}
        resizeMode="contain"
      />
      <Text style={styles.imageLabel}>
        {artifact.label || artifact.filename}
      </Text>
    </View>
  );
});

export const MathAnimatorPreview = React.memo(function MathAnimatorPreview({
  artifacts,
}: MathAnimatorPreviewProps) {
  if (!artifacts?.length) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="calculator" size={14} color={colors.primary} />
        <Text style={styles.headerText}>数学动画</Text>
      </View>
      {artifacts.map((a, i) => (
        <ArtifactCard key={`${a.filename}-${i}`} artifact={a} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  headerText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  card: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    backgroundColor: colors.infoLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.primary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // 视频卡片
  videoCard: {
    backgroundColor: colors.infoLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: "hidden",
  },
  videoPlaceholder: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 6,
  },
  videoLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  videoHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 10,
    gap: 6,
  },
  playBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "600",
  },

  // 图片卡片
  imageCard: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  imagePreview: {
    width: "100%",
    height: Math.min(SCREEN_WIDTH * 0.6, 300),
    backgroundColor: colors.bgInput,
  },
  imageLabel: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
});
