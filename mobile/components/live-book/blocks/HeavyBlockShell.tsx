import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../lib/theme";

export interface HeavyBlockBudget {
  maxAutoExpand: number;
  reserveSlot(): boolean;
}

export function createHeavyBlockBudget(maxAutoExpand = 2): HeavyBlockBudget {
  let allocated = 0;
  return {
    maxAutoExpand,
    reserveSlot() {
      if (allocated >= maxAutoExpand) return false;
      allocated++;
      return true;
    },
  };
}

interface HeavyBlockShellProps {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  budget?: HeavyBlockBudget;
}

export function HeavyBlockShell({
  title,
  icon = "cube-outline",
  children,
  defaultExpanded = false,
  budget,
}: HeavyBlockShellProps) {
  const [expanded, setExpanded] = useState(() => {
    if (!defaultExpanded) return false;
    if (!budget) return true;
    return budget.reserveSlot();
  });

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <Ionicons name={icon} size={16} color={colors.textMuted} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up-outline" : "chevron-down-outline"}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
    marginTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bgCard + "80",
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  body: {
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
});
