import React from "react";
import { StyleSheet, Text } from "react-native";

import { colors } from "../../lib/theme";
import { BODY_FONT_SIZE, BODY_LINE_HEIGHT } from "./rendererTokens";

export function StreamingPlainTextRenderer({
  content,
  color = colors.textPrimary,
}: {
  content: string;
  color?: string;
}) {
  if (!content) return null;
  return <Text style={[styles.text, { color }]}>{content}</Text>;
}

const styles = StyleSheet.create({
  text: {
    fontSize: BODY_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
  },
});
