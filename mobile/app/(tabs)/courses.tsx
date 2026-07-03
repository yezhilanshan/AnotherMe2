import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, formatGatewayError } from '../../lib/api';
import { BEARER_TOKEN, GATEWAY_URL, TUNNEL_HEADERS, USER_ID } from '../../lib/config';
import { colors } from '../../lib/theme';
import { BackgroundImage } from '../../components/ui/BackgroundImage';
import ClassroomCard from '../../components/course/ClassroomCard';
import CourseGenerateSheet, {
  type CourseJobState,
  type SelectedFile,
  EMPTY_JOB,
} from '../../components/course/CourseGenerateSheet';

// ── Types ──

interface ClassroomSummary {
  id: string;
  title: string;
  created_at: string;
  scenes_count: number;
}

const PEACH_OVERLAY = "rgba(255, 245, 240, 0.72)";
const PURPLE = "#6B5CE7";
const PURPLE_LIGHT = "#EDE9FF";
const GLASS_BG = "rgba(255, 252, 249, 0.88)";
const GLASS_BORDER = "rgba(255, 255, 255, 0.6)";
const CARD_SHADOW = {
  shadowColor: "#5A3E36",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 4,
};

// ── Helpers ──

function formatCourseError(message: string): string {
  if (message.includes('Network connection failed') || message.includes('Request timed out')) {
    return formatGatewayError(new Error(message), '课堂请求失败');
  }
  if (
    message.includes('AnotherMe Web/Core upstream returned') ||
    message.includes('Cannot reach AnotherMe Web/Core upstream')
  ) {
    return '课堂生成服务不可达。请确认 Web/Core 服务已启动。';
  }
  return message;
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const { File } = await import('expo-file-system');
  const file = new File(uri);
  return new Uint8Array(await file.arrayBuffer());
}

function extractClassroomId(result: Record<string, unknown>): string | null {
  const direct =
    result.classroom_id ||
    result.classroomId ||
    result.id ||
    (result.classroom && typeof result.classroom === 'object'
      ? (result.classroom as Record<string, unknown>).id
      : null) ||
    (result.stage && typeof result.stage === 'object'
      ? (result.stage as Record<string, unknown>).id
      : null);
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const url =
    result.classroom_url ||
    result.classroomUrl ||
    result.url;
  if (typeof url !== 'string') return null;

  const match = url.match(/\/(?:classroom|course)\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

// ── Screen ──

export default function CoursesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [job, setJob] = useState<CourseJobState>(EMPTY_JOB);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enteredClassroomRef = useRef<string | null>(null);

  const loadClassrooms = useCallback(async () => {
    try {
      const result = await api.classroom.list(50);
      setClassrooms(result.classrooms || []);
    } catch {
      setClassrooms([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadClassrooms(); }, [loadClassrooms]);
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const onRefresh = () => { setRefreshing(true); loadClassrooms(); };

  const handleDelete = (classroom: ClassroomSummary) => {
    Alert.alert('删除课堂', `确定删除「${classroom.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.classroom.delete(classroom.id);
            setClassrooms(prev => prev.filter(c => c.id !== classroom.id));
          } catch {
            Alert.alert('错误', '删除失败');
          }
        },
      },
    ]);
  };

  // ── Upload & job logic ──

  const uploadMaterial = async (file: SelectedFile): Promise<string> => {
    setJob(prev => ({ ...prev, status: 'uploading', error: null, step: '上传资料中...' }));
    const boundary = '----FormBoundary' + Date.now().toString(36);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const bytes = await readFileBytes(file.uri);
    const headerBytes = new TextEncoder().encode(header);
    const footerBytes = new TextEncoder().encode(footer);
    const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
    body.set(headerBytes, 0);
    body.set(bytes, headerBytes.length);
    body.set(footerBytes, headerBytes.length + bytes.length);
    const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...TUNNEL_HEADERS };
    if (BEARER_TOKEN) headers.Authorization = `Bearer ${BEARER_TOKEN}`;
    const res = await fetch(`${GATEWAY_URL}/v1/uploads`, { method: 'POST', headers, body: body.buffer });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`资料上传失败 (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.object_key as string;
  };

  const createCourseJob = async (topic: string, requirements: string, sourceObjectKey?: string, file?: SelectedFile): Promise<string> => {
    setJob(prev => ({ ...prev, status: 'creating_job', step: '创建课堂生成任务...' }));
    const trimmed = requirements.trim();
    const requirement = trimmed ? `${topic.trim()}\n\n补充要求：${trimmed}` : topic.trim();
    const payload: Record<string, unknown> = {
      requirement,
      language: 'zh-CN',
      request_id: `mobile-course-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      options: { source: 'mobile', enable_tts: true },
    };
    if (sourceObjectKey && file) {
      payload.source_object_key = sourceObjectKey;
      payload.source_file_name = file.name;
      payload.source_mime_type = file.mimeType;
      payload.sources = [{ type: 'upload', object_key: sourceObjectKey, file_name: file.name, mime_type: file.mimeType }];
    }
    const created = await api.jobs.create({ job_type: 'course_generate', payload, user_id: USER_ID });
    return created.job_id;
  };

  const enterClassroom = useCallback((classroomId: string) => {
    if (!classroomId || enteredClassroomRef.current === classroomId) return;
    enteredClassroomRef.current = classroomId;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSheetVisible(false);
    requestAnimationFrame(() => {
      router.push({ pathname: '/course/[id]', params: { id: classroomId } });
    });
  }, [router]);

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const pollOnce = async () => {
      try {
        const data = await api.jobs.get(jobId);
        const status = data.status as string;
        const progress = data.progress || 0;
        const step = data.step || '';
        const result = data.result || {};
        const classroomId = extractClassroomId(result);
        if (classroomId) {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob(prev => ({
            ...prev,
            status: 'completed',
            progress: Math.max(progress, 70),
            step: '课堂已可进入，剩余内容后台生成中',
            classroomId,
          }));
          enterClassroom(classroomId);
          void loadClassrooms();
        } else if (status === 'failed' || status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob(prev => ({ ...prev, status: 'failed', error: formatCourseError(data.error_message || '课堂生成失败') }));
        } else {
          setJob(prev => ({ ...prev, status: status === 'queued' ? 'queued' : 'running', progress, step, classroomId: classroomId || prev.classroomId }));
        }
      } catch { /* 网络瞬断时继续轮询 */ }
    };
    void pollOnce();
    pollRef.current = setInterval(pollOnce, 3000);
  }, [enterClassroom, loadClassrooms]);

  const handleGenerate = async (topic: string, requirements: string, file?: SelectedFile) => {
    try {
      enteredClassroomRef.current = null;
      const objectKey = file ? await uploadMaterial(file) : undefined;
      const jobId = await createCourseJob(topic, requirements, objectKey, file);
      setJob(prev => ({ ...prev, jobId, status: 'queued', progress: 0, step: '任务已排队' }));
      pollJob(jobId);
    } catch (err) {
      setJob(prev => ({ ...prev, status: 'failed', error: formatGatewayError(err, '创建课堂失败') }));
    }
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    enteredClassroomRef.current = null;
    setJob(EMPTY_JOB);
  };

  const handleEnterClassroom = (classroomId: string) => {
    enterClassroom(classroomId);
  };

  // ── Render ──

  const renderClassroom = ({ item, index }: { item: ClassroomSummary; index: number }) => (
    <ClassroomCard
      title={item.title}
      scenesCount={item.scenes_count}
      createdAt={item.created_at}
      index={index}
      onPress={() => router.push({ pathname: '/course/[id]', params: { id: item.id } })}
      onLongPress={() => handleDelete(item)}
    />
  );

  return (
    <View style={styles.container}>
      <BackgroundImage
        source={require('../../assets/backgrounds/courses_bg.png')}
        overlayColor={PEACH_OVERLAY}
      />
      {/* Page title */}
      <View style={[styles.titleArea, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.pageTitle}>课堂</Text>
        <Text style={styles.pageSub}>{classrooms.length > 0 ? `${classrooms.length} 个课堂` : '创建你的第一个课堂'}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.mint} />
        </View>
      ) : (
        <FlatList
          data={classrooms}
          renderItem={renderClassroom}
          keyExtractor={item => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.createCard}
              onPress={() => setSheetVisible(true)}
              activeOpacity={0.7}
            >
              <View style={styles.createIconWrap}>
                <Ionicons name="add" size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createTitle}>生成新课堂</Text>
                <Text style={styles.createSub}>输入主题，AI 自动生成</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.borderLight} />
            </TouchableOpacity>
          }
          ListHeaderComponentStyle={{ marginBottom: classrooms.length > 0 ? 10 : 0 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mint} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Image
                source={require('../../assets/illustrations/home_hero.png')}
                style={styles.emptyImage}
                resizeMode="contain"
              />
              <View style={styles.emptyIcon}>
                <Ionicons name="library-outline" size={36} color={colors.borderLight} />
              </View>
              <Text style={styles.emptyTitle}>还没有课堂</Text>
              <Text style={styles.emptyHint}>点击上方按钮，让 AI 为你生成</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
        />
      )}

      <CourseGenerateSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        job={job}
        onGenerate={handleGenerate}
        onEnterClassroom={handleEnterClassroom}
        onReset={handleReset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Title
  titleArea: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  pageSub: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },

  // Create card
  createCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: GLASS_BG,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1.5,
    borderColor: PURPLE,
    borderStyle: 'dashed',
    ...CARD_SHADOW,
  },
  createIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  createSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Empty
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PURPLE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  emptyImage: {
    width: 180,
    height: 180,
    marginBottom: 8,
  },
});
