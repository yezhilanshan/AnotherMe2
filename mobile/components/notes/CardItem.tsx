import React, { useState, useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";
import type { StudyNoteCard } from "../../lib/study-notes";
import { FinalMarkdownRenderer } from "../message-renderers/FinalMarkdownRenderer";

const BAND_LABELS: Record<string, string> = {
  weak: "薄弱",
  familiar: "半熟",
  mastered: "已掌握",
  unlinked: "待绑定",
};

const BAND_COLORS: Record<string, { bg: string; fg: string }> = {
  weak: { bg: colors.errorLight, fg: colors.error },
  familiar: { bg: colors.warningLight, fg: colors.warning },
  mastered: { bg: colors.successLight, fg: colors.success },
  unlinked: { bg: colors.infoLight, fg: colors.info },
};

function masteryText(card: StudyNoteCard): string {
  if (card.mastery === null) return BAND_LABELS.unlinked;
  return `${BAND_LABELS[card.masteryBand]} · ${Math.round(card.mastery * 100)}%`;
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function stripDisplayMathDelimiters(value: string): string {
  const text = value.trim();
  if (text.startsWith("$$") && text.endsWith("$$"))
    return text.slice(2, -2).trim();
  if (text.startsWith("$") && text.endsWith("$"))
    return text.slice(1, -1).trim();
  if (text.startsWith("\\[") && text.endsWith("\\]"))
    return text.slice(2, -2).trim();
  if (text.startsWith("\\(") && text.endsWith("\\)"))
    return text.slice(2, -2).trim();
  return text;
}

function formulaMarkdown(items: string[]): string {
  return items
    .map(stripDisplayMathDelimiters)
    .filter(Boolean)
    .map((item) => `$$\n${item}\n$$`)
    .join("\n\n");
}

interface CardItemProps {
  card: StudyNoteCard;
  quizMode?: boolean;
}

export default function CardItem({ card, quizMode = false }: CardItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const band = BAND_COLORS[card.masteryBand];

  const handleToggle = useCallback(() => {
    if (quizMode) {
      setFlipped((prev) => !prev);
    } else {
      setExpanded((prev) => !prev);
    }
  }, [quizMode]);

  const handleMarkReviewed = useCallback(() => {
    setReviewed((prev) => !prev);
  }, []);

  const hasDetails =
    card.keyPoints.length > 0 ||
    card.formulas.length > 0 ||
    card.questions.length > 0;

  // Quiz front side: title + tags only, hint to flip
  if (quizMode && !flipped) {
    return (
      <TouchableOpacity
        style={[
          styles.noteCard,
          styles.quizCardFront,
          reviewed && styles.noteCardReviewed,
        ]}
        onPress={handleToggle}
        activeOpacity={0.7}
      >
        <View style={styles.quizFrontContent}>
          <Ionicons
            name="help-circle-outline"
            size={28}
            color={colors.primary}
          />
          <Text style={styles.quizTitle}>{card.title}</Text>
          {card.linkedKnowledgePoints.length > 0 && (
            <View style={styles.tagRow}>
              {card.linkedKnowledgePoints.slice(0, 3).map((item) => (
                <Text key={item} style={styles.kpTag} numberOfLines={1}>
                  {item}
                </Text>
              ))}
            </View>
          )}
          <Text style={styles.quizHint}>点击翻转查看详情</Text>
          <View style={[styles.bandPill, { backgroundColor: band.bg }]}>
            <Text style={[styles.bandText, { color: band.fg }]}>
              {masteryText(card)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // Quiz back side or normal expanded card
  return (
    <TouchableOpacity
      style={[styles.noteCard, reviewed && styles.noteCardReviewed]}
      onPress={handleToggle}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text
            style={styles.cardTitle}
            numberOfLines={quizMode || expanded ? undefined : 2}
          >
            {card.title}
          </Text>
          {reviewed && (
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={colors.success}
            />
          )}
          {quizMode && (
            <View style={[styles.bandPill, { backgroundColor: band.bg }]}>
              <Text style={[styles.bandText, { color: band.fg }]}>
                {masteryText(card)}
              </Text>
            </View>
          )}
        </View>
        {!quizMode && (
          <View style={styles.cardBadges}>
            <View style={[styles.bandPill, { backgroundColor: band.bg }]}>
              <Text style={[styles.bandText, { color: band.fg }]}>
                {masteryText(card)}
              </Text>
            </View>
            {hasDetails && (
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.textMuted}
              />
            )}
          </View>
        )}
      </View>

      {/* Summary always visible (back side in quiz) */}
      <View style={styles.summaryRow}>
        <FinalMarkdownRenderer
          content={card.summary}
          color={colors.textSecondary}
        />
      </View>

      {/* Knowledge tags */}
      {card.linkedKnowledgePoints.length > 0 && (
        <View style={styles.tagRow}>
          {card.linkedKnowledgePoints.slice(0, 4).map((item) => (
            <Text key={item} style={styles.kpTag} numberOfLines={1}>
              {item}
            </Text>
          ))}
        </View>
      )}

      {/* Expandable details (always shown in quiz back) */}
      {(expanded || quizMode) && hasDetails && (
        <View style={styles.detailArea}>
          {card.keyPoints.length > 0 && (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>知识点</Text>
              <FinalMarkdownRenderer
                content={markdownList(card.keyPoints)}
                color={colors.textPrimary}
              />
            </View>
          )}
          {card.formulas.length > 0 && (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>公式</Text>
              <FinalMarkdownRenderer
                content={formulaMarkdown(card.formulas)}
                color={colors.textPrimary}
              />
            </View>
          )}
          {card.questions.length > 0 && (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>疑问点</Text>
              <FinalMarkdownRenderer
                content={markdownList(card.questions)}
                color={colors.error}
              />
            </View>
          )}
        </View>
      )}

      {/* Review action */}
      {(expanded || quizMode) && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleMarkReviewed}
          >
            <Ionicons
              name={reviewed ? "checkmark-circle" : "checkmark-circle-outline"}
              size={16}
              color={reviewed ? colors.success : colors.textMuted}
            />
            <Text
              style={[
                styles.actionBtnText,
                reviewed && { color: colors.success },
              ]}
            >
              {reviewed ? "已复习" : "标记已复习"}
            </Text>
          </TouchableOpacity>
          {quizMode && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setFlipped(false)}
            >
              <Ionicons name="arrow-undo" size={14} color={colors.textMuted} />
              <Text style={styles.actionBtnText}>翻回正面</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  noteCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  noteCardReviewed: {
    borderColor: colors.successLight,
    backgroundColor: colors.successLight,
  },
  quizCardFront: {
    backgroundColor: colors.infoLight,
    borderColor: colors.primary,
    borderStyle: "dashed" as const,
  },
  quizFrontContent: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 8,
  },
  quizTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
  },
  quizHint: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bandPill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  bandText: { fontSize: 11, fontWeight: "700" },
  summaryRow: { marginTop: 6 },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  kpTag: {
    maxWidth: 150,
    color: colors.primary,
    backgroundColor: colors.infoLight,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 11,
    overflow: "hidden",
  },
  detailArea: { marginTop: 6 },
  detailSection: { marginTop: 10, gap: 4 },
  detailLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionBtnText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "600",
  },
});
