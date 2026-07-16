import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "../../lib/theme";

export function MessageBubbleShell({
  variant,
  children,
  style,
}: {
  variant: "assistant" | "user";
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[variant === "assistant" ? styles.assistant : styles.user, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  assistant: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  user: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    maxWidth: "82%",
  },
});
