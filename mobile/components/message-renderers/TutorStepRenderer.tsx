import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../lib/theme";
import { SMALL_FONT_SIZE, SMALL_LINE_HEIGHT } from "./rendererTokens";

const TEACHING_BG: Record<string, string> = {
  hint: "#fff8e1",
  steps: "#e8f5e9",
  knowledge: "#e3f2fd",
  mistake: "#fce4ec",
  quiz: "#f3e5f5",
  learning: "#e0f7fa",
  next: "#fff3e0",
};

const TEACHING_BORDER: Record<string, string> = {
  hint: "#ffc107",
  steps: "#4caf50",
  knowledge: "#2196f3",
  mistake: "#e91e63",
  quiz: "#9c27b0",
  learning: "#00bcd4",
  next: "#ff9800",
};

export function TutorStepRenderer({
  kind = "hint",
  title,
  children,
}: {
  kind?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const borderColor = TEACHING_BORDER[kind] || TEACHING_BORDER.hint;
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: TEACHING_BG[kind] || TEACHING_BG.hint,
          borderLeftColor: borderColor,
        },
      ]}
    >
      {title ? (
        <Text style={[styles.title, { color: borderColor }]}>{title}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 6,
    marginVertical: 6,
    borderRadius: 4,
  },
  title: {
    fontSize: SMALL_FONT_SIZE,
    lineHeight: SMALL_LINE_HEIGHT,
    fontWeight: "700",
    marginBottom: 2,
    color: colors.textPrimary,
  },
});
