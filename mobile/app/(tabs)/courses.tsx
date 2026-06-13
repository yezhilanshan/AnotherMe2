import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, formatGatewayError } from '../../lib/api';
import { BEARER_TOKEN, GATEWAY_URL, TUNNEL_HEADERS, USER_ID } from '../../lib/config';

interface ClassroomSummary {
  id: string;
  title: string;
  created_at: string;
  scenes_count: number;
}

type CourseJobStatus = 'idle' | 'uploading' | 'creating_job' | 'queued' | 'running' | 'completed' | 'failed';

interface SelectedCourseFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

interface CourseJobState {
  status: CourseJobStatus;
  jobId: string | null;
  progress: number;
  step: string;
  classroomId: string | null;
  error: string | null;
}

const EMPTY_JOB: CourseJobState = {
  status: 'idle',
  jobId: null,
  progress: 0,
  step: '',
  classroomId: null,
  error: null,
};

const PROCESSING_STATUSES: CourseJobStatus[] = ['uploading', 'creating_job', 'queued', 'running'];

function formatFileSize(size?: number) {
  if (!size || size <= 0) return '';
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function guessMimeType(name: string, mimeType?: string | null) {
  if (mimeType) return mimeType;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

function formatCourseError(message: string): string {
  if (message.includes('Network connection failed') || message.includes('Request timed out')) {
    return formatGatewayError(new Error(message), '课堂请求失败');
  }
  if (
    message.includes('AnotherMe Web/Core upstream returned') ||
    message.includes('Cannot reach AnotherMe Web/Core upstream')
  ) {
    return '课堂生成服务不可达。请确认 Web/Core 服务已启动，并且 Gateway 的 ANOTHERME_BASE_URL 指向手机或 Gateway 所在环境可访问的 Web 地址。';
  }
  return message;
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  return new Uint8Array(await file.arrayBuffer());
}

export default function CoursesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topic, setTopic] = useState('');
  const [requirements, setRequirements] = useState('');
  const [selectedFile, setSelectedFile] = useState<SelectedCourseFile | null>(null);
  const [job, setJob] = useState<CourseJobState>(EMPTY_JOB);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadClassrooms = useCallback(async () => {
    try {
      const result = await api.classroom.list(50);
      setClassrooms(result.classrooms || []);
    } catch (err) {
      // Gateway might not have classroom data yet
      setClassrooms([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadClassrooms();
  };

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

  const pickMaterial = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setSelectedFile({
      uri: asset.uri,
      name: asset.name || 'material',
      mimeType: guessMimeType(asset.name || '', asset.mimeType),
      size: asset.size,
    });
    setJob(EMPTY_JOB);
  };

  const removeMaterial = () => {
    setSelectedFile(null);
    setJob(EMPTY_JOB);
  };

  const uploadMaterial = async (file: SelectedCourseFile): Promise<string> => {
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

    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      ...TUNNEL_HEADERS,
    };
    if (BEARER_TOKEN) headers.Authorization = `Bearer ${BEARER_TOKEN}`;

    const res = await fetch(`${GATEWAY_URL}/v1/uploads`, {
      method: 'POST',
      headers,
      body: body.buffer,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`资料上传失败 (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.object_key as string;
  };

  const createCourseJob = async (sourceObjectKey?: string): Promise<string> => {
    setJob(prev => ({ ...prev, status: 'creating_job', step: '创建课堂生成任务...' }));

    const trimmedRequirements = requirements.trim();
    const requirement = trimmedRequirements
      ? `${topic.trim()}\n\n补充要求：${trimmedRequirements}`
      : topic.trim();

    const payload: Record<string, unknown> = {
      requirement,
      language: 'zh-CN',
      options: {
        source: 'mobile',
      },
    };

    if (sourceObjectKey && selectedFile) {
      payload.source_object_key = sourceObjectKey;
      payload.source_file_name = selectedFile.name;
      payload.source_mime_type = selectedFile.mimeType;
      payload.sources = [{
        type: 'upload',
        object_key: sourceObjectKey,
        file_name: selectedFile.name,
        mime_type: selectedFile.mimeType,
      }];
    }

    const created = await api.jobs.create({
      job_type: 'course_generate',
      payload,
      user_id: USER_ID,
    });
    return created.job_id;
  };

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const data = await api.jobs.get(jobId);
        const status = data.status as string;
        const progress = data.progress || 0;
        const step = data.step || '';
        const result = data.result || {};
        const classroomId =
          (result.classroom_id as string | undefined) ||
          (result.classroomId as string | undefined) ||
          (result.id as string | undefined) ||
          null;

        if (status === 'completed' || status === 'succeeded') {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob(prev => ({
            ...prev,
            status: 'completed',
            progress: 100,
            step: '课堂生成完成',
            classroomId,
          }));
          await loadClassrooms();
        } else if (status === 'failed' || status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob(prev => ({
            ...prev,
            status: 'failed',
            error: formatCourseError(data.error_message || '课堂生成失败'),
          }));
        } else {
          setJob(prev => ({
            ...prev,
            status: status === 'queued' ? 'queued' : 'running',
            progress,
            step,
            classroomId: classroomId || prev.classroomId,
          }));
        }
      } catch {
        // 网络瞬断时继续轮询。
      }
    }, 3000);
  }, [loadClassrooms]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setJob(prev => ({ ...prev, status: 'failed', error: '请先填写课堂主题' }));
      return;
    }

    try {
      const objectKey = selectedFile ? await uploadMaterial(selectedFile) : undefined;
      const jobId = await createCourseJob(objectKey);
      setJob(prev => ({ ...prev, jobId, status: 'queued', progress: 0, step: '任务已排队' }));
      pollJob(jobId);
    } catch (err) {
      setJob(prev => ({
        ...prev,
        status: 'failed',
        error: formatGatewayError(err, '创建课堂失败'),
      }));
    }
  };

  const resetGenerateForm = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setTopic('');
    setRequirements('');
    setSelectedFile(null);
    setJob(EMPTY_JOB);
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const getSceneIcon = (count: number) => {
    if (count >= 10) return 'book';
    if (count >= 5) return 'document-text';
    return 'document';
  };

  const renderClassroom = ({ item }: { item: ClassroomSummary }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/course/[id]', params: { id: item.id } })}
      onLongPress={() => handleDelete(item)}
    >
      <View style={styles.cardIcon}>
        <Ionicons name={getSceneIcon(item.scenes_count)} size={24} color="#007AFF" />
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardMeta}>
          {item.scenes_count} 个场景 · {formatDate(item.created_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#CCC" />
    </TouchableOpacity>
  );

  const isProcessing = PROCESSING_STATUSES.includes(job.status);
  const statusLabel: Record<CourseJobStatus, string> = {
    idle: '',
    uploading: '上传资料中...',
    creating_job: '创建任务中...',
    queued: '排队中...',
    running: 'AI 正在生成课堂...',
    completed: '课堂生成完成',
    failed: '生成失败',
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的课堂</Text>
        <Text style={styles.headerSub}>{classrooms.length} 个课堂</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>加载课堂...</Text>
        </View>
      ) : (
        <FlatList
          data={classrooms}
          renderItem={renderClassroom}
          keyExtractor={item => item.id}
          ListHeaderComponent={
            <View style={styles.createPanel}>
              <View style={styles.createTitleRow}>
                <Ionicons name="sparkles" size={18} color="#007AFF" />
                <Text style={styles.createTitle}>生成课堂</Text>
              </View>
              <TextInput
                value={topic}
                onChangeText={setTopic}
                placeholder="课堂主题，例如：牛顿第二定律"
                style={styles.topicInput}
                editable={!isProcessing}
                returnKeyType="done"
              />
              <TextInput
                value={requirements}
                onChangeText={setRequirements}
                placeholder="补充要求，可选"
                multiline
                style={styles.requirementsInput}
                textAlignVertical="top"
                editable={!isProcessing}
              />

              {selectedFile ? (
                <View style={styles.fileCard}>
                  <View style={styles.fileIcon}>
                    <Ionicons name="document-text" size={20} color="#007AFF" />
                  </View>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>{selectedFile.name}</Text>
                    <Text style={styles.fileMeta}>
                      {selectedFile.mimeType}{formatFileSize(selectedFile.size) ? ` · ${formatFileSize(selectedFile.size)}` : ''}
                    </Text>
                  </View>
                  {!isProcessing && (
                    <TouchableOpacity onPress={removeMaterial} style={styles.fileRemove}>
                      <Ionicons name="close-circle" size={20} color="#999" />
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <TouchableOpacity style={styles.pickFileButton} onPress={pickMaterial} disabled={isProcessing}>
                  <Ionicons name="cloud-upload-outline" size={20} color="#007AFF" />
                  <Text style={styles.pickFileText}>选择资料（可选）</Text>
                </TouchableOpacity>
              )}

              {job.error && (
                <View style={styles.inlineError}>
                  <Ionicons name="warning" size={16} color="#FF3B30" />
                  <Text style={styles.inlineErrorText}>{job.error}</Text>
                </View>
              )}

              {isProcessing && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${Math.max(job.progress, 10)}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{statusLabel[job.status]}</Text>
                  {job.step ? <Text style={styles.progressStep}>{job.step}</Text> : null}
                  {job.classroomId ? (
                    <TouchableOpacity
                      style={styles.earlyEnterButton}
                      onPress={() => router.push({ pathname: '/course/[id]', params: { id: job.classroomId! } })}
                    >
                      <Ionicons name="play-circle" size={18} color="#007AFF" />
                      <Text style={styles.earlyEnterText}>已生成可播放内容，先进入课堂</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

              {job.status === 'completed' ? (
                <View style={styles.completedActions}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={resetGenerateForm}>
                    <Text style={styles.secondaryButtonText}>再建一个</Text>
                  </TouchableOpacity>
                  {job.classroomId && (
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => router.push({ pathname: '/course/[id]', params: { id: job.classroomId! } })}
                    >
                      <Ionicons name="open" size={18} color="#FFF" />
                      <Text style={styles.primaryButtonText}>进入课堂</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.generateButton, isProcessing && styles.generateButtonDisabled]}
                  onPress={handleGenerate}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Ionicons name="school" size={20} color="#FFF" />
                  )}
                  <Text style={styles.generateButtonText}>{isProcessing ? '生成中...' : '生成课堂'}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#007AFF" />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="library-outline" size={48} color="#CCC" />
              <Text style={styles.emptyText}>暂无课堂</Text>
              <Text style={styles.emptyHint}>输入主题即可创建第一个课堂</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 20, paddingTop: 12 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 15, color: '#999' },
  header: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  createPanel: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  createTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  createTitle: { fontSize: 15, fontWeight: '600', color: '#333' },
  topicInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  requirementsInput: {
    minHeight: 70,
    maxHeight: 120,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  pickFileButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#D6E8FF',
    backgroundColor: '#F0F8FF',
    paddingVertical: 12,
    borderRadius: 10,
  },
  pickFileText: { color: '#007AFF', fontSize: 14, fontWeight: '500' },
  fileCard: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#F8F8F8',
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: '#EAF4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '500', color: '#333' },
  fileMeta: { fontSize: 11, color: '#999', marginTop: 2 },
  fileRemove: { padding: 4 },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FFE5E5',
  },
  inlineErrorText: { flex: 1, fontSize: 13, color: '#FF3B30' },
  progressContainer: { marginTop: 12 },
  progressBar: {
    height: 6,
    backgroundColor: '#E5E5E5',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#007AFF', borderRadius: 3 },
  progressText: { fontSize: 13, color: '#333', fontWeight: '500', marginTop: 8 },
  progressStep: { fontSize: 12, color: '#999', marginTop: 3 },
  earlyEnterButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#D6E8FF',
    backgroundColor: '#F0F8FF',
    paddingVertical: 10,
    borderRadius: 10,
  },
  earlyEnterText: { color: '#007AFF', fontSize: 13, fontWeight: '600' },
  generateButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 10,
  },
  generateButtonDisabled: { opacity: 0.65 },
  generateButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  completedActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryButtonText: { color: '#333', fontSize: 14, fontWeight: '500' },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '500', color: '#333' },
  cardMeta: { fontSize: 12, color: '#999', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginTop: 12 },
  emptyHint: { fontSize: 13, color: '#BBB', marginTop: 4 },
});
