import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { useTheme, type ThemeColors } from "../../../lib/theme";
import type { Block } from "../../../lib/types";

interface VariantStyle {
  icon: keyof typeof Ionicons.glyphMap;
  borderColor: string;
  bgColor: string;
  iconColor: string;
  labelColor: string;
}

function getVariantStyles(t: ThemeColors): Record<string, VariantStyle> {
  const isDark = t.bgPage === "#1E1B18";
  return {
    key_idea: {
      icon: "bulb-outline",
      borderColor: "#D4A017",
      bgColor: isDark ? "#3A3420" : "#FDF8E8",
      iconColor: "#C49000",
      labelColor: "#8B6914",
    },
    common_pitfall: {
      icon: "warning-outline",
      borderColor: "#D4836A",
      bgColor: t.errorLight,
      iconColor: t.error,
      labelColor: t.error,
    },
    summary: {
      icon: "bookmark-outline",
      borderColor: t.primary,
      bgColor: t.infoLight,
      iconColor: t.primary,
      labelColor: t.primary,
    },
    tip: {
      icon: "sparkles-outline",
      borderColor: t.success,
      bgColor: t.successLight,
      iconColor: t.success,
      labelColor: t.success,
    },
  };
}

export interface CalloutBlockProps {
  block: Block;
}

export default function CalloutBlock({ block }: CalloutBlockProps) {
  const theme = useTheme();
  const payload = (block.payload || {}) as Record<string, unknown>;
  const variant =
    typeof payload.variant === "string" ? payload.variant : "key_idea";
  const label =
    typeof payload.label === "string"
      ? payload.label
      : variant.replace(/_/g, " ");
  const body = typeof payload.body === "string" ? payload.body : "";

  const variantStyles = getVariantStyles(theme);
  const style = variantStyles[variant] || variantStyles.key_idea;

  return (
    <View
      style={[
        styles.container,
        { borderLeftColor: style.borderColor, backgroundColor: style.bgColor },
      ]}
    >
      <Ionicons
        name={style.icon}
        size={18}
        color={style.iconColor}
        style={styles.icon}
      />
      <View style={styles.content}>
        <Text style={[styles.label, { color: style.labelColor }]}>
          {label.toUpperCase()}
        </Text>
        {body ? (
          <MarkdownRenderer content={body} color={theme.textPrimary} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    marginBottom: 12,
    gap: 8,
  },
  icon: {
    marginTop: 2,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
});
