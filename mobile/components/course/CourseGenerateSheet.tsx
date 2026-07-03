import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Types ──

export type CourseJobStatus = 'idle' | 'uploading' | 'creating_job' | 'queued' | 'running' | 'completed' | 'failed';

export interface CourseJobState {
  status: CourseJobStatus;
  jobId: string | null;
  progress: number;
  step: string;
  classroomId: string | null;
  error: string | null;
}

export const EMPTY_JOB: CourseJobState = {
  status: 'idle',
  jobId: null,
  progress: 0,
  step: '',
  classroomId: null,
  error: null,
};

const PROCESSING_STATUSES: CourseJobStatus[] = ['uploading', 'creating_job', 'queued', 'running'];

export interface SelectedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

interface CourseGenerateSheetProps {
  visible: boolean;
  onClose: () => void;
  job: CourseJobState;
  onGenerate: (topic: string, requirements: string, file?: SelectedFile) => void;
  onEnterClassroom: (classroomId: string) => void;
  onReset: () => void;
}

// ── Recommended topics ──

const RECOMMENDED_TOPICS = [
  { label: '勾股定理', icon: '📐' },
  { label: '光合作用', icon: '🌿' },
  { label: '二次函数', icon: '📈' },
  { label: '唐诗宋词', icon: '📜' },
  { label: '电磁感应', icon: '⚡' },
  { label: '细胞分裂', icon: '🔬' },
  { label: '概率统计', icon: '🎲' },
  { label: '化学平衡', icon: '⚗️' },
];

// ── Progress steps ──

const PROGRESS_STEPS = [
  { key: 'analyze', label: '分析主题与需求' },
  { key: 'outline', label: '构建课堂大纲' },
  { key: 'scenes', label: '生成场景内容' },
  { key: 'config', label: '配置交互元素' },
];

// ── Component ──

export default function CourseGenerateSheet({
  visible,
  onClose,
  job,
  onGenerate,
  onEnterClassroom,
  onReset,
}: CourseGenerateSheetProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [topic, setTopic] = useState('');
  const [requirements, setRequirements] = useState('');
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);

  const breatheAnim = useRef(new Animated.Value(0)).current;
  const checkAnims = useRef(PROGRESS_STEPS.map(() => new Animated.Value(0))).current;

  const isProcessing = PROCESSING_STATUSES.includes(job.status);
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';

  useEffect(() => {
    if (visible && job.status === 'idle') {
      setStep(1);
      setTopic('');
      setRequirements('');
      setSelectedFile(null);
    }
  }, [visible]);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const guessMime = (name: string, mime?: string | null) => {
      if (mime) return mime;
      const l = name.toLowerCase();
      if (l.endsWith('.pdf')) return 'application/pdf';
      if (l.endsWith('.txt')) return 'text/plain';
      if (l.endsWith('.md')) return 'text/markdown';
      if (l.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      return 'application/octet-stream';
    };
    setSelectedFile({ uri: asset.uri, name: asset.name || 'material', mimeType: guessMime(asset.name || '', asset.mimeType), size: asset.size });
  };

  function formatFileSize(size?: number) {
    if (!size || size <= 0) return '';
    if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  // Breathing animation
  useEffect(() => {
    if (isProcessing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(breatheAnim, { toValue: 0.2, duration: 1400, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      breatheAnim.setValue(0);
    }
  }, [isProcessing]);

  // Checkmark animation
  useEffect(() => {
    if (!isProcessing && !isCompleted) return;
    const thresholds = [15, 40, 70, 95];
    thresholds.forEach((threshold, idx) => {
      Animated.timing(checkAnims[idx], {
        toValue: job.progress >= threshold || isCompleted ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
  }, [job.progress, isCompleted, isProcessing]);

  const handleNext = () => { if (step === 1 && topic.trim()) setStep(2); };
  const handleBack = () => { if (step === 2) setStep(1); };
  const handleGenerate = () => { setStep(3); onGenerate(topic.trim(), requirements.trim(), selectedFile || undefined); };
  const handleReset = () => { setStep(1); setTopic(''); setRequirements(''); setSelectedFile(null); onReset(); };
  const handleClose = () => { if (!isProcessing) onClose(); };

  // ── Step indicator ──

  const renderStepIndicator = () => (
    <View style={styles.stepRow}>
      {[
        { n: 1, label: '主题' },
        { n: 2, label: '补充' },
        { n: 3, label: '生成' },
      ].map((s, i) => (
        <React.Fragment key={s.n}>
          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, step >= s.n && styles.stepCircleActive]}>
              {step > s.n ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <Text style={[styles.stepNum, step >= s.n && styles.stepNumActive]}>{s.n}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, step >= s.n && styles.stepLabelActive]}>{s.label}</Text>
          </View>
          {i < 2 && <View style={[styles.stepLine, step > s.n && styles.stepLineActive]} />}
        </React.Fragment>
      ))}
    </View>
  );

  // ── Step 1: Topic ──

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.fieldLabel}>课堂主题</Text>
      <TextInput
        value={topic}
        onChangeText={setTopic}
        placeholder="输入你想学习的知识点"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        returnKeyType="next"
        autoFocus
      />

      <Text style={[styles.fieldLabel, { marginTop: 20 }]}>推荐主题</Text>
      <View style={styles.bubbleGrid}>
        {RECOMMENDED_TOPICS.map((t) => (
          <TouchableOpacity
            key={t.label}
            style={[styles.bubble, topic === t.label && styles.bubbleActive]}
            onPress={() => setTopic(t.label)}
            activeOpacity={0.7}
          >
            <Text style={styles.bubbleIcon}>{t.icon}</Text>
            <Text style={[styles.bubbleText, topic === t.label && styles.bubbleTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, !topic.trim() && styles.primaryBtnDisabled]}
        onPress={handleNext}
        disabled={!topic.trim()}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryBtnText}>下一步</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  // ── Step 2: Requirements + file ──

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.fieldLabel}>补充要求 <Text style={styles.optional}>(选填)</Text></Text>
      <TextInput
        value={requirements}
        onChangeText={setRequirements}
        placeholder="例如：重点讲解力学部分，配合动画演示"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.textarea]}
        multiline
        textAlignVertical="top"
      />

      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>参考资料 <Text style={styles.optional}>(选填)</Text></Text>
      {selectedFile ? (
        <View style={styles.fileCard}>
          <Ionicons name="document-attach" size={20} color={colors.mint} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.fileName} numberOfLines={1}>{selectedFile.name}</Text>
            <Text style={styles.fileMeta}>{formatFileSize(selectedFile.size)}</Text>
          </View>
          <TouchableOpacity onPress={() => setSelectedFile(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.filePickBtn} onPress={pickFile} activeOpacity={0.7}>
          <Ionicons name="attach" size={18} color={colors.mint} />
          <Text style={styles.filePickText}>上传 PDF / Word / 文本</Text>
        </TouchableOpacity>
      )}

      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.ghostBtn} onPress={handleBack} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={16} color={colors.textSecondary} />
          <Text style={styles.ghostBtnText}>返回</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={handleGenerate} activeOpacity={0.8}>
          <Ionicons name="sparkles" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>开始生成</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Step 3: Progress ──

  const renderProgress = () => (
    <View style={styles.stepContent}>
      {/* Breathing orb */}
      <View style={styles.orbContainer}>
        <Animated.View style={[styles.orbRing, {
          opacity: breatheAnim.interpolate({ inputRange: [0.2, 1], outputRange: [0.1, 0.3] }),
          transform: [{ scale: breatheAnim.interpolate({ inputRange: [0.2, 1], outputRange: [1, 1.5] }) }],
        }]} />
        <Animated.View style={[styles.orbCore, {
          opacity: breatheAnim.interpolate({ inputRange: [0.2, 1], outputRange: [0.6, 1] }),
          transform: [{ scale: breatheAnim.interpolate({ inputRange: [0.2, 1], outputRange: [0.92, 1.08] }) }],
        }]} />
        <Ionicons
          name={isCompleted ? 'checkmark-circle' : 'sparkles'}
          size={32}
          color={isCompleted ? colors.success : colors.mint}
          style={{ position: 'absolute' }}
        />
      </View>

      <Text style={styles.progressTitle}>
        {isCompleted ? '生成完成' : isFailed ? '生成失败' : '正在生成课堂'}
      </Text>
      {!isCompleted && !isFailed && (
        <Text style={styles.progressSub}>AI 正在为你构建专属课堂内容</Text>
      )}

      {/* Steps */}
      <View style={styles.progressList}>
        {PROGRESS_STEPS.map((ps, idx) => {
          const done = job.progress >= [15, 40, 70, 95][idx] || isCompleted;
          const active = !isCompleted && !isFailed && !done && (idx === 0 || job.progress >= [0, 15, 40, 70][idx]);
          return (
            <View key={ps.key} style={styles.progressRow}>
              <View style={styles.progressDot}>
                {done ? (
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                ) : active ? (
                  <ActivityIndicator size="small" color={colors.mint} />
                ) : (
                  <View style={styles.dotIdle} />
                )}
              </View>
              <Text style={[styles.progressLabel, done && styles.progressLabelDone, active && styles.progressLabelActive]}>
                {ps.label}
              </Text>
              {active && job.step ? (
                <Text style={styles.progressDetail} numberOfLines={1}>{job.step}</Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Progress bar */}
      {!isCompleted && !isFailed && (
        <View style={styles.barRow}>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(job.progress, 5)}%` }]} />
          </View>
          <Text style={styles.barPercent}>{Math.round(job.progress)}%</Text>
        </View>
      )}

      {/* Error */}
      {isFailed && job.error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <Text style={styles.errorText}>{job.error}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.btnRow}>
        {isCompleted ? (
          <>
            <TouchableOpacity style={styles.ghostBtn} onPress={handleReset} activeOpacity={0.7}>
              <Text style={styles.ghostBtnText}>再建一个</Text>
            </TouchableOpacity>
            {job.classroomId && (
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={() => onEnterClassroom(job.classroomId!)} activeOpacity={0.8}>
                <Ionicons name="open" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>进入课堂</Text>
              </TouchableOpacity>
            )}
          </>
        ) : isFailed ? (
          <>
            <TouchableOpacity style={styles.ghostBtn} onPress={handleReset} activeOpacity={0.7}>
              <Text style={styles.ghostBtnText}>重新开始</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={handleGenerate} activeOpacity={0.8}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>重试</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.ghostBtn, { flex: 1 }]} onPress={handleClose} activeOpacity={0.7}>
            <Text style={styles.ghostBtnText}>后台运行</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={handleClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{step === 3 ? '生成进度' : '创建课堂'}</Text>
            <TouchableOpacity onPress={handleClose} disabled={isProcessing} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={isProcessing ? colors.borderLight : colors.textMuted} />
            </TouchableOpacity>
          </View>
          {step !== 3 && renderStepIndicator()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderProgress()}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──

const C = colors; // shorthand

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.85,
    paddingBottom: 34,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.borderLight,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.textPrimary,
  },

  // Step indicator
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  stepItem: {
    alignItems: 'center',
    gap: 4,
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: C.mint,
  },
  stepNum: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textMuted,
  },
  stepNumActive: {
    color: '#fff',
  },
  stepLabel: {
    fontSize: 11,
    color: C.textMuted,
  },
  stepLabelActive: {
    color: C.textPrimary,
    fontWeight: '600',
  },
  stepLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.borderLight,
    marginHorizontal: 8,
    marginBottom: 18,
  },
  stepLineActive: {
    backgroundColor: C.mint,
  },

  // Form
  stepContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 8,
  },
  optional: {
    fontWeight: '400',
    color: C.textMuted,
  },
  input: {
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.textPrimary,
    backgroundColor: C.bgInput,
  },
  textarea: {
    minHeight: 88,
    maxHeight: 140,
  },

  // Bubbles
  bubbleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.bgInput,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  bubbleActive: {
    backgroundColor: C.mintLight,
    borderColor: C.mint,
  },
  bubbleIcon: {
    fontSize: 14,
  },
  bubbleText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.textSecondary,
  },
  bubbleTextActive: {
    color: C.textPrimary,
    fontWeight: '600',
  },

  // Buttons
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.mint,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 20,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 20,
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textSecondary,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // File picker
  filePickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    backgroundColor: C.bgInput,
  },
  filePickText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.textSecondary,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.bgInput,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textPrimary,
  },
  fileMeta: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },

  // Progress
  orbContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    marginBottom: 8,
  },
  orbRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.mintLight,
    position: 'absolute',
  },
  orbCore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.mintLight,
    position: 'absolute',
  },
  progressTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.textPrimary,
    textAlign: 'center',
  },
  progressSub: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  progressList: {
    gap: 12,
    marginBottom: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressDot: {
    width: 22,
    alignItems: 'center',
  },
  dotIdle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.borderLight,
  },
  progressLabel: {
    fontSize: 14,
    color: C.textMuted,
    flex: 1,
  },
  progressLabelDone: {
    color: C.textPrimary,
    fontWeight: '500',
  },
  progressLabelActive: {
    color: C.mint,
    fontWeight: '600',
  },
  progressDetail: {
    fontSize: 11,
    color: C.textMuted,
    maxWidth: 120,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  barTrack: {
    flex: 1,
    height: 5,
    backgroundColor: C.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: C.mint,
    borderRadius: 3,
  },
  barPercent: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textMuted,
    minWidth: 32,
    textAlign: 'right',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.errorLight,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: C.error,
    lineHeight: 18,
  },
});
