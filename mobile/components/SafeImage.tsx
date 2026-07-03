import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../lib/theme";

type LoadState = "idle" | "loading" | "loaded" | "error";

interface SafeImageProps {
  uri: string;
  alt?: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  resizeMode?: "cover" | "contain" | "stretch" | "center";
  showLoading?: boolean;
  showError?: boolean;
  defaultAspectRatio?: number;
  maxHeight?: number;
}

export function SafeImage({
  uri,
  alt,
  style,
  containerStyle,
  resizeMode = "cover",
  showLoading = true,
  showError = true,
  defaultAspectRatio = 1,
  maxHeight,
}: SafeImageProps) {
  const [state, setState] = useState<LoadState>("idle");
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    if (!uri) {
      setState("error");
      setAspectRatio(undefined);
      return () => {
        isMounted = false;
      };
    }

    setState("loading");
    setAspectRatio(undefined);

    Image.getSize(
      uri,
      (width, height) => {
        if (!isMounted) return;
        if (
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          height !== 0
        ) {
          setAspectRatio(width / height);
        } else {
          setAspectRatio(undefined);
        }
      },
      () => {
        if (!isMounted) return;
        setAspectRatio(undefined);
      },
    );

    return () => {
      isMounted = false;
    };
  }, [uri]);

  const imageStyle = useMemo(() => {
    const base: StyleProp<ImageStyle> = [styles.image, style];
    const ratio = aspectRatio ?? defaultAspectRatio;
    if (ratio) {
      (base as ImageStyle[]).push({ aspectRatio: ratio });
    }
    if (maxHeight) {
      (base as ImageStyle[]).push({ maxHeight });
    }
    return base;
  }, [aspectRatio, defaultAspectRatio, maxHeight, style]);

  if (!uri) {
    return (
      <View style={[styles.fallbackContainer, containerStyle]}>
        {showError ? (
          <Text style={styles.fallbackText}>
            {alt ? `[图片：${alt}]` : "[图片不可用]"}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, containerStyle]}>
      <Image
        source={{ uri }}
        style={imageStyle}
        resizeMode={resizeMode}
        onLoadStart={() => setState("loading")}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        accessible
        accessibilityLabel={alt}
      />
      {showLoading && state === "loading" ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {showError && state === "error" ? (
        <View style={[styles.overlay, styles.errorOverlay]}>
          <Text style={styles.fallbackText} numberOfLines={2}>
            {alt ? `无法加载：${alt}` : "无法加载图片"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  image: {
    width: "100%",
    height: undefined,
    backgroundColor: "transparent",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  errorOverlay: {
    backgroundColor: "rgba(0,0,0,0.03)",
    padding: 8,
  },
  fallbackContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgInput,
    borderRadius: 8,
    padding: 12,
  },
  fallbackText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
  },
});
