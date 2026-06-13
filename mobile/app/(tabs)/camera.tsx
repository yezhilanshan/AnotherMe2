import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Linking,
  Alert,
  TextInput,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { GATEWAY_URL, BEARER_TOKEN, TUNNEL_HEADERS } from "../../lib/config";
import { getSafeStorage } from "../../lib/safeStorage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_GAP = 10;
const GRID_CARD_WIDTH = (SCREEN_WIDTH - 32 - CARD_GAP) / 2;

// ─── 品牌色 ───
const BRAND_BLUE = "#4A6FA5";
const BRAND_BLUE_LIGHT = "#6d89ba";
const BRAND_BLUE_LIGHTER = "#eef4ff";
const ACTION_RED = "#E0573D";
const SUCCESS_GREEN = "#34C759";

type JobStatus =
  | "idle"
  | "uploading"
  | "creating_job"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "needs_confirmation";

interface JobState {
  status: JobStatus;
  jobId: string | null;
  progress: number;
  step: string;
  videoUrl: string | null;
  error: string | null;
  softenedPrompt: string | null;
}

interface PersistedProblemVideoState {
  imageUri: string | null;
  description: string;
  job: JobState;
}

interface ProblemVideoHistoryItem extends PersistedProblemVideoState {
  id: string;
  createdAt: number;
  updatedAt: number;
}

// ─── 管道阶段 ───
interface PipelineStage {
  key: string;
  label: string;
  description: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  { key: "uploading_image", label: "上传图片", description: "将题目图片传输到视频生成网关" },
  { key: "creating_job", label: "识别题目", description: "分析题目内容并生成讲解计划" },
  { key: "queueing", label: "排队等待", description: "等待工作进程开始执行任务" },
  { key: "running_anotherme2", label: "生成语音", description: "生成讲解语音和镜头脚本" },
  { key: "uploading_artifacts", label: "渲染视频", description: "渲染并上传最终讲解视频" },
  { key: "completed", label: "生成完成", description: "视频已可播放" },
];

const BACKEND_STEP_TO_STAGE: Record<string, string> = {
  queued: "queueing",
  running_anotherme2: "running_anotherme2",
  uploading_artifacts: "uploading_artifacts",
  completed: "completed",
  failed: "completed",
};

const STORAGE_KEY = "@anotherme/problem-video/current";
const HISTORY_KEY = "@anotherme/problem-video/history";
const MAX_HISTORY_ITEMS = 20;
const PROCESSING_STATUSES: JobStatus[] = [
  "uploading",
  "creating_job",
  "queued",
  "running",
];
const EMPTY_JOB: JobState = {
  status: "idle",
  jobId: null,
  progress: 0,
  step: "",
  videoUrl: null,
  error: null,
  softenedPrompt: null,
};

// ─── 阶段状态类型 ───
type StageStatus = "pending" | "running" | "completed" | "failed";

function resolveUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${GATEWAY_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatHistoryTime(value: number): string {
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

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  return new Uint8Array(await file.arrayBuffer());
}

// ─── 管道阶段状态计算 ───
function computeStageStatuses(job: JobState): Record<string, StageStatus> {
  const result: Record<string, StageStatus> = {};
  PIPELINE_STAGES.forEach((s) => (result[s.key] = "pending"));

  if (job.status === "idle" || job.status === "needs_confirmation") return result;
  if (job.status === "failed") {
    const failKey = BACKEND_STEP_TO_STAGE[job.step] || "completed";
    PIPELINE_STAGES.forEach((s) => {
      const idx = PIPELINE_STAGES.findIndex((p) => p.key === s.key);
      const failIdx = PIPELINE_STAGES.findIndex((p) => p.key === failKey);
      if (idx < failIdx) result[s.key] = "completed";
      else if (idx === failIdx) result[s.key] = "failed";
    });
    return result;
  }
  if (job.status === "completed") {
    PIPELINE_STAGES.forEach((s) => (result[s.key] = "completed"));
    return result;
  }

  // running states
  const activeKey = BACKEND_STEP_TO_STAGE[job.step] || "queueing";
  const activeIdx = PIPELINE_STAGES.findIndex((p) => p.key === activeKey);
  PIPELINE_STAGES.forEach((s, idx) => {
    if (idx < activeIdx) result[s.key] = "completed";
    else if (idx === activeIdx) result[s.key] = "running";
  });
  return result;
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [job, setJob] = useState<JobState>(EMPTY_JOB);
  const [history, setHistory] = useState<ProblemVideoHistoryItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pickImage = async (useCamera: boolean) => {
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setJob((prev) => ({
        ...prev,
        error: useCamera ? "需要相机权限" : "需要相册权限",
        status: "failed",
      }));
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setJob(EMPTY_JOB);
    }
  };

  const uploadImage = async (uri: string): Promise<string> => {
    setJob((prev) => ({ ...prev, status: "uploading", error: null }));
    const boundary = "----FormBoundary" + Date.now().toString(36);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const bytes = await readFileBytes(uri);
    const headerBytes = new TextEncoder().encode(header);
    const footerBytes = new TextEncoder().encode(footer);
    const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
    body.set(headerBytes, 0);
    body.set(bytes, headerBytes.length);
    body.set(footerBytes, headerBytes.length + bytes.length);

    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    };
    if (BEARER_TOKEN) headers["Authorization"] = `Bearer ${BEARER_TOKEN}`;
    Object.assign(headers, TUNNEL_HEADERS);

    const res = await fetch(`${GATEWAY_URL}/v1/uploads`, {
      method: "POST",
      headers,
      body: body.buffer,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`上传失败 (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.object_key as string;
  };

  const createJob = async (objectKey: string): Promise<string> => {
    setJob((prev) => ({ ...prev, status: "creating_job" }));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...TUNNEL_HEADERS,
    };
    if (BEARER_TOKEN) headers["Authorization"] = `Bearer ${BEARER_TOKEN}`;

    const res = await fetch(`${GATEWAY_URL}/v1/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        job_type: "problem_video_generate",
        payload: {
          image_object_key: objectKey,
          ...(description.trim() ? { problem_text: description.trim() } : {}),
        },
        user_id: "mobile-user",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`创建任务失败 (${res.status}): ${text}`);
    }
    const data = await res.json();
    return data.job_id as string;
  };

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const headers: Record<string, string> = { ...TUNNEL_HEADERS };
    if (BEARER_TOKEN) headers["Authorization"] = `Bearer ${BEARER_TOKEN}`;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/v1/jobs/${jobId}`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        const status = data.status as string;
        const progress = (data.progress as number) || 0;
        const step = (data.step as string) || "";

        if (status === "completed" || status === "succeeded") {
          if (pollRef.current) clearInterval(pollRef.current);
          const result = data.result as Record<string, unknown> | undefined;
          const videoUrl =
            (result?.videoUrl as string) ||
            (result?.video_url as string) ||
            (result?.outputUrl as string) ||
            null;
          setJob((prev) => ({ ...prev, status: "completed", progress: 100, step: "completed", videoUrl }));
        } else if (status === "failed" || status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob((prev) => ({ ...prev, status: "failed", error: (data.error_message as string) || "任务失败" }));
        } else if (
          status === "needs_confirmation" ||
          (data.error_code as string) === "CONTENT_SENSITIVE"
        ) {
          if (pollRef.current) clearInterval(pollRef.current);
          const softenedPrompt =
            (data.softened_prompt as string) || (data.result?.softened_prompt as string) || "";
          setJob((prev) => ({
            ...prev,
            status: "needs_confirmation",
            error: (data.error_message as string) || "内容触发了安全检查",
            softenedPrompt: softenedPrompt || `（安全柔化版）${description}`,
          }));
        } else {
          setJob((prev) => ({
            ...prev,
            status: status === "queued" ? "queued" : "running",
            progress,
            step,
          }));
        }
      } catch {}
    }, 3000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPersistedState = async () => {
      const AS = getSafeStorage();
      try {
        const [raw, rawHistory] = await Promise.all([AS.getItem(STORAGE_KEY), AS.getItem(HISTORY_KEY)]);
        if (rawHistory && !cancelled) {
          const parsedHistory = JSON.parse(rawHistory) as ProblemVideoHistoryItem[];
          setHistory(Array.isArray(parsedHistory) ? parsedHistory.slice(0, MAX_HISTORY_ITEMS) : []);
        }
        if (!raw || cancelled) { setHydrated(true); return; }
        const saved = JSON.parse(raw) as PersistedProblemVideoState;
        setImageUri(saved.imageUri || null);
        setDescription(saved.description || "");
        const restoredJob = saved.job || EMPTY_JOB;
        setJob(
          restoredJob.status === "uploading" || restoredJob.status === "creating_job"
            ? { ...restoredJob, status: "failed", error: "上次任务在创建前中断，请重新提交" }
            : restoredJob,
        );
        setHydrated(true);
        if (
          saved.job?.jobId &&
          PROCESSING_STATUSES.includes(saved.job.status) &&
          saved.job.status !== "uploading" &&
          saved.job.status !== "creating_job"
        ) {
          pollJob(saved.job.jobId);
        }
      } catch {
        setHydrated(true);
      }
    };
    loadPersistedState();
    return () => { cancelled = true; };
  }, [pollJob]);

  useEffect(() => {
    if (!hydrated) return;
    const AS = getSafeStorage();
    const persist = async () => {
      if (!imageUri && job.status === "idle") {
        await AS.removeItem(STORAGE_KEY);
        return;
      }
      await AS.setItem(STORAGE_KEY, JSON.stringify({ imageUri, description, job }));
    };
    persist().catch(() => {});
  }, [hydrated, imageUri, description, job]);

  useEffect(() => {
    if (!hydrated || !job.jobId) return;
    const now = Date.now();
    setHistory((prev) => {
      const existing = prev.find((item) => item.job.jobId === job.jobId);
      const item: ProblemVideoHistoryItem = {
        id: existing?.id || job.jobId || `history-${now}`,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        imageUri,
        description,
        job,
      };
      return [item, ...prev.filter((i) => i.id !== item.id && i.job.jobId !== job.jobId)].slice(0, MAX_HISTORY_ITEMS);
    });
  }, [hydrated, imageUri, description, job]);

  useEffect(() => {
    if (!hydrated) return;
    const AS = getSafeStorage();
    AS.setItem(HISTORY_KEY, JSON.stringify(history)).catch(() => {});
  }, [hydrated, history]);

  const handleSubmit = async () => {
    if (!imageUri) {
      setJob((prev) => ({ ...prev, error: "请先拍照或选择图片", status: "failed" }));
      return;
    }
    try {
      const objectKey = await uploadImage(imageUri!);
      const jobId = await createJob(objectKey);
      setJob((prev) => ({ ...prev, jobId, status: "queued" }));
      pollJob(jobId);
    } catch (err) {
      setJob((prev) => ({ ...prev, status: "failed", error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleConfirmSoftening = async () => {
    if (!imageUri) return;
    const softenedDesc = job.softenedPrompt || description;
    setJob((prev) => ({ ...prev, status: "idle", error: null, softenedPrompt: null }));
    setDescription(softenedDesc);
    try {
      const objectKey = await uploadImage(imageUri!);
      const jobId = await createJob(objectKey);
      setJob((prev) => ({ ...prev, jobId, status: "queued" }));
      pollJob(jobId);
    } catch (err) {
      setJob((prev) => ({ ...prev, status: "failed", error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleRejectSoftening = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setJob((prev) => ({ ...prev, status: "failed", error: "用户取消了内容柔化", softenedPrompt: null }));
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setImageUri(null);
    setDescription("");
    setJob(EMPTY_JOB);
    getSafeStorage().removeItem(STORAGE_KEY).catch(() => {});
  };

  const resumeHistoryItem = (item: ProblemVideoHistoryItem) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setImageUri(item.imageUri);
    setDescription(item.description);
    setJob(item.job);
    if (item.job.jobId && PROCESSING_STATUSES.includes(item.job.status)) {
      pollJob(item.job.jobId);
    }
  };

  const deleteHistoryItem = (itemId: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== itemId));
  };

  const clearHistory = () => {
    Alert.alert("清空历史", "确定清空最近拍题任务记录？", [
      { text: "取消", style: "cancel" },
      { text: "清空", style: "destructive", onPress: () => setHistory([]) },
    ]);
  };

  const openVideo = (url: string) => {
    Linking.openURL(resolveUrl(url)).catch(() => {
      setJob((prev) => ({ ...prev, error: "无法打开视频链接" }));
    });
  };

  const isProcessing = PROCESSING_STATUSES.includes(job.status);
  const stageStatuses = computeStageStatuses(job);

  const statusLabel: Record<string, string> = {
    uploading: "上传图片中...",
    creating_job: "识别题目中...",
    queued: "排队等待中...",
    running: "AI 正在生成讲解视频...",
  };

  const historyStatusLabel: Record<JobStatus, { text: string; color: string }> = {
    idle: { text: "未开始", color: "#999" },
    uploading: { text: "上传中", color: BRAND_BLUE },
    creating_job: { text: "创建中", color: BRAND_BLUE },
    queued: { text: "排队中", color: "#FF9500" },
    running: { text: "生成中", color: "#FF9500" },
    completed: { text: "已完成", color: SUCCESS_GREEN },
    failed: { text: "失败", color: "#FF3B30" },
    needs_confirmation: { text: "需确认", color: "#FF9500" },
  };

  // ─── 分离已完成和进行中的历史 ───
  const completedHistory = history.filter((h) => h.job.status === "completed" && h.job.videoUrl);
  const otherHistory = history.filter((h) => !(h.job.status === "completed" && h.job.videoUrl));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>拍题答疑</Text>
        <Text style={styles.headerSub}>拍照或选择图片，AI 生成讲解视频</Text>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Error */}
        {job.error && job.status !== "needs_confirmation" && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color="#FF3B30" />
            <Text style={styles.errorText}>{job.error}</Text>
            <TouchableOpacity onPress={() => setJob((prev) => ({ ...prev, error: null }))}>
              <Ionicons name="close" size={18} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        )}

        {/* Content Safety Confirmation */}
        {job.status === "needs_confirmation" && (
          <View style={styles.confirmBanner}>
            <View style={styles.confirmIconRow}>
              <Ionicons name="shield-checkmark" size={22} color="#FF9500" />
              <Text style={styles.confirmTitle}>内容安全检查</Text>
            </View>
            <Text style={styles.confirmText}>
              该内容触发了安全检查。将使用自动柔化后的提示词重试生成。
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmAcceptButton} onPress={handleConfirmSoftening}>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.confirmAcceptText}>使用安全提示词</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmRejectButton} onPress={handleRejectSoftening}>
                <Text style={styles.confirmRejectText}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Image picker — 未选择图片时 */}
        {!imageUri ? (
          <View style={styles.pickSection}>
            <TouchableOpacity
              style={styles.cameraCard}
              onPress={() => pickImage(true)}
              activeOpacity={0.85}
            >
              <View style={styles.cameraCardBg}>
                <View style={styles.cameraIconCircle}>
                  <Ionicons name="camera" size={32} color="#FFF" />
                </View>
                <Text style={styles.cameraCardTitle}>拍照</Text>
                <Text style={styles.cameraCardSub}>调用摄像头拍摄题目</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.albumCard}
              onPress={() => pickImage(false)}
              activeOpacity={0.85}
            >
              <View style={styles.albumIconCircle}>
                <Ionicons name="images" size={28} color={BRAND_BLUE} />
              </View>
              <Text style={styles.albumCardTitle}>从相册选择</Text>
              <Text style={styles.albumCardSub}>选择已有的题目图片</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.previewSection}>
            {/* 图片预览 */}
            <View style={styles.previewImageWrap}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
              {!isProcessing && job.status !== "completed" && (
                <TouchableOpacity style={styles.previewCloseBtn} onPress={handleReset}>
                  <Ionicons name="close-circle" size={26} color="rgba(0,0,0,0.5)" />
                </TouchableOpacity>
              )}
            </View>

            {/* 补充说明 */}
            {!isProcessing && job.status !== "completed" && (
              <View style={styles.descriptionBox}>
                <Text style={styles.descriptionLabel}>题目补充说明（选填）</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="输入题目文字、已知条件或希望讲解的重点"
                  placeholderTextColor="#BBB"
                  multiline
                  style={styles.descriptionInput}
                  textAlignVertical="top"
                />
              </View>
            )}

            {/* 管道进度 */}
            {isProcessing && (
              <View style={styles.progressCard}>
                <View style={styles.progressHeaderRow}>
                  <Text style={styles.progressHeaderTitle}>生成进度</Text>
                  <Text style={styles.progressHeaderPercent}>{Math.round(job.progress)}%</Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[styles.progressFill, { width: `${Math.max(job.progress, 8)}%` }]}
                  />
                </View>
                <View style={styles.progressHintRow}>
                  <ActivityIndicator size="small" color={BRAND_BLUE} />
                  <Text style={styles.progressHintText}>
                    {statusLabel[job.status] || "处理中..."}
                  </Text>
                </View>
                <View style={styles.stagesList}>
                  {PIPELINE_STAGES.map((stage) => {
                    const st = stageStatuses[stage.key] || "pending";
                    return (
                      <View key={stage.key} style={styles.stageRow}>
                        <View style={styles.stageIcon}>
                          {st === "completed" && <Ionicons name="checkmark-circle" size={18} color={SUCCESS_GREEN} />}
                          {st === "running" && <ActivityIndicator size="small" color={BRAND_BLUE} />}
                          {st === "failed" && <Ionicons name="close-circle" size={18} color="#FF3B30" />}
                          {st === "pending" && <Ionicons name="ellipse-outline" size={18} color="#CCC" />}
                        </View>
                        <View style={styles.stageInfo}>
                          <Text
                            style={[
                              styles.stageLabel,
                              st === "running" && { color: BRAND_BLUE, fontWeight: "600" },
                              st === "failed" && { color: "#FF3B30", fontWeight: "600" },
                            ]}
                          >
                            {stage.label}
                          </Text>
                          <Text style={styles.stageDesc}>{stage.description}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* 完成状态 */}
            {job.status === "completed" && (
              <View style={styles.completedCard}>
                {job.videoUrl ? (
                  <TouchableOpacity
                    style={styles.videoPreviewCard}
                    onPress={() => openVideo(job.videoUrl!)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.videoPreviewBg}>
                      <View style={styles.videoPlayCircle}>
                        <Ionicons name="play" size={32} color="#FFF" />
                      </View>
                    </View>
                    <View style={styles.videoPreviewInfo}>
                      <View style={styles.videoPreviewTitleRow}>
                        <Ionicons name="checkmark-circle" size={18} color={SUCCESS_GREEN} />
                        <Text style={styles.videoPreviewTitle}>视频生成完成</Text>
                      </View>
                      <Text style={styles.videoPreviewSub}>点击播放讲解视频</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.completedNoVideo}>
                    <Ionicons name="checkmark-circle" size={48} color={SUCCESS_GREEN} />
                    <Text style={styles.completedText}>视频生成完成！</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
                  <Ionicons name="camera" size={18} color={BRAND_BLUE} />
                  <Text style={styles.resetText}>再拍一题</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 提交按钮 */}
            {!isProcessing && job.status !== "completed" && (
              <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.85}>
                <Ionicons name="videocam" size={20} color="#FFF" />
                <Text style={styles.submitText}>生成讲解视频</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ─── 已完成视频网格 ─── */}
        {completedHistory.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>讲解视频</Text>
              <Text style={styles.sectionCount}>{completedHistory.length} 个</Text>
            </View>
            <View style={styles.videoGrid}>
              {completedHistory.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.videoGridCard}
                  onPress={() => openVideo(item.job.videoUrl!)}
                  activeOpacity={0.85}
                >
                  <View style={styles.videoGridThumb}>
                    {item.imageUri ? (
                      <Image source={{ uri: item.imageUri }} style={styles.videoGridThumbImg} resizeMode="cover" />
                    ) : (
                      <View style={styles.videoGridThumbFallback}>
                        <Ionicons name="document-text" size={24} color="rgba(255,255,255,0.6)" />
                      </View>
                    )}
                    <View style={styles.videoGridOverlay}>
                      <Ionicons name="play-circle" size={36} color="rgba(255,255,255,0.9)" />
                    </View>
                  </View>
                  <View style={styles.videoGridInfo}>
                    <Text style={styles.videoGridTitle} numberOfLines={2}>
                      {item.description.trim() || "拍题讲解"}
                    </Text>
                    <Text style={styles.videoGridMeta}>
                      {formatHistoryTime(item.updatedAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ─── 其他历史任务 ─── */}
        {otherHistory.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>最近任务</Text>
              <TouchableOpacity onPress={clearHistory}>
                <Text style={styles.sectionClear}>清空</Text>
              </TouchableOpacity>
            </View>
            {otherHistory.map((item) => {
              const active = item.job.jobId && item.job.jobId === job.jobId;
              const statusInfo = historyStatusLabel[item.job.status];
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.taskCard, active && styles.taskCardActive]}
                  onPress={() => resumeHistoryItem(item)}
                  onLongPress={() => deleteHistoryItem(item.id)}
                  activeOpacity={0.7}
                >
                  {item.imageUri ? (
                    <Image source={{ uri: item.imageUri }} style={styles.taskImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.taskImageFallback}>
                      <Ionicons name="image-outline" size={20} color="#999" />
                    </View>
                  )}
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskName} numberOfLines={1}>
                      {item.description.trim() || item.job.step || "拍题视频任务"}
                    </Text>
                    <View style={styles.taskMetaRow}>
                      <View style={[styles.taskStatusBadge, { backgroundColor: statusInfo.color + "18" }]}>
                        <View style={[styles.taskStatusDot, { backgroundColor: statusInfo.color }]} />
                        <Text style={[styles.taskStatusText, { color: statusInfo.color }]}>
                          {statusInfo.text}
                        </Text>
                      </View>
                      <Text style={styles.taskTime}>{formatHistoryTime(item.updatedAt)}</Text>
                    </View>
                    {PROCESSING_STATUSES.includes(item.job.status) && (
                      <View style={styles.taskProgressBar}>
                        <View
                          style={[styles.taskProgressFill, { width: `${Math.max(item.job.progress, 8)}%` }]}
                        />
                      </View>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#CCC" />
                </TouchableOpacity>
              );
            })}
            <Text style={styles.historyHint}>点按恢复任务，长按删除</Text>
          </View>
        )}

        {/* 空状态 */}
        {history.length === 0 && !imageUri && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="videocam-outline" size={48} color={BRAND_BLUE} />
            </View>
            <Text style={styles.emptyTitle}>开始拍题</Text>
            <Text style={styles.emptySub}>拍照或从相册选择题目图片{'\n'}AI 将为你生成详细的讲解视频</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F7" },
  header: {
    backgroundColor: "#FFF",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5EA",
  },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#1A1A1A" },
  headerSub: { fontSize: 13, color: "#8E8E93", marginTop: 4 },
  content: { flex: 1 },

  // ─── Error ───
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF2F2",
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 10,
  },
  errorText: { color: "#FF3B30", fontSize: 13, flex: 1 },

  // ─── Confirm ───
  confirmBanner: {
    backgroundColor: "#FFF8E1",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FFE082",
  },
  confirmIconRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  confirmTitle: { fontSize: 16, fontWeight: "600", color: "#F57C00" },
  confirmText: { fontSize: 14, color: "#666", lineHeight: 20, marginBottom: 14 },
  confirmActions: { flexDirection: "row", gap: 12 },
  confirmAcceptButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: SUCCESS_GREEN,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
  },
  confirmAcceptText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  confirmRejectButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CCC",
    justifyContent: "center",
  },
  confirmRejectText: { color: "#999", fontSize: 14 },

  // ─── Pick Section ───
  pickSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  cameraCard: {
    borderRadius: 16,
    overflow: "hidden",
  },
  cameraCardBg: {
    backgroundColor: BRAND_BLUE,
    paddingVertical: 36,
    alignItems: "center",
    gap: 8,
  },
  cameraIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  cameraCardTitle: { fontSize: 18, fontWeight: "700", color: "#FFF" },
  cameraCardSub: { fontSize: 13, color: "rgba(255,255,255,0.75)" },

  albumCard: {
    borderRadius: 16,
    backgroundColor: "#FFF",
    paddingVertical: 28,
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#E0E0E0",
    borderStyle: "dashed",
  },
  albumIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BRAND_BLUE_LIGHTER,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  albumCardTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  albumCardSub: { fontSize: 13, color: "#999" },

  // ─── Preview Section ───
  previewSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  previewImageWrap: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FFF",
    position: "relative",
  },
  previewImage: { width: "100%", height: 200 },
  previewCloseBtn: {
    position: "absolute",
    top: 8,
    right: 8,
  },

  // ─── Description ───
  descriptionBox: {
    marginTop: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
  },
  descriptionLabel: { fontSize: 13, fontWeight: "600", color: "#666", marginBottom: 8 },
  descriptionInput: {
    minHeight: 64,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#333",
    backgroundColor: "#FAFAFA",
  },

  // ─── Progress ───
  progressCard: {
    marginTop: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E8EFF8",
  },
  progressHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  progressHeaderTitle: { fontSize: 14, fontWeight: "600", color: "#333" },
  progressHeaderPercent: { fontSize: 14, fontWeight: "700", color: BRAND_BLUE },
  progressBar: {
    height: 6,
    backgroundColor: "#E5E5EA",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: BRAND_BLUE, borderRadius: 3 },
  progressHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    backgroundColor: BRAND_BLUE_LIGHTER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  progressHintText: { fontSize: 13, color: BRAND_BLUE, fontWeight: "500" },
  stagesList: { marginTop: 14, gap: 10 },
  stageRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stageIcon: { width: 22, alignItems: "center", marginTop: 1 },
  stageInfo: { flex: 1 },
  stageLabel: { fontSize: 13, fontWeight: "500", color: "#666" },
  stageDesc: { fontSize: 11, color: "#999", marginTop: 1 },

  // ─── Completed ───
  completedCard: {
    marginTop: 12,
    gap: 12,
  },
  videoPreviewCard: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#FFF",
  },
  videoPreviewBg: {
    height: 140,
    backgroundColor: BRAND_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  videoPlayCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoPreviewInfo: {
    padding: 14,
  },
  videoPreviewTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  videoPreviewTitle: { fontSize: 15, fontWeight: "600", color: "#333" },
  videoPreviewSub: { fontSize: 13, color: "#999", marginTop: 4 },
  completedNoVideo: { alignItems: "center", paddingVertical: 28 },
  completedText: { fontSize: 16, fontWeight: "600", color: "#333", marginTop: 12 },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: BRAND_BLUE_LIGHTER,
    paddingVertical: 13,
    borderRadius: 10,
  },
  resetText: { color: BRAND_BLUE, fontSize: 15, fontWeight: "600" },

  // ─── Submit ───
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: ACTION_RED,
    marginTop: 16,
    paddingVertical: 15,
    borderRadius: 12,
  },
  submitText: { color: "#FFF", fontSize: 16, fontWeight: "700" },

  // ─── Sections ───
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A1A" },
  sectionCount: { fontSize: 13, color: "#999" },
  sectionClear: { fontSize: 13, color: "#FF3B30" },

  // ─── Video Grid (completed) ───
  videoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CARD_GAP,
  },
  videoGridCard: {
    width: GRID_CARD_WIDTH,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FFF",
  },
  videoGridThumb: {
    width: "100%",
    aspectRatio: 16 / 10,
    position: "relative",
    overflow: "hidden",
  },
  videoGridThumbImg: {
    width: "100%",
    height: "100%",
  },
  videoGridThumbFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: BRAND_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  videoGridOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoGridInfo: {
    padding: 10,
  },
  videoGridTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
    lineHeight: 18,
  },
  videoGridMeta: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
  },

  // ─── Task Cards (other history) ───
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  taskCardActive: {
    borderColor: BRAND_BLUE,
    backgroundColor: BRAND_BLUE_LIGHTER,
  },
  taskImage: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  taskImageFallback: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: "#F2F2F7",
    alignItems: "center",
    justifyContent: "center",
  },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 14, fontWeight: "500", color: "#333" },
  taskMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  taskStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  taskStatusDot: { width: 6, height: 6, borderRadius: 3 },
  taskStatusText: { fontSize: 11, fontWeight: "600" },
  taskTime: { fontSize: 11, color: "#999" },
  taskProgressBar: {
    height: 3,
    backgroundColor: "#E5E5EA",
    borderRadius: 2,
    marginTop: 6,
    overflow: "hidden",
  },
  taskProgressFill: { height: "100%", backgroundColor: BRAND_BLUE },
  historyHint: { fontSize: 12, color: "#999", marginTop: 4, textAlign: "center" },

  // ─── Empty State ───
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: BRAND_BLUE_LIGHTER,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#333", marginBottom: 8 },
  emptySub: { fontSize: 14, color: "#999", textAlign: "center", lineHeight: 22 },
});
