import React, { useState, useCallback } from "react";
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { RenderDebugBoundary } from "../../RenderDebugBoundary";
import { colors } from "../../../lib/theme";
import { WEB_TUNNEL_HEADERS, WEB_URL } from "../../../lib/config";
import type { Block } from "../types";

interface Artifact {
  type?: string;
  url?: string;
  filename?: string;
  content_type?: string;
  label?: string;
}

interface AnimationBlockProps {
  block: Block;
}

function resolveAssetUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const normalized = url.startsWith("/") ? url : `/${url}`;
  return `${WEB_URL}/api/live-book/assets${normalized}`;
}

function getAssetUrl(block: Block): string {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const rawUrl = String(payload.video_url || "");
  if (rawUrl) return resolveAssetUrl(rawUrl);
  const artifacts = (payload.artifacts as Artifact[] | undefined) || [];
  return artifacts[0]?.url ? resolveAssetUrl(artifacts[0].url) : "";
}

function isVideo(url: string, artifacts: Artifact[]): boolean {
  if (url.endsWith(".mp4") || url.endsWith(".webm")) return true;
  return artifacts.some((a) => (a.content_type || "").startsWith("video/"));
}

function VideoPlayer({ uri, onError }: { uri: string; onError: () => void }) {
  return (
    <WebView
      source={{ uri, headers: WEB_TUNNEL_HEADERS }}
      style={styles.video}
      allowsFullscreenVideo
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
      onError={onError}
    />
  );
}

export default function AnimationBlock({ block }: AnimationBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const artifacts = (payload.artifacts as Artifact[] | undefined) || [];
  const summary = String(payload.summary || "");
  const description = String(payload.description || "");
  const assetUrl = getAssetUrl(block);
  const video = isVideo(assetUrl, artifacts);
  const [error, setError] = useState(false);

  const handleOpen = useCallback(() => {
    if (assetUrl) Linking.openURL(assetUrl);
  }, [assetUrl]);

  if (!assetUrl) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>(Animation payload is empty)</Text>
      </View>
    );
  }

  return (
    <RenderDebugBoundary
      name="AnimationBlock"
      meta={{ assetUrl, video }}
      fallback={
        <View style={styles.container}>
          <View style={[styles.mediaBox, { justifyContent: "center", alignItems: "center" }]}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              动画预览加载失败
            </Text>
          </View>
          {summary || description ? (
            <View style={styles.caption}>
              <MarkdownRenderer
                content={summary || description}
                color={colors.textMuted}
              />
            </View>
          ) : null}
        </View>
      }
    >
      <View style={styles.container}>
        <View style={styles.mediaBox}>
          {video && !error ? (
            <VideoPlayer uri={assetUrl} onError={() => setError(true)} />
          ) : (
            <Image
              source={{ uri: assetUrl }}
              style={styles.image}
              resizeMode="contain"
              onError={() => setError(true)}
            />
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleOpen}>
            <Ionicons name="open-outline" size={16} color={colors.textMuted} />
            <Text style={styles.actionBtnText}>Open</Text>
          </TouchableOpacity>
          {video && (
            <TouchableOpacity style={styles.actionBtn} onPress={handleOpen}>
              <Ionicons
                name="download-outline"
                size={16}
                color={colors.textMuted}
              />
              <Text style={styles.actionBtnText}>Download</Text>
            </TouchableOpacity>
          )}
        </View>

        {summary || description ? (
          <View style={styles.caption}>
            <MarkdownRenderer
              content={summary || description}
              color={colors.textMuted}
            />
          </View>
        ) : null}
      </View>
    </RenderDebugBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    padding: 8,
    marginTop: 4,
  },
  emptyWrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.bgCard + "66",
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  mediaBox: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  video: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  image: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  caption: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
});
