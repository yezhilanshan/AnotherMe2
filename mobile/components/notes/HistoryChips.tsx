import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import { colors } from "../../lib/theme";
import type { StudyNote } from "../../lib/study-notes";

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

interface HistoryChipsProps {
  notes: StudyNote[];
  selectedNote: StudyNote | null;
  loading: boolean;
  onSelect: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

export default function HistoryChips({
  notes,
  selectedNote,
  loading,
  onSelect,
  onDelete,
}: HistoryChipsProps) {
  if (notes.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.historyScroller}
    >
      {notes.map((note) => (
        <TouchableOpacity
          key={note.id}
          style={[
            styles.historyChip,
            note.id === selectedNote?.id && styles.historyChipActive,
            loading && styles.disabledChip,
          ]}
          onPress={() => onSelect(note.id)}
          onLongPress={() => onDelete(note.id)}
          disabled={loading}
        >
          <Text
            style={[
              styles.historyChipTitle,
              note.id === selectedNote?.id && styles.historyChipTitleActive,
            ]}
            numberOfLines={1}
          >
            {note.title}
          </Text>
          <Text style={styles.historyChipDate}>
            {formatNoteTime(note.createdAt)}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  historyScroller: { marginHorizontal: -12, paddingHorizontal: 12 },
  historyChip: {
    width: 120,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginRight: 8,
  },
  historyChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.infoLight,
  },
  historyChipTitle: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  historyChipTitleActive: { color: colors.primary },
  historyChipDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  disabledChip: { opacity: 0.5 },
});
