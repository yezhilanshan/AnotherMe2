import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../lib/theme";
import type { Block } from "../types";

interface Suggestion {
  topic?: string;
  rationale?: string;
}

interface DeepDiveBlockProps {
  block: Block;
  onDeepDive?: (topic: string, blockId: string) => Promise<void> | void;
  onNavigateToPage?: (pageId: string) => void;
  pendingTopic?: string | null;
}

export default function DeepDiveBlock({
  block,
  onDeepDive,
  onNavigateToPage,
  pendingTopic,
}: DeepDiveBlockProps) {
  const suggestions =
    (block.payload?.suggestions as Suggestion[] | undefined) || [];
  const linkedPageId = block.metadata?.deep_dive_page_id as string | undefined;
  const [busyTopic, setBusyTopic] = useState<string | null>(null);

  const handleDeepDive = useCallback(
    async (topic: string) => {
      if (!onDeepDive || !topic) return;
      setBusyTopic(topic);
      try {
        await onDeepDive(topic, block.id);
      } finally {
        setBusyTopic(null);
      }
    },
    [onDeepDive, block.id],
  );

  if (suggestions.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="sparkles" size={16} color={colors.primary} />
        <Text style={styles.headerLabel}>Go Deeper</Text>
      </View>

      {/* Suggestions list */}
      {suggestions.map((s, i) => {
        const topic = s.topic || "";
        const isPending = busyTopic === topic || pendingTopic === topic;
        const disabled = isPending || !!linkedPageId;

        return (
          <TouchableOpacity
            key={i}
            style={[styles.item, disabled && styles.itemDisabled]}
            onPress={() => handleDeepDive(topic)}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <View style={styles.itemContent}>
              <Text style={styles.itemTopic}>{topic}</Text>
              {s.rationale ? (
                <Text style={styles.itemRationale}>{s.rationale}</Text>
              ) : null}
            </View>
            {isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textMuted}
              />
            )}
          </TouchableOpacity>
        );
      })}

      {/* Linked page button */}
      {linkedPageId && onNavigateToPage ? (
        <TouchableOpacity
          style={styles.linkedBtn}
          onPress={() => onNavigateToPage(linkedPageId)}
        >
          <Ionicons name="open-outline" size={14} color={colors.primary} />
          <Text style={styles.linkedBtnText}>View linked sub-page</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + "30",
    backgroundColor: colors.infoLight,
    padding: 12,
    marginTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary,
    letterSpacing: 1,
  },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    padding: 10,
    marginBottom: 6,
  },
  itemDisabled: {
    opacity: 0.55,
  },
  itemContent: {
    flex: 1,
  },
  itemTopic: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  itemRationale: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    marginTop: 3,
  },
  linkedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary + "30",
    backgroundColor: colors.primary + "10",
  },
  linkedBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primary,
  },
});
