import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";
import type { StudyNote, StudyNoteStatus } from "../../lib/study-notes";

const SCREEN_WIDTH = Dimensions.get("window").width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.84;

interface NoteRecordDrawerProps {
  visible: boolean;
  notes: StudyNote[];
  activeNoteId: string | null;
  onClose: () => void;
  onCreateNew: () => void;
  onSelect: (note: StudyNote) => void;
  onDelete: (noteId: string) => void;
}

function formatNoteTime(value?: string): string {
  if (!value) return "";
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

function statusMeta(status?: StudyNoteStatus): {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  if (status === "generating") {
    return { label: "生成中", icon: "sync", color: colors.warning };
  }
  if (status === "failed") {
    return { label: "失败", icon: "alert-circle", color: colors.error };
  }
  return { label: "活书", icon: "book", color: colors.primary };
}

export default function NoteRecordDrawer({
  visible,
  notes,
  activeNoteId,
  onClose,
  onCreateNew,
  onSelect,
  onDelete,
}: NoteRecordDrawerProps) {
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setQuery("");
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 42,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [fadeAnim, slideAnim, visible]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((note) =>
      [note.title, note.bookTitle, note.manualText, note.loadingLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [notes, query]);

  const confirmDelete = (note: StudyNote) => {
    Alert.alert("删除记录", `确定删除「${note.title}」？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => onDelete(note.id),
      },
    ]);
  };

  const renderNote = ({ item }: { item: StudyNote }) => {
    const meta = statusMeta(item.status);
    const active = item.id === activeNoteId;
    return (
      <TouchableOpacity
        style={[styles.recordItem, active && styles.recordItemActive]}
        onPress={() => onSelect(item)}
        onLongPress={() => confirmDelete(item)}
        activeOpacity={0.78}
      >
        <View style={[styles.recordIcon, { backgroundColor: `${meta.color}22` }]}>
          <Ionicons name={meta.icon} size={18} color={meta.color} />
        </View>
        <View style={styles.recordBody}>
          <Text
            style={[styles.recordTitle, active && styles.recordTitleActive]}
            numberOfLines={1}
          >
            {item.bookTitle || item.title}
          </Text>
          <Text style={styles.recordSub} numberOfLines={1}>
            {item.loadingLabel || item.error || formatNoteTime(item.updatedAt || item.createdAt)}
          </Text>
        </View>
        <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
        </TouchableOpacity>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>笔记记录</Text>
              <Text style={styles.subtitle}>{notes.length} 条活书记录</Text>
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchInputWrap}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索笔记记录..."
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          <TouchableOpacity
            style={styles.createButton}
            onPress={onCreateNew}
            activeOpacity={0.84}
          >
            <Ionicons name="add" size={19} color={colors.textInverse} />
            <Text style={styles.createButtonText}>新建笔记整理</Text>
          </TouchableOpacity>

          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderNote}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name="library-outline"
                  size={42}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyText}>
                  {query.trim() ? "未找到匹配记录" : "还没有笔记记录"}
                </Text>
              </View>
            }
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.34)" },
  drawer: {
    height: "100%",
    backgroundColor: colors.bgPage,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 9,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgInput,
  },
  searchInputWrap: {
    height: 40,
    marginHorizontal: 14,
    marginTop: 12,
    borderRadius: 8,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 7,
    paddingVertical: 0,
    fontSize: 14,
    color: colors.textPrimary,
  },
  createButton: {
    height: 42,
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  createButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "800",
  },
  listContent: { paddingTop: 12, paddingBottom: 18 },
  recordItem: {
    minHeight: 68,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.infoLight,
  },
  recordIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  recordBody: { flex: 1, minWidth: 0 },
  recordTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  recordTitleActive: { color: colors.primaryDark },
  recordSub: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
    marginLeft: 8,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 72,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 10,
  },
});
