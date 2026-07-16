import React from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Ionicons } from "@expo/vector-icons";

import { GATEWAY_URL } from "../lib/config";
import { colors } from "../lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface CapabilityArtifact {
  type?: string;
  url?: string;
  filename?: string;
  label?: string;
  content_type?: string;
  mime_type?: string;
}

interface CapabilityMediaPreviewProps {
  artifacts?: CapabilityArtifact[];
  title?: string;
  icon?: IoniconName;
  imageStyle?: StyleProp<ImageStyle>;
  emptyFallback?: React.ReactNode;
}

function resolveMediaUrl(url: string | undefined): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (/^(https?:|file:|data:|content:|blob:)/i.test(raw)) return raw;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return null;
  return `${GATEWAY_URL}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function artifactHint(artifact: CapabilityArtifact): string {
  return [
    artifact.type,
    artifact.content_type,
    artifact.mime_type,
    artifact.filename,
    artifact.url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isVideoArtifact(artifact: CapabilityArtifact): boolean {
  const hint = artifactHint(artifact);
  return (
    hint.includes("video") ||
    /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(hint)
  );
}

function isImageArtifact(artifact: CapabilityArtifact): boolean {
  const hint = artifactHint(artifact);
  return (
    hint.includes("image") ||
    /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(hint)
  );
}

export function hasRenderableCapabilityMedia(
  artifacts?: CapabilityArtifact[],
): boolean {
  return (artifacts || []).some((artifact) => {
    return (
      resolveMediaUrl(artifact.url) &&
      (isImageArtifact(artifact) || isVideoArtifact(artifact))
    );
  });
}

function artifactLabel(artifact: CapabilityArtifact, fallback: string): string {
  return artifact.label || artifact.filename || fallback;
}

function ArtifactVideo({
  uri,
  label,
}: {
  uri: string;
  label: string;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  return (
    <View style={styles.mediaCard}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
      />
      <View style={styles.captionRow}>
        <Ionicons name="film-outline" size={14} color={colors.primary} />
        <Text style={styles.captionText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function ArtifactImage({
  uri,
  label,
  imageStyle,
}: {
  uri: string;
  label: string;
  imageStyle?: StyleProp<ImageStyle>;
}) {
  return (
    <View style={styles.mediaCard}>
      <Image
        source={{ uri }}
        style={[styles.image, imageStyle]}
        resizeMode="contain"
        accessible
        accessibilityLabel={label}
      />
      <View style={styles.captionRow}>
        <Ionicons name="image-outline" size={14} color={colors.primary} />
        <Text style={styles.captionText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function CapabilityMediaPreview({
  artifacts,
  title = "生成结果",
  icon = "sparkles-outline",
  imageStyle,
  emptyFallback,
}: CapabilityMediaPreviewProps) {
  const mediaArtifacts = (artifacts || [])
    .map((artifact) => ({
      artifact,
      uri: resolveMediaUrl(artifact.url),
    }))
    .filter(
      (item) =>
        item.uri &&
        (isImageArtifact(item.artifact) || isVideoArtifact(item.artifact)),
    );

  if (!mediaArtifacts.length) {
    return emptyFallback ? <>{emptyFallback}</> : null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name={icon} size={14} color={colors.primary} />
        <Text style={styles.headerText}>{title}</Text>
      </View>
      {mediaArtifacts.map(({ artifact, uri }, index) => {
        const label = artifactLabel(artifact, title);
        const key = `${artifact.filename || artifact.url || index}-${index}`;
        if (isVideoArtifact(artifact)) {
          return <ArtifactVideo key={key} uri={uri!} label={label} />;
        }
        return (
          <ArtifactImage
            key={key}
            uri={uri!}
            label={label}
            imageStyle={imageStyle}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  headerText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  mediaCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: 260,
    backgroundColor: colors.bgInput,
  },
  video: {
    width: "100%",
    height: 240,
    backgroundColor: "#000",
  },
  captionRow: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  captionText: {
    flex: 1,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: 12,
  },
});
