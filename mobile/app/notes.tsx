import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { streamChatWithRetry } from '../lib/streaming';
import { DEFAULT_MODEL, USER_ID } from '../lib/config';
import { colors } from '../lib/theme';
import { useChatStore } from '../lib/store';
import type { MessageAttachment } from '../lib/types';
import {
  addStudyNote,
  createStudyNoteSystemPrompt,
  getStudyNoteGroups,
  loadStudyNotes,
  normalizeStudyNoteFromOutput,
  type StudyNote,
  type StudyNoteCard,
  type StudyNoteMasteryBand,
  type StudyNoteViewMode,
} from '../lib/study-notes';

const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

const VIEW_LABELS: Record<StudyNoteViewMode, string> = {
  full: '完整笔记',
  weak: '薄弱优先',
  exam: '考前精简',
};

const BAND_LABELS: Record<StudyNoteMasteryBand, string> = {
  weak: '薄弱',
  familiar: '半熟',
  mastered: '已掌握',
  unlinked: '待绑定',
};

const BAND_COLORS: Record<StudyNoteMasteryBand, { bg: string; fg: string }> = {
  weak: { bg: colors.errorLight, fg: colors.error },
  familiar: { bg: colors.warningLight, fg: colors.warning },
  mastered: { bg: colors.successLight, fg: colors.success },
  unlinked: { bg: colors.infoLight, fg: colors.info },
};

async function pickNoteImage(source: 'camera' | 'gallery'): Promise<MessageAttachment | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert('权限不足', source === 'camera' ? '需要相机权限才能拍纸质笔记' : '需要相册权限才能选择笔记图片');
    return null;
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.85,
    base64: false,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_IMAGE_SIZE) {
    Alert.alert('图片过大', `请选择 ${MAX_IMAGE_SIZE / 1024 / 1024}MB 以内的图片`);
    return null;
  }

  return {
    type: 'image',
    uri: asset.uri,
    name: asset.fileName || `note_${Date.now()}.jpg`,
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize || undefined,
    metadata: {
      width: asset.width,
      height: asset.height,
      pixelCoordSpace: 'source',
      preservesOriginalImage: true,
    },
  };
}

function formatNoteTime(value: string): string {
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function masteryText(card: StudyNoteCard): string {
  if (card.mastery === null) return BAND_LABELS.unlinked;
  return `${BAND_LABELS[card.masteryBand]} · ${Math.round(card.mastery * 100)}%`;
}

function CardList({ cards }: { cards: StudyNoteCard[] }) {
  if (cards.length === 0) {
    return (
      <View style={styles.emptyInline}>
        <Text style={styles.emptyInlineText}>当前视图没有匹配的笔记片段</Text>
      </View>
    );
  }

  return (
    <>
      {cards.map((card) => {
        const band = BAND_COLORS[card.masteryBand];
        return (
          <View key={card.id} style={styles.noteCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
              <View style={[styles.bandPill, { backgroundColor: band.bg }]}>
                <Text style={[styles.bandText, { color: band.fg }]}>{masteryText(card)}</Text>
              </View>
            </View>
            <Text style={styles.cardSummary}>{card.summary}</Text>
            {card.linkedKnowledgePoints.length > 0 && (
              <View style={styles.tagRow}>
                {card.linkedKnowledgePoints.slice(0, 4).map((item) => (
                  <Text key={item} style={styles.kpTag} numberOfLines={1}>{item}</Text>
                ))}
              </View>
            )}
            {card.keyPoints.length > 0 && (
              <View style={styles.cardSection}>
                <Text style={styles.cardSectionTitle}>知识点</Text>
                {card.keyPoints.map((item) => (
                  <Text key={item} style={styles.bulletText}>- {item}</Text>
                ))}
              </View>
            )}
            {card.formulas.length > 0 && (
              <View style={styles.cardSection}>
                <Text style={styles.cardSectionTitle}>公式</Text>
                {card.formulas.map((item) => (
                  <Text key={item} style={styles.formulaText}>{item}</Text>
                ))}
              </View>
            )}
            {card.questions.length > 0 && (
              <View style={styles.cardSection}>
                <Text style={styles.cardSectionTitle}>疑问点</Text>
                {card.questions.map((item) => (
                  <Text key={item} style={styles.questionText}>? {item}</Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const knowledgeStates = useChatStore((state) => state.learningContext.l2);
  const refreshLearningContext = useChatStore((state) => state.refreshLearningContext);
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<MessageAttachment | null>(null);
  const [manualText, setManualText] = useState('');
  const [viewMode, setViewMode] = useState<StudyNoteViewMode>('full');
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadStudyNotes(), refreshLearningContext().catch(() => undefined)]).then(([stored]) => {
      if (!mounted) return;
      setNotes(stored);
      setSelectedId(stored[0]?.id ?? null);
      setHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, [refreshLearningContext]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) || notes[0] || null,
    [notes, selectedId],
  );

  const visibleCards = useMemo(() => {
    if (!selectedNote) return [];
    if (viewMode === 'full') return selectedNote.cards;
    if (viewMode === 'exam') {
      return selectedNote.cards.filter((card) => card.masteryBand !== 'mastered').slice(0, 4);
    }
    const groups = getStudyNoteGroups(selectedNote);
    return [...groups.weak, ...groups.familiar, ...groups.unlinked];
  }, [selectedNote, viewMode]);

  const handlePickImage = useCallback(async (source: 'camera' | 'gallery') => {
    setError(null);
    try {
      const attachment = await pickNoteImage(source);
      if (attachment) setSelectedImage(attachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : '选择图片失败');
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    const text = manualText.trim();
    if (!selectedImage && !text) {
      Alert.alert('缺少内容', '请先拍一页笔记，或手动输入笔记文字');
      return;
    }

    setLoading(true);
    setError(null);
    let output = '';
    let failed = false;

    try {
      await streamChatWithRetry(
        {
          message: [
            '请整理这页纸质学习笔记。',
            text ? `学生手动补充：${text}` : '',
            '请输出可直接 JSON.parse 的结构化结果。',
          ]
            .filter(Boolean)
            .join('\n'),
          systemPrompt: createStudyNoteSystemPrompt(knowledgeStates),
          model: DEFAULT_MODEL,
          capability: 'chat',
          userId: USER_ID,
          conversationId: `mobile-note-${Date.now()}`,
          attachments: selectedImage ? [selectedImage] : undefined,
          onEvent: (event) => {
            if (event.type === 'text_delta') output += event.data.content || '';
          },
          onComplete: () => {},
          onError: (err) => {
            failed = true;
            setError(err.message || '笔记整理失败');
          },
        },
        2,
      );

      if (failed) return;
      if (!output.trim()) throw new Error('AI 没有返回可整理内容');

      const note = normalizeStudyNoteFromOutput({
        rawOutput: output.trim(),
        imageUri: selectedImage?.uri,
        manualText: text || undefined,
        knowledgeStates,
      });
      const next = await addStudyNote(note);
      setNotes(next);
      setSelectedId(note.id);
      setViewMode('full');
      setManualText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '笔记整理失败');
    } finally {
      setLoading(false);
    }
  }, [knowledgeStates, manualText, selectedImage]);

  const groups = selectedNote ? getStudyNoteGroups(selectedNote) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={23} color={colors.textInverse} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>笔记整理</Text>
          <Text style={styles.headerSubtitle}>拍照转复习卡</Text>
        </View>
        <TouchableOpacity onPress={() => refreshLearningContext()} style={styles.headerButton}>
          <Ionicons name="refresh" size={21} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.capturePanel}>
          <View style={styles.captureTop}>
            <View>
              <Text style={styles.panelTitle}>纸质笔记电子化</Text>
              <Text style={styles.panelSubtitle}>优先生成结构化知识卡，再按掌握度压缩</Text>
            </View>
            {knowledgeStates.length > 0 && (
              <View style={styles.stateBadge}>
                <Ionicons name="analytics-outline" size={14} color={colors.primary} />
                <Text style={styles.stateBadgeText}>{knowledgeStates.length} 个知识点</Text>
              </View>
            )}
          </View>

          <View style={styles.pickRow}>
            <TouchableOpacity style={styles.pickButton} onPress={() => handlePickImage('camera')}>
              <Ionicons name="camera" size={18} color={colors.textInverse} />
              <Text style={styles.pickButtonText}>拍一页</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => handlePickImage('gallery')}>
              <Ionicons name="images-outline" size={18} color={colors.primary} />
              <Text style={styles.secondaryButtonText}>从相册选</Text>
            </TouchableOpacity>
          </View>

          {selectedImage && (
            <View style={styles.imagePreviewRow}>
              <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
              <View style={styles.imageMeta}>
                <Text style={styles.imageName} numberOfLines={1}>{selectedImage.name}</Text>
                <Text style={styles.imageHint}>会随请求发送给 AI 导师 fast 通道</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedImage(null)} style={styles.clearImageButton}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          <TextInput
            value={manualText}
            onChangeText={setManualText}
            placeholder="可选：补充老师板书、页码、你看不懂的地方..."
            placeholderTextColor={colors.textMuted}
            style={styles.manualInput}
            multiline
            textAlignVertical="top"
          />

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="warning-outline" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.generateButton, loading && styles.disabledButton]}
            onPress={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Ionicons name="sparkles" size={18} color={colors.textInverse} />
            )}
            <Text style={styles.generateButtonText}>{loading ? '整理中...' : '生成复习卡'}</Text>
          </TouchableOpacity>
        </View>

        {notes.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.historyScroller}>
            {notes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={[styles.historyChip, note.id === selectedNote?.id && styles.historyChipActive]}
                onPress={() => setSelectedId(note.id)}
              >
                <Text
                  style={[styles.historyChipTitle, note.id === selectedNote?.id && styles.historyChipTitleActive]}
                  numberOfLines={1}
                >
                  {note.title}
                </Text>
                <Text style={styles.historyChipDate}>{formatNoteTime(note.createdAt)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {!hydrated ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : selectedNote ? (
          <View style={styles.resultPanel}>
            <View style={styles.resultHeader}>
              <View style={styles.resultTitleWrap}>
                <Text style={styles.resultTitle}>{selectedNote.title}</Text>
                <Text style={styles.resultMeta}>
                  {formatNoteTime(selectedNote.createdAt)} · {selectedNote.cards.length} 张卡片
                </Text>
              </View>
              {groups && (
                <View style={styles.groupCounts}>
                  <Text style={styles.groupCountText}>{groups.weak.length} 薄弱</Text>
                  <Text style={styles.groupCountText}>{groups.familiar.length} 半熟</Text>
                </View>
              )}
            </View>

            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>
                {viewMode === 'exam' ? '一页速览' : viewMode === 'weak' ? '今日关注' : '今日摘要'}
              </Text>
              <Text style={styles.summaryText}>
                {viewMode === 'exam' ? selectedNote.examReview : selectedNote.dailySummary}
              </Text>
            </View>

            <View style={styles.segmented}>
              {(Object.keys(VIEW_LABELS) as StudyNoteViewMode[]).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.segmentButton, viewMode === mode && styles.segmentButtonActive]}
                  onPress={() => setViewMode(mode)}
                >
                  <Text style={[styles.segmentText, viewMode === mode && styles.segmentTextActive]}>
                    {VIEW_LABELS[mode]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <CardList cards={visibleCards} />
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>还没有电子化笔记</Text>
            <Text style={styles.emptyText}>拍一页课堂笔记，先生成结构化复习卡，再看薄弱和考前精简版。</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPage },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  headerButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.textInverse },
  headerSubtitle: { fontSize: 12, color: colors.textInverse, opacity: 0.8, marginTop: 1 },
  content: { padding: 14, gap: 12 },
  capturePanel: {
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  captureTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  panelTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  panelSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.infoLight,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  stateBadgeText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  pickRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  pickButton: {
    flex: 1,
    height: 42,
    borderRadius: 7,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
  secondaryButton: {
    flex: 1,
    height: 42,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.bgElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 8,
    marginTop: 12,
    gap: 10,
  },
  previewImage: { width: 52, height: 52, borderRadius: 6, backgroundColor: colors.bgInput },
  imageMeta: { flex: 1, minWidth: 0 },
  imageName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  imageHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  clearImageButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualInput: {
    minHeight: 82,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.bgInput,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 12,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.errorLight,
    padding: 10,
    borderRadius: 7,
    marginTop: 10,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 12, lineHeight: 17 },
  generateButton: {
    height: 44,
    borderRadius: 7,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 12,
  },
  disabledButton: { opacity: 0.68 },
  generateButtonText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  historyScroller: { marginHorizontal: -14, paddingHorizontal: 14 },
  historyChip: {
    width: 148,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginRight: 8,
  },
  historyChipActive: { borderColor: colors.primary, backgroundColor: colors.infoLight },
  historyChipTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  historyChipTitleActive: { color: colors.primary },
  historyChipDate: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
  },
  resultPanel: {
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  resultTitleWrap: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  groupCounts: { alignItems: 'flex-end', gap: 2 },
  groupCountText: { fontSize: 11, color: colors.textSecondary },
  summaryBox: {
    backgroundColor: colors.quoteBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: 7,
    padding: 11,
    marginTop: 12,
  },
  summaryLabel: { fontSize: 12, color: colors.primary, fontWeight: '700', marginBottom: 4 },
  summaryText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bgInput,
    borderRadius: 8,
    padding: 3,
    marginTop: 12,
    marginBottom: 10,
  },
  segmentButton: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  segmentButtonActive: { backgroundColor: colors.bgElevated },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.primary },
  noteCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  bandPill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  bandText: { fontSize: 11, fontWeight: '700' },
  cardSummary: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  kpTag: {
    maxWidth: 150,
    color: colors.primary,
    backgroundColor: colors.infoLight,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 11,
    overflow: 'hidden',
  },
  cardSection: { marginTop: 10, gap: 4 },
  cardSectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  bulletText: { fontSize: 13, lineHeight: 19, color: colors.textPrimary },
  formulaText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.reasoningText,
    backgroundColor: colors.reasoning,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  questionText: { fontSize: 13, lineHeight: 19, color: colors.error },
  emptyInline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyInlineText: { color: colors.textMuted, fontSize: 13 },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 190,
    padding: 24,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 10 },
  emptyText: { fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: 'center', marginTop: 6 },
});
