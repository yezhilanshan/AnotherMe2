import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { useFocusEffect, useRouter } from "expo-router";
import { streamChatWithRetry } from "../../lib/streaming";
import { DEFAULT_MODEL, USER_ID } from "../../lib/config";
import { colors } from "../../lib/theme";
import { BackgroundImage } from "../../components/ui/BackgroundImage";
import { useChatStore } from "../../lib/store";
import type { MessageAttachment } from "../../lib/types";
import { formatLiveBookError, liveBookApi } from "../../lib/api";
import {
  addStudyNote,
  buildStudyNoteLiveBookTopic,
  clearStudyNoteDraft,
  createStudyNoteSystemPrompt,
  deleteStudyNote,
  loadStudyNoteDraft,
  loadStudyNotes,
  normalizeStudyNoteFromOutput,
  saveStudyNoteDraft,
  subscribeStudyNotes,
  updateStudyNote,
  type StudyNote,
} from "../../lib/study-notes";
import CapturePanel from "../../components/notes/CapturePanel";
import NoteRecordDrawer from "../../components/notes/NoteRecordDrawer";
import { syncNoteToServer } from "../../lib/notebook-sync";

const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_NOTE_IMAGES = 5;

// 参考图片风格：桃色背景 + 紫/橙强调色
const PEACH_OVERLAY = "rgba(255, 245, 240, 0.72)";
const PURPLE = "#6B5CE7";
const PURPLE_LIGHT = "#EDE9FF";
const ORANGE = "#FF8C61";
const ORANGE_LIGHT = "#FFE8E0";
const GLASS_BG = "rgba(255, 252, 249, 0.88)";
const GLASS_BORDER = "rgba(255, 255, 255, 0.6)";
const CARD_SHADOW = {
  shadowColor: "#5A3E36",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 4,
};

function makeNoteId(): string {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

async function imageAssetToAttachment(
  asset: ImagePicker.ImagePickerAsset,
  index: number,
): Promise<MessageAttachment | null> {
  let fileSize = asset.fileSize;
  if (!fileSize) {
    try {
      const info = await FileSystem.getInfoAsync(asset.uri);
      if (info.exists && info.size) fileSize = info.size;
    } catch {
      // ignore
    }
  }

  if (fileSize && fileSize > MAX_IMAGE_SIZE) {
    Alert.alert(
      "图片过大",
      `第 ${index + 1} 张图片超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB，已跳过`,
    );
    return null;
  }

  return {
    type: "image",
    uri: asset.uri,
    name: asset.fileName || `note_${Date.now()}_${index + 1}.jpg`,
    mimeType: asset.mimeType || "image/jpeg",
    size: fileSize || undefined,
    metadata: {
      width: asset.width,
      height: asset.height,
      pixelCoordSpace: "source",
      preservesOriginalImage: true,
    },
  };
}

async function pickNoteImages(
  source: "camera" | "gallery",
  remainingSlots: number,
): Promise<MessageAttachment[]> {
  if (remainingSlots <= 0) {
    Alert.alert("已达上限", `一次最多上传 ${MAX_NOTE_IMAGES} 张笔记图片`);
    return [];
  }

  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert(
      "权限不足",
      source === "camera"
        ? "需要相机权限才能拍纸质笔记"
        : "需要相册权限才能选择笔记图片",
    );
    return [];
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.72,
    base64: false,
  };
  if (source === "gallery") {
    options.allowsMultipleSelection = remainingSlots > 1;
    options.selectionLimit = remainingSlots;
    options.orderedSelection = true;
  }

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.length) return [];
  const selected = result.assets.slice(0, remainingSlots);
  if (result.assets.length > remainingSlots) {
    Alert.alert(
      "已截取前几张",
      `当前还可添加 ${remainingSlots} 张，已保留选择顺序中的前 ${remainingSlots} 张。`,
    );
  }

  const attachments: MessageAttachment[] = [];
  for (let i = 0; i < selected.length; i++) {
    const attachment = await imageAssetToAttachment(selected[i], i);
    if (attachment) attachments.push(attachment);
  }
  return attachments;
}

function statusText(note: StudyNote): string {
  if (note.status === "generating") return note.loadingLabel || "正在生成活书...";
  if (note.status === "failed") return note.error || note.bookError || "生成失败";
  if (note.bookId) return "已生成活书";
  return "等待创建活书";
}

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const knowledgeStates = useChatStore((state) => state.learningContext.l2);
  const refreshLearningContext = useChatStore(
    (state) => state.refreshLearningContext,
  );
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<MessageAttachment[]>([]);
  const [manualText, setManualText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const activeControllerRef = useRef<AbortController | null>(null);

  const refreshNotes = useCallback(async () => {
    const stored = await loadStudyNotes();
    if (!mountedRef.current) return;
    setNotes(stored);
    setSelectedId((prev) => {
      if (prev && stored.some((note) => note.id === prev)) return prev;
      return stored[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      refreshNotes();
      refreshLearningContext().catch(() => undefined);
      return () => {
        focusedRef.current = false;
      };
    }, [refreshLearningContext, refreshNotes]),
  );

  useEffect(() => {
    const unsubscribe = subscribeStudyNotes(() => {
      refreshNotes();
    });
    return unsubscribe;
  }, [refreshNotes]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      loadStudyNotes(),
      loadStudyNoteDraft(),
      refreshLearningContext().catch(() => undefined),
    ]).then(([stored, draft]) => {
      if (!mounted) return;
      setNotes(stored);
      setSelectedId(stored[0]?.id ?? null);
      if (draft) {
        if (draft.manualText) setManualText(draft.manualText);
        const draftUris =
          draft.imageUris?.length
            ? draft.imageUris
            : draft.imageUri
              ? [draft.imageUri]
              : [];
        if (draftUris.length) {
          setSelectedImages(
            draftUris.slice(0, MAX_NOTE_IMAGES).map((uri, index) => ({
              type: "image",
              uri,
              name: `draft_${index + 1}.jpg`,
              mimeType: "image/jpeg",
            })),
          );
        }
      }
      setHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, [refreshLearningContext]);

  const selectedNote = useMemo(
    () => notes.find((item) => item.id === selectedId) || null,
    [notes, selectedId],
  );
  const generatingNote = useMemo(
    () => notes.find((note) => note.status === "generating") || null,
    [notes],
  );
  const busy = loading || Boolean(generatingNote);

  const openBook = useCallback(
    (bookId: string) => {
      router.push({ pathname: "/book-reader", params: { bookId } });
    },
    [router],
  );

  const handlePickImage = useCallback(
    async (source: "camera" | "gallery") => {
      setError(null);
      try {
        const remainingSlots = MAX_NOTE_IMAGES - selectedImages.length;
        const attachments = await pickNoteImages(source, remainingSlots);
        if (attachments.length) {
          setSelectedImages((prev) =>
            [...prev, ...attachments].slice(0, MAX_NOTE_IMAGES),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "选择图片失败");
      }
    },
    [selectedImages.length],
  );

  const syncLocalNotes = useCallback(async () => {
    const next = await loadStudyNotes();
    if (mountedRef.current) setNotes(next);
    return next;
  }, []);

  const handleGenerate = useCallback(async () => {
    const text = manualText.trim();
    const imageUris = selectedImages
      .map((image) => image.uri)
      .filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
    if (selectedImages.length === 0 && !text) {
      Alert.alert("缺少内容", "请先拍笔记，或手动输入笔记文字");
      return;
    }
    if (generatingNote) {
      setSelectedId(generatingNote.id);
      Alert.alert("已有任务生成中", "请等待当前笔记活书生成完成。");
      return;
    }

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;

    const noteId = makeNoteId();
    const createdAt = new Date().toISOString();
    const draftTitle =
      text.slice(0, 18) ||
      (imageUris.length > 1 ? `${imageUris.length} 页纸质笔记` : "纸质笔记活书");
    const placeholder: StudyNote = {
      id: noteId,
      title: draftTitle,
      createdAt,
      updatedAt: createdAt,
      status: "generating",
      loadingLabel: "正在识别笔记...",
      progress: 8,
      imageUris,
      imageUri: imageUris[0],
      manualText: text || undefined,
      dailySummary: "",
      examReview: "",
      cards: [],
      rawOutput: "",
    };

    if (mountedRef.current) {
      setLoading(true);
      setLoadingLabel("正在识别笔记...");
      setError(null);
      setSelectedId(noteId);
    }
    await addStudyNote(placeholder);

    saveStudyNoteDraft({
      imageUris,
      imageUri: imageUris[0],
      manualText: text || undefined,
      savedAt: new Date().toISOString(),
    });

    const patchGeneratingNote = async (patch: Partial<StudyNote>) => {
      await updateStudyNote(noteId, {
        ...patch,
        status: patch.status || "generating",
      });
      await syncLocalNotes();
      if (mountedRef.current && patch.loadingLabel) {
        setLoadingLabel(patch.loadingLabel);
      }
    };

    let output = "";
    let finalOutput = "";
    let failed = false;

    try {
      await streamChatWithRetry(
        {
          message: [
            selectedImages.length
              ? `请整理这份纸质学习笔记，共 ${selectedImages.length} 张图片，按选择顺序视作连续页面。`
              : "请整理这份学习笔记。",
            text ? `学生手动补充：${text}` : "",
            "请输出可直接 JSON.parse 的结构化结果。",
          ]
            .filter(Boolean)
            .join("\n"),
          systemPrompt: createStudyNoteSystemPrompt(knowledgeStates),
          model: DEFAULT_MODEL,
          capability: "chat",
          userId: USER_ID,
          conversationId: `mobile-note-${noteId}`,
          attachments: selectedImages.length ? selectedImages : undefined,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "upload_status") {
              const count = event.data.image_count || event.data.attachment_count;
              if (count) {
                void patchGeneratingNote({
                  loadingLabel: `已上传 ${count} 张图片，正在识别...`,
                  progress: 18,
                });
              }
            }
            if (event.type === "text_delta") {
              const chunk = event.data.content || "";
              output += chunk;
            }
            if (event.type === "final_markdown") {
              finalOutput = event.data.content || finalOutput;
            }
          },
          onComplete: () => {},
          onError: (err) => {
            failed = true;
            const message = err.message || "笔记整理失败";
            void updateStudyNote(noteId, {
              status: "failed",
              loadingLabel: undefined,
              error: message,
            });
            if (mountedRef.current) setError(message);
          },
        },
        2,
      );

      if (controller.signal.aborted) return;
      if (failed) return;

      const rawOutput = (finalOutput || output).trim();
      if (!rawOutput) {
        const message = "AI 没有返回可整理内容";
        await updateStudyNote(noteId, {
          status: "failed",
          loadingLabel: undefined,
          error: message,
        });
        if (mountedRef.current) setError(message);
        return;
      }

      const note = normalizeStudyNoteFromOutput({
        id: noteId,
        createdAt,
        rawOutput,
        imageUris,
        imageUri: imageUris[0],
        manualText: text || undefined,
        knowledgeStates,
      });

      await patchGeneratingNote({
        ...note,
        status: "generating",
        loadingLabel: "正在创建活书...",
        progress: 48,
      });

      let noteToSave: StudyNote = note;
      try {
        const topic = buildStudyNoteLiveBookTopic(note, {
          imageCount: selectedImages.length,
        });
        const created = await liveBookApi.createBook({
          topic,
          language: "zh",
        });
        const book = created.book || {};
        const bookId = typeof book.id === "string" ? book.id : "";
        if (!bookId) throw new Error("活书引擎没有返回 bookId");

        await patchGeneratingNote({
          bookId,
          bookTitle:
            (typeof book.title === "string" && book.title) || note.title,
          bookStatus: "draft",
          loadingLabel: "正在生成活书目录...",
          progress: 66,
        });

        const proposal =
          created.proposal && typeof created.proposal === "object"
            ? (created.proposal as Record<string, unknown>)
            : undefined;
        const confirmed = await liveBookApi.confirmProposal({
          book_id: bookId,
          proposal,
        });

        await patchGeneratingNote({
          bookStatus: "spine_ready",
          loadingLabel: "正在准备阅读页...",
          progress: 82,
        });

        const spine =
          confirmed.spine && typeof confirmed.spine === "object"
            ? (confirmed.spine as Record<string, unknown>)
            : undefined;
        await liveBookApi.confirmSpine({
          book_id: bookId,
          spine,
          auto_compile: true,
        });

        noteToSave = {
          ...note,
          bookId,
          bookTitle:
            (typeof book.title === "string" && book.title) || note.title,
          bookStatus: "compiling",
          status: "ready",
          loadingLabel: undefined,
          error: undefined,
          progress: 100,
          updatedAt: new Date().toISOString(),
        };
      } catch (bookErr) {
        const msg = formatLiveBookError(bookErr, "创建活书失败");
        noteToSave = {
          ...note,
          status: "failed",
          loadingLabel: undefined,
          error: msg,
          bookError: msg,
          updatedAt: new Date().toISOString(),
        };
        if (mountedRef.current) setError(msg);
      }

      await addStudyNote(noteToSave);
      await clearStudyNoteDraft();
      syncNoteToServer(noteToSave).catch(() => {});

      if (mountedRef.current) {
        setSelectedId(noteToSave.id);
        setManualText("");
        setSelectedImages([]);
        setLoading(false);
        setLoadingLabel("");
        if (noteToSave.bookId && focusedRef.current) {
          openBook(noteToSave.bookId);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "笔记整理失败";
        await updateStudyNote(noteId, {
          status: "failed",
          loadingLabel: undefined,
          error: message,
        });
        if (mountedRef.current) setError(message);
      }
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
      if (mountedRef.current) {
        setLoading(false);
        setLoadingLabel("");
      }
      await syncLocalNotes();
    }
  }, [
    generatingNote,
    knowledgeStates,
    manualText,
    openBook,
    selectedImages,
    syncLocalNotes,
  ]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    const next = await deleteStudyNote(noteId);
    if (mountedRef.current) {
      setNotes(next);
      setSelectedId((prev) => (prev === noteId ? (next[0]?.id ?? null) : prev));
    }
  }, []);

  const handleSelectRecord = useCallback(
    (note: StudyNote) => {
      setSelectedId(note.id);
      setDrawerVisible(false);
      if (note.status === "ready" && note.bookId) {
        openBook(note.bookId);
      }
    },
    [openBook],
  );

  const handleCreateNew = useCallback(() => {
    setSelectedId(null);
    setError(null);
    setDrawerVisible(false);
  }, []);

  const handleClearImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearImages = useCallback(() => {
    setSelectedImages([]);
  }, []);

  const activeRecord = generatingNote || selectedNote;
  const showCapture = !activeRecord || activeRecord.status === "failed";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackgroundImage
        source={require("../../assets/backgrounds/notes_bg.png")}
        overlayColor={PEACH_OVERLAY}
      />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setDrawerVisible(true)}
          style={styles.headerButton}
          hitSlop={8}
        >
          <Ionicons name="menu" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>笔记整理</Text>
          <Text style={styles.headerSubtitle}>
            {generatingNote ? "活书正在生成" : `${notes.length} 条记录`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleCreateNew}
          style={styles.headerButton}
          hitSlop={8}
        >
          <Ionicons name="add" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 26 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!hydrated ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {activeRecord && !showCapture ? (
              <View style={styles.bookPanel}>
                <View style={styles.bookTopRow}>
                  <View style={styles.bookIcon}>
                    {activeRecord.status === "generating" ? (
                      <ActivityIndicator size="small" color={colors.warning} />
                    ) : (
                      <Ionicons name="book" size={22} color={colors.primary} />
                    )}
                  </View>
                  <View style={styles.bookTitleWrap}>
                    <Text style={styles.bookTitle} numberOfLines={2}>
                      {activeRecord.bookTitle || activeRecord.title}
                    </Text>
                    <Text style={styles.bookMeta} numberOfLines={1}>
                      {formatNoteTime(activeRecord.updatedAt || activeRecord.createdAt)}
                    </Text>
                  </View>
                </View>

                <View style={styles.statusBox}>
                  <Text style={styles.statusLabel}>
                    {activeRecord.status === "generating" ? "生成状态" : "阅读入口"}
                  </Text>
                  <Text style={styles.statusValue}>{statusText(activeRecord)}</Text>
                  {activeRecord.status === "generating" ? (
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.max(
                              6,
                              Math.min(100, activeRecord.progress || 12),
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>

                {activeRecord.bookId && (
                  <TouchableOpacity
                    style={styles.openBookButton}
                    onPress={() => openBook(activeRecord.bookId!)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="reader" size={18} color={colors.textInverse} />
                    <Text style={styles.openBookText}>打开活书</Text>
                  </TouchableOpacity>
                )}

                {activeRecord.status === "generating" && (
                  <Text style={styles.inlineHint}>
                    离开此页面后，记录管理中仍会保留当前生成状态。
                  </Text>
                )}
              </View>
            ) : null}

            {showCapture ? (
              <CapturePanel
                loading={busy}
                selectedImages={selectedImages}
                manualText={manualText}
                error={error || activeRecord?.error || null}
                knowledgeStateCount={knowledgeStates.length}
                loadingLabel={loadingLabel || generatingNote?.loadingLabel}
                onPickImage={handlePickImage}
                onClearImage={handleClearImage}
                onClearImages={handleClearImages}
                onManualTextChange={setManualText}
                onGenerate={handleGenerate}
              />
            ) : null}

            {!activeRecord && !showCapture ? (
              <View style={styles.emptyState}>
                <Image
                  source={require("../../assets/illustrations/notes_empty.png")}
                  style={styles.emptyStateImage}
                  resizeMode="contain"
                />
                <Text style={styles.emptyTitle}>拍一份笔记生成活书</Text>
                <Text style={styles.emptyText}>
                  支持多页图片和文字补充，生成后会直接进入互动阅读。
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <NoteRecordDrawer
        visible={drawerVisible}
        notes={notes}
        activeNoteId={activeRecord?.id ?? selectedId}
        onClose={() => setDrawerVisible(false)}
        onCreateNew={handleCreateNew}
        onSelect={handleSelectRecord}
        onDelete={handleDeleteNote}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "rgba(0,0,0,0)" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  headerTitleWrap: { flex: 1, alignItems: "center", minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: "800", color: colors.textPrimary },
  headerSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  content: { padding: 12, gap: 12 },
  centerBlock: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
  },
  bookPanel: {
    backgroundColor: GLASS_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 24,
    padding: 16,
    ...CARD_SHADOW,
  },
  bookTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bookIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PURPLE_LIGHT,
  },
  bookTitleWrap: { flex: 1, minWidth: 0 },
  bookTitle: {
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22,
    color: colors.textPrimary,
  },
  bookMeta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  statusBox: {
    marginTop: 14,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  statusLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "700" },
  statusValue: {
    marginTop: 5,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  progressBar: {
    height: 6,
    marginTop: 12,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "rgba(107,92,231,0.12)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: PURPLE,
  },
  openBookButton: {
    height: 48,
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: PURPLE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    ...CARD_SHADOW,
  },
  openBookText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
  },
  inlineHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GLASS_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    minHeight: 280,
    padding: 24,
    ...CARD_SHADOW,
  },
  emptyStateImage: {
    width: 160,
    height: 160,
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.textPrimary,
    marginTop: 10,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 6,
  },
});
