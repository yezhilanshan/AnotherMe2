import React, { useState, useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";
import type {
  StudyNote,
  StudyNoteCard,
  StudyNoteMasteryBand,
  StudyNoteViewMode,
} from "../../lib/study-notes";
import { getStudyNoteGroups } from "../../lib/study-notes";
import { FinalMarkdownRenderer } from "../message-renderers/FinalMarkdownRenderer";
import CardItem from "./CardItem";

const VIEW_LABELS: Record<StudyNoteViewMode, string> = {
  full: "完整笔记",
  weak: "薄弱优先",
  exam: "考前精简",
};

function formatNoteTime(value: string): string {
  try {
    return new Date(value).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

interface NoteResultViewProps {
  note: StudyNote;
  viewMode: StudyNoteViewMode;
  onViewModeChange: (mode: StudyNoteViewMode) => void;
  onOpenBook?: (bookId: string) => void;
}

export default function NoteResultView({
  note,
  viewMode,
  onViewModeChange,
  onOpenBook,
}: NoteResultViewProps) {
  const [quizMode, setQuizMode] = useState(false);
  const groups = getStudyNoteGroups(note);

  const visibleCards = (() => {
    if (viewMode === "full") return note.cards;
    if (viewMode === "exam") {
      return note.cards
        .filter((card) => card.masteryBand !== "mastered")
        .slice(0, 4);
    }
    return [...groups.weak, ...groups.familiar, ...groups.unlinked];
  })();

  const toggleQuizMode = useCallback(() => {
    setQuizMode((prev) => !prev);
  }, []);

  return (
    <View style={styles.resultPanel}>
      <View style={styles.resultHeader}>
        <View style={styles.resultTitleWrap}>
          <Text style={styles.resultTitle}>{note.title}</Text>
          <Text style={styles.resultMeta}>
            {formatNoteTime(note.createdAt)} · {note.cards.length} 张卡片
          </Text>
        </View>
        <View style={styles.groupCounts}>
          <Text style={styles.groupCountText}>{groups.weak.length} 薄弱</Text>
          <Text style={styles.groupCountText}>
            {groups.familiar.length} 半熟
          </Text>
        </View>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.summaryLabel}>
          {viewMode === "exam"
            ? "一页速览"
            : viewMode === "weak"
              ? "今日关注"
              : "今日摘要"}
        </Text>
        <View style={styles.markdownWrap}>
          <FinalMarkdownRenderer
            content={viewMode === "exam" ? note.examReview : note.dailySummary}
          />
        </View>
      </View>

      {note.bookId && (
        <TouchableOpacity
          style={styles.bookLink}
          onPress={() => onOpenBook?.(note.bookId!)}
          activeOpacity={0.86}
        >
          <View style={styles.bookIcon}>
            <Ionicons name="book" size={18} color={colors.primary} />
          </View>
          <View style={styles.bookLinkBody}>
            <Text style={styles.bookLinkTitle} numberOfLines={1}>
              {note.bookTitle || "打开整理后的活书"}
            </Text>
            <Text style={styles.bookLinkText}>
              {note.bookStatus === "ready"
                ? "活书已生成，可继续阅读"
                : "已创建活书，打开后会继续生成页面"}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      )}

      {!note.bookId && note.bookError && (
        <View style={styles.bookError}>
          <Ionicons name="warning-outline" size={16} color={colors.error} />
          <Text style={styles.bookErrorText}>{note.bookError}</Text>
        </View>
      )}

      {/* Segmented control + quiz mode toggle */}
      <View style={styles.controlRow}>
        <View style={styles.segmented}>
          {(Object.keys(VIEW_LABELS) as StudyNoteViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.segmentButton,
                viewMode === mode && styles.segmentButtonActive,
              ]}
              onPress={() => onViewModeChange(mode)}
            >
              <Text
                style={[
                  styles.segmentText,
                  viewMode === mode && styles.segmentTextActive,
                ]}
              >
                {VIEW_LABELS[mode]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.quizToggle, quizMode && styles.quizToggleActive]}
          onPress={toggleQuizMode}
        >
          <Ionicons
            name={quizMode ? "flash" : "flash-outline"}
            size={14}
            color={quizMode ? colors.textInverse : colors.primary}
          />
          <Text
            style={[
              styles.quizToggleText,
              quizMode && styles.quizToggleTextActive,
            ]}
          >
            自测
          </Text>
        </TouchableOpacity>
      </View>

      {visibleCards.length === 0 ? (
        <View style={styles.emptyInline}>
          <Text style={styles.emptyInlineText}>当前视图没有匹配的笔记片段</Text>
        </View>
      ) : (
        visibleCards.map((card) => (
          <CardItem key={card.id} card={card} quizMode={quizMode} />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  resultPanel: {
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  resultTitleWrap: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  groupCounts: { alignItems: "flex-end", gap: 3 },
  groupCountText: { fontSize: 11, color: colors.textSecondary },
  summaryBox: {
    backgroundColor: colors.infoLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: 7,
    padding: 10,
    marginTop: 10,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "700",
    marginBottom: 4,
  },
  markdownWrap: { width: "100%" },
  bookLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  bookIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  bookLinkBody: { flex: 1, minWidth: 0 },
  bookLinkTitle: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  bookLinkText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bookError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.errorLight,
    borderRadius: 7,
    padding: 9,
    marginTop: 10,
  },
  bookErrorText: { flex: 1, color: colors.error, fontSize: 12, lineHeight: 17 },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    marginBottom: 2,
  },
  segmented: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.bgInput,
    borderRadius: 7,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  segmentButtonActive: { backgroundColor: colors.bgElevated },
  segmentText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  segmentTextActive: { color: colors.primary },
  quizToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.bgInput,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quizToggleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quizToggleText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
  },
  quizToggleTextActive: { color: colors.textInverse },
  emptyInline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  emptyInlineText: { color: colors.textMuted, fontSize: 13 },
});
