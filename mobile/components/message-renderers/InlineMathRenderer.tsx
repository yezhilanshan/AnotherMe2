import React, { useMemo } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { simplifyLatex } from "../../lib/latex-utils";
import { colors } from "../../lib/theme";
import { BODY_LINE_HEIGHT, INLINE_MATH_FONT_SIZE } from "./rendererTokens";

export function InlineMathRenderer({
  formula,
  color = colors.textPrimary,
  textStyle,
}: {
  formula: string;
  color?: string;
  textStyle?: StyleProp<TextStyle>;
}) {
  const readable = useMemo(() => {
    try {
      return simplifyLatex(formula);
    } catch {
      return formula;
    }
  }, [formula]);
  return <Text style={[styles.text, textStyle, { color }]}>{readable}</Text>;
}

const styles = StyleSheet.create({
  text: {
    color: colors.textPrimary,
    fontSize: INLINE_MATH_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
    fontFamily: "monospace",
  },
});
