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
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useRouter } from "expo-router";
import { api } from "../../lib/api";
import { GATEWAY_URL, BEARER_TOKEN, TUNNEL_HEADERS, USER_ID } from "../../lib/config";
import { getSafeStorage } from "../../lib/safeStorage";
import {
  createProblemStepFollowupContext,
  saveProblemStepFollowupContext,
  type ProblemStepFollowupIntent,
} from "../../lib/problem-step-followup";

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

type SolveMode = "steps" | "video" | "matplotlib" | "interactive";

interface JobState {
  status: JobStatus;
  jobId: string | null;
  progress: number;
  step: string;
  videoUrl: string | null;
  imageUrl: string | null;
  interactiveUrl: string | null;
  scenePackageUrl: string | null;
  error: string | null;
  softenedPrompt: string | null;
}

interface SolutionStep {
  id: number;
  title: string;
  narration: string;
  description?: string;
  knowledgePointIds?: string[];
  abilityTags?: string[];
}

interface PersistedProblemVideoState {
  imageUri: string | null;
  description: string;
  job: JobState;
  solutionSteps?: SolutionStep[];
}

interface ProblemVideoHistoryItem extends PersistedProblemVideoState {
  id: string;
  createdAt: number;
  updatedAt: number;
}

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
  imageUrl: null,
  interactiveUrl: null,
  scenePackageUrl: null,
  error: null,
  softenedPrompt: null,
};

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

function renderModeForSolveMode(mode: SolveMode): string {
  if (mode === "matplotlib") return "matplotlib";
  if (mode === "interactive") return "interactive";
  return "video";
}

function normalizeSolutionSteps(value: unknown): SolutionStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<SolutionStep | null>((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const idValue = Number(raw.id ?? raw.step_id ?? index + 1);
      const id = Number.isFinite(idValue) ? idValue : index + 1;
      const title = String(raw.title ?? raw.name ?? `第 ${id} 步`).trim();
      const narration = String(
        raw.narration ?? raw.text ?? raw.content ?? raw.description ?? "",
      ).trim();
      const description = String(raw.description ?? "").trim() || undefined;
      const knowledgePointIds = Array.isArray(raw.knowledgePointIds)
        ? raw.knowledgePointIds
            .map((item) => String(item).trim())
            .filter(Boolean)
        : [];
      const abilityTags = Array.isArray(raw.abilityTags)
        ? raw.abilityTags
            .map((item) => String(item).trim())
            .filter(Boolean)
        : [];
      return {
        id,
        title,
        narration,
        description,
        knowledgePointIds,
        abilityTags,
      };
    })
    .filter((item): item is SolutionStep => item !== null);
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  return new Uint8Array(await file.arrayBuffer());
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [job, setJob] = useState<JobState>(EMPTY_JOB);
  const [solutionSteps, setSolutionSteps] = useState<SolutionStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<ProblemVideoHistoryItem[]>([]);
  const [videoModalUrl, setVideoModalUrl] = useState<string | null>(null);
  const [videoModalTitle, setVideoModalTitle] = useState("讲解视频");
  const [solveMode, setSolveMode] = useState<SolveMode>("video");
  const [actionStep, setActionStep] = useState<SolutionStep | null>(null);
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
      ? await ImagePicker.launchCameraAsync({
          quality: 0.7,
          allowsEditing: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.7,
          allowsEditing: true,
        });

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
    const body = new Uint8Array(
      headerBytes.length + bytes.length + footerBytes.length,
    );
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

  const createJob = async (
    objectKey: string,
    renderMode: string = "video",
  ): Promise<string> => {
    setJob((prev) => ({ ...prev, status: "creating_job" }));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...TUNNEL_HEADERS,
    };
    if (BEARER_TOKEN) headers["Authorization"] = `Bearer ${BEARER_TOKEN}`;

    const payload = {
      image_object_key: objectKey,
      ...(description.trim() ? { problem_text: description.trim() } : {}),
      render_mode: renderMode,
    };
    console.log("[camera] createJob payload:", JSON.stringify(payload));

    const res = await fetch(`${GATEWAY_URL}/v1/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        job_type: "problem_video_generate",
        payload,
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
        const result = data.result as Record<string, unknown> | undefined;
        const snapshot =
          result?.problem_snapshot && typeof result.problem_snapshot === "object"
            ? (result.problem_snapshot as Record<string, unknown>)
            : null;
        const steps = normalizeSolutionSteps(result?.steps || snapshot?.allSteps);
        if (steps.length) {
          setSolutionSteps((prev) => {
            if (
              prev.length === steps.length &&
              prev.every((item, idx) => item.id === steps[idx]?.id)
            ) {
              return prev;
            }
            setExpandedSteps(new Set(steps.map((s) => s.id)));
            return steps;
          });
        }

        if (status === "completed" || status === "succeeded") {
          if (pollRef.current) clearInterval(pollRef.current);
          const videoUrl =
            (result?.videoUrl as string) ||
            (result?.video_url as string) ||
            (result?.outputUrl as string) ||
            null;
          const imageUrl =
            (result?.image_url as string) ||
            (result?.imageUrl as string) ||
            null;
          const interactiveUrl =
            (result?.interactive_url as string) ||
            (result?.interactiveUrl as string) ||
            null;
          const scenePackageUrl =
            (result?.scene_package_url as string) ||
            (result?.scenePackageUrl as string) ||
            null;
          setJob((prev) => ({
            ...prev,
            status: "completed",
            progress: 100,
            step: "completed",
            videoUrl,
            imageUrl,
            interactiveUrl,
            scenePackageUrl,
          }));
        } else if (status === "failed" || status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob((prev) => ({
            ...prev,
            status: "failed",
            error: (data.error_message as string) || "任务失败",
          }));
        } else if (
          status === "needs_confirmation" ||
          (data.error_code as string) === "CONTENT_SENSITIVE"
        ) {
          if (pollRef.current) clearInterval(pollRef.current);
          const softenedPrompt =
            (data.softened_prompt as string) ||
            (data.result?.softened_prompt as string) ||
            "";
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
        const [raw, rawHistory] = await Promise.all([
          AS.getItem(STORAGE_KEY),
          AS.getItem(HISTORY_KEY),
        ]);
        if (rawHistory && !cancelled) {
          const parsedHistory = JSON.parse(
            rawHistory,
          ) as ProblemVideoHistoryItem[];
          setHistory(
            Array.isArray(parsedHistory)
              ? parsedHistory.slice(0, MAX_HISTORY_ITEMS)
              : [],
          );
        }
        if (!raw || cancelled) {
          setHydrated(true);
          return;
        }
        const saved = JSON.parse(raw) as PersistedProblemVideoState;
        setImageUri(saved.imageUri || null);
        setDescription(saved.description || "");
        if (saved.solutionSteps?.length) {
          setSolutionSteps(saved.solutionSteps);
          setExpandedSteps(new Set(saved.solutionSteps.map((s) => s.id)));
        }
        const restoredJob = saved.job || EMPTY_JOB;
        setJob(
          restoredJob.status === "uploading" ||
            restoredJob.status === "creating_job"
            ? {
                ...restoredJob,
                status: "failed",
                error: "上次任务在创建前中断，请重新提交",
              }
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
    return () => {
      cancelled = true;
    };
  }, [pollJob]);

  useEffect(() => {
    if (!hydrated) return;
    const AS = getSafeStorage();
    const persist = async () => {
      if (!imageUri && job.status === "idle") {
        await AS.removeItem(STORAGE_KEY);
        return;
      }
      await AS.setItem(
        STORAGE_KEY,
        JSON.stringify({ imageUri, description, job, solutionSteps }),
      );
    };
    persist().catch(() => {});
  }, [hydrated, imageUri, description, job, solutionSteps]);

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
        solutionSteps,
      };
      return [
        item,
        ...prev.filter((i) => i.id !== item.id && i.job.jobId !== job.jobId),
      ].slice(0, MAX_HISTORY_ITEMS);
    });
  }, [hydrated, imageUri, description, job, solutionSteps]);

  useEffect(() => {
    if (!hydrated) return;
    const AS = getSafeStorage();
    AS.setItem(HISTORY_KEY, JSON.stringify(history)).catch(() => {});
  }, [hydrated, history]);

  const handleSubmit = async () => {
    if (!imageUri) {
      setJob((prev) => ({
        ...prev,
        error: "请先拍照或选择图片",
        status: "failed",
      }));
      return;
    }
    const renderMode = renderModeForSolveMode(solveMode);
    try {
      const objectKey = await uploadImage(imageUri!);
      const jobId = await createJob(objectKey, renderMode);
      setJob((prev) => ({ ...prev, jobId, status: "queued" }));
      pollJob(jobId);
    } catch (err) {
      setJob((prev) => ({
        ...prev,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleConfirmSoftening = async () => {
    if (!imageUri) return;
    const softenedDesc = job.softenedPrompt || description;
    setJob((prev) => ({
      ...prev,
      status: "idle",
      error: null,
      softenedPrompt: null,
    }));
    setDescription(softenedDesc);
    const renderMode = renderModeForSolveMode(solveMode);
    try {
      const objectKey = await uploadImage(imageUri!);
      const jobId = await createJob(objectKey, renderMode);
      setJob((prev) => ({ ...prev, jobId, status: "queued" }));
      pollJob(jobId);
    } catch (err) {
      setJob((prev) => ({
        ...prev,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleRejectSoftening = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setJob((prev) => ({
      ...prev,
      status: "failed",
      error: "用户取消了内容柔化",
      softenedPrompt: null,
    }));
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setImageUri(null);
    setDescription("");
    setJob(EMPTY_JOB);
    // 解题步骤保留，不随重置清除
    getSafeStorage()
      .removeItem(STORAGE_KEY)
      .catch(() => {});
  };

  const resumeHistoryItem = (item: ProblemVideoHistoryItem) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setImageUri(item.imageUri);
    setDescription(item.description);
    setJob(item.job);
    setSolutionSteps(item.solutionSteps || []);
    setExpandedSteps(new Set((item.solutionSteps || []).map((s) => s.id)));
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

  const openVideo = (url: string, title = "讲解视频") => {
    if (/^[a-zA-Z]:[\\/]/.test(url)) {
      setJob((prev) => ({
        ...prev,
        error:
          "产物地址是服务器本地路径，移动端无法直接访问，请重新生成或检查网关对象地址配置",
      }));
      return;
    }
    setVideoModalTitle(title);
    setVideoModalUrl(url);
  };

  const toggleStep = (stepId: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const startStepFollowup = async (
    step: SolutionStep,
    intent: ProblemStepFollowupIntent = "socratic",
  ) => {
    const context = createProblemStepFollowupContext({
      intent,
      jobId: job.jobId,
      imageUri,
      description,
      solveMode,
      problemSnapshot: {
        source: "problem_video_job",
        summary: description.trim() || "拍题任务已生成解题步骤，题面文字未手动补充。",
        allSteps: solutionSteps.map((item) => ({
          id: item.id,
          title: item.title,
          narration: item.narration,
          description: item.description,
          knowledgePointIds: item.knowledgePointIds,
          abilityTags: item.abilityTags,
        })),
      },
      step,
    });

    try {
      await saveProblemStepFollowupContext(context);
      api.learningEvents
        .createForUser(USER_ID, {
          event_type: "problem_step_questioned",
          block_id: job.jobId ? `${job.jobId}:step:${step.id}` : `step:${step.id}`,
          payload: {
            followup_id: context.id,
            intent,
            job_id: job.jobId,
            step_id: step.id,
            step_title: step.title,
            solve_mode: solveMode,
            has_image: Boolean(imageUri),
            has_description: Boolean(description.trim()),
          },
          weight: 0.4,
        })
        .catch(() => {});
      router.push({
        pathname: intent === "socratic" ? "/socratic-workbench" : "/chat",
        params: { followupId: context.id },
      });
    } catch (err) {
      setJob((prev) => ({
        ...prev,
        status: "failed",
        error: err instanceof Error ? err.message : "无法创建步骤追问",
      }));
    }
  };

  const openStepActionMenu = (step: SolutionStep) => {
    setActionStep(step);
  };

  const runStepAction = (intent: ProblemStepFollowupIntent) => {
    if (!actionStep) return;
    const step = actionStep;
    setActionStep(null);
    startStepFollowup(step, intent).catch((err) => {
      setJob((prev) => ({
        ...prev,
        status: "failed",
        error: err instanceof Error ? err.message : "无法创建步骤追问",
      }));
    });
  };

  const isProcessing = PROCESSING_STATUSES.includes(job.status);

  const statusLabel: Record<string, string> = {
    uploading: "上传图片中...",
    creating_job: "识别题目中...",
    queued: "排队等待中...",
    running:
      solveMode === "matplotlib"
        ? "AI 正在生成可视化图表..."
        : solveMode === "interactive"
          ? "AI 正在生成交互可视化..."
        : "AI 正在生成讲解视频...",
  };

  const historyStatusLabel: Record<JobStatus, { text: string; color: string }> =
    {
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
  const completedVideoHistory = history.filter(
    (h) => h.job.status === "completed" && h.job.videoUrl && !h.job.interactiveUrl,
  );
  const completedVizHistory = history.filter(
    (h) =>
      h.job.status === "completed" &&
      h.job.imageUrl &&
      !h.job.videoUrl &&
      !h.job.interactiveUrl,
  );
  const completedInteractiveHistory = history.filter(
    (h) => h.job.status === "completed" && h.job.interactiveUrl,
  );
  const otherHistory = history.filter(
    (h) =>
      !(
        h.job.status === "completed" &&
        (h.job.videoUrl || h.job.imageUrl || h.job.interactiveUrl)
      ),
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>拍题答疑</Text>
        <Text style={styles.headerSub}>
          拍照或选择图片，AI 生成题解 / 讲解视频 / 可视化图表 / 交互演示
        </Text>
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
            <TouchableOpacity
              onPress={() => setJob((prev) => ({ ...prev, error: null }))}
            >
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
              <TouchableOpacity
                style={styles.confirmAcceptButton}
                onPress={handleConfirmSoftening}
              >
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.confirmAcceptText}>使用安全提示词</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmRejectButton}
                onPress={handleRejectSoftening}
              >
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
              <Image
                source={{ uri: imageUri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
              {!isProcessing && job.status !== "completed" && (
                <TouchableOpacity
                  style={styles.previewCloseBtn}
                  onPress={handleReset}
                >
                  <Ionicons
                    name="close-circle"
                    size={26}
                    color="rgba(0,0,0,0.5)"
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* 补充说明 */}
            {!isProcessing && job.status !== "completed" && (
              <View style={styles.descriptionBox}>
                <Text style={styles.descriptionLabel}>
                  题目补充说明（选填）
                </Text>
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

            {/* 解答方式选择 */}
            {!isProcessing && job.status !== "completed" && (
              <View style={styles.modeSelector}>
                <Text style={styles.modeSelectorLabel}>解答方式</Text>
                <View style={styles.modeTabs}>
                  {[
                    {
                      key: "steps" as SolveMode,
                      icon: "document-text" as const,
                      label: "题解",
                    },
                    {
                      key: "video" as SolveMode,
                      icon: "videocam" as const,
                      label: "视频",
                    },
                    {
                      key: "matplotlib" as SolveMode,
                      icon: "bar-chart" as const,
                      label: "可视化",
                    },
                    {
                      key: "interactive" as SolveMode,
                      icon: "analytics" as const,
                      label: "交互",
                    },
                  ].map((tab) => (
                    <TouchableOpacity
                      key={tab.key}
                      style={[
                        styles.modeTab,
                        solveMode === tab.key && styles.modeTabActive,
                      ]}
                      onPress={() => setSolveMode(tab.key)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={tab.icon}
                        size={18}
                        color={solveMode === tab.key ? "#FFF" : BRAND_BLUE}
                      />
                      <Text
                        style={[
                          styles.modeTabText,
                          solveMode === tab.key && styles.modeTabTextActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* 进度条 */}
            {isProcessing && (
              <View style={styles.progressCard}>
                <View style={styles.progressHeaderRow}>
                  <Text style={styles.progressHeaderTitle}>生成进度</Text>
                  <Text style={styles.progressHeaderPercent}>
                    {Math.round(job.progress)}%
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.max(job.progress, 8)}%` },
                    ]}
                  />
                </View>
                <View style={styles.progressHintRow}>
                  <ActivityIndicator size="small" color={BRAND_BLUE} />
                  <Text style={styles.progressHintText}>
                    {statusLabel[job.status] || "处理中..."}
                  </Text>
                </View>
              </View>
            )}

            {/* 完成状态：视频卡片或 Matplotlib 图片 */}
            {job.status === "completed" && (
              <View style={styles.completedCard}>
                {job.interactiveUrl ? (
                  <TouchableOpacity
                    style={styles.videoPreviewCard}
                    onPress={() => openVideo(job.interactiveUrl!, "交互可视化")}
                    activeOpacity={0.85}
                  >
                    <View style={styles.interactivePreviewBg}>
                      <View style={styles.videoPlayCircle}>
                        <Ionicons name="analytics" size={30} color="#FFF" />
                      </View>
                    </View>
                    <View style={styles.videoPreviewInfo}>
                      <View style={styles.videoPreviewTitleRow}>
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={SUCCESS_GREEN}
                        />
                        <Text style={styles.videoPreviewTitle}>
                          交互可视化生成完成
                        </Text>
                      </View>
                      <Text style={styles.videoPreviewSub}>
                        点击打开可拖拽几何演示
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : job.imageUrl ? (
                  <View style={styles.matplotlibResultCard}>
                    <View style={styles.matplotlibHeaderRow}>
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={SUCCESS_GREEN}
                      />
                      <Text style={styles.matplotlibTitle}>可视化生成完成</Text>
                    </View>
                    <Image
                      source={{ uri: resolveUrl(job.imageUrl) }}
                      style={styles.matplotlibImage}
                      resizeMode="contain"
                    />
                  </View>
                ) : job.videoUrl ? (
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
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={SUCCESS_GREEN}
                        />
                        <Text style={styles.videoPreviewTitle}>
                          视频生成完成
                        </Text>
                      </View>
                      <Text style={styles.videoPreviewSub}>
                        点击播放讲解视频
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.completedNoVideo}>
                    <Ionicons
                      name="checkmark-circle"
                      size={48}
                      color={SUCCESS_GREEN}
                    />
                    <Text style={styles.completedText}>生成完成！</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.resetButton}
                  onPress={handleReset}
                >
                  <Ionicons name="camera" size={18} color={BRAND_BLUE} />
                  <Text style={styles.resetText}>再拍一题</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 解题步骤（始终保留，不随完成/重置清除） */}
            {solutionSteps.length > 0 && (
              <View style={styles.stepsCard}>
                <View style={styles.stepsHeaderRow}>
                  <Ionicons name="list" size={18} color={BRAND_BLUE} />
                  <Text style={styles.stepsHeaderTitle}>解题步骤</Text>
                  <Text style={styles.stepsCount}>
                    {solutionSteps.length} 步
                  </Text>
                </View>
                {solutionSteps.map((step, idx) => {
                  const expanded = expandedSteps.has(step.id);
                  return (
                    <View key={step.id || idx} style={styles.stepItem}>
                      <TouchableOpacity
                        style={styles.stepHeader}
                        onPress={() => toggleStep(step.id)}
                        onLongPress={() => openStepActionMenu(step)}
                        delayLongPress={350}
                        activeOpacity={0.7}
                      >
                        <View style={styles.stepNumber}>
                          <Text style={styles.stepNumberText}>
                            {step.id || idx + 1}
                          </Text>
                        </View>
                        <Text
                          style={styles.stepTitle}
                          numberOfLines={expanded ? 0 : 2}
                        >
                          {step.title}
                        </Text>
                        <Ionicons
                          name={expanded ? "chevron-up" : "chevron-down"}
                          size={18}
                          color="#999"
                        />
                      </TouchableOpacity>
                      {expanded && (
                        <View style={styles.stepNarrationWrap}>
                          <Text style={styles.stepNarration}>
                            {step.narration}
                          </Text>
                          <TouchableOpacity
                            style={styles.stepFollowupButton}
                            onPress={() => openStepActionMenu(step)}
                            activeOpacity={0.75}
                          >
                            <Ionicons
                              name="chatbubble-ellipses-outline"
                              size={15}
                              color={BRAND_BLUE}
                            />
                            <Text style={styles.stepFollowupText}>
                              追问这一步
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* 提交按钮 */}
            {!isProcessing && job.status !== "completed" && (
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmit}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={
                    solveMode === "matplotlib"
                      ? "bar-chart"
                      : solveMode === "interactive"
                        ? "analytics"
                        : "videocam"
                  }
                  size={20}
                  color="#FFF"
                />
                <Text style={styles.submitText}>
                  {solveMode === "matplotlib"
                    ? "生成可视化图表"
                    : solveMode === "interactive"
                      ? "生成交互可视化"
                    : solveMode === "steps"
                      ? "生成题解"
                      : "生成讲解视频"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ─── 已完成视频网格 ─── */}
        {completedVideoHistory.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>讲解视频</Text>
              <Text style={styles.sectionCount}>
                {completedVideoHistory.length} 个
              </Text>
            </View>
            <View style={styles.videoGrid}>
              {completedVideoHistory.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.videoGridCard}
                  onPress={() => openVideo(item.job.videoUrl!)}
                  activeOpacity={0.85}
                >
                  <View style={styles.videoGridThumb}>
                    {item.imageUri ? (
                      <Image
                        source={{ uri: item.imageUri }}
                        style={styles.videoGridThumbImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.videoGridThumbFallback}>
                        <Ionicons
                          name="document-text"
                          size={24}
                          color="rgba(255,255,255,0.6)"
                        />
                      </View>
                    )}
                    <View style={styles.videoGridOverlay}>
                      <Ionicons
                        name="play-circle"
                        size={36}
                        color="rgba(255,255,255,0.9)"
                      />
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

        {/* ─── 已完成交互可视化网格 ─── */}
        {completedInteractiveHistory.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons
                name="analytics"
                size={16}
                color={BRAND_BLUE}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.sectionTitle}>交互可视化</Text>
              <Text style={styles.sectionCount}>
                {completedInteractiveHistory.length} 个
              </Text>
            </View>
            <View style={styles.videoGrid}>
              {completedInteractiveHistory.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.videoGridCard}
                  onPress={() => openVideo(item.job.interactiveUrl!, "交互可视化")}
                  activeOpacity={0.85}
                >
                  <View style={styles.videoGridThumb}>
                    {item.imageUri ? (
                      <Image
                        source={{ uri: item.imageUri }}
                        style={styles.videoGridThumbImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.videoGridThumbFallback}>
                        <Ionicons
                          name="analytics"
                          size={24}
                          color="rgba(255,255,255,0.6)"
                        />
                      </View>
                    )}
                    <View style={styles.videoGridOverlay}>
                      <Ionicons
                        name="hand-left"
                        size={32}
                        color="rgba(255,255,255,0.9)"
                      />
                    </View>
                  </View>
                  <View style={styles.videoGridInfo}>
                    <Text style={styles.videoGridTitle} numberOfLines={2}>
                      {item.description.trim() || "交互可视化"}
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

        {/* ─── 已完成可视化图表网格 ─── */}
        {completedVizHistory.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons
                name="bar-chart"
                size={16}
                color={BRAND_BLUE}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.sectionTitle}>可视化图表</Text>
              <Text style={styles.sectionCount}>
                {completedVizHistory.length} 个
              </Text>
            </View>
            <View style={styles.videoGrid}>
              {completedVizHistory.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.videoGridCard}
                  onPress={() => resumeHistoryItem(item)}
                  activeOpacity={0.85}
                >
                  <View style={styles.videoGridThumb}>
                    {item.job.imageUrl ? (
                      <Image
                        source={{ uri: resolveUrl(item.job.imageUrl) }}
                        style={styles.videoGridThumbImg}
                        resizeMode="cover"
                      />
                    ) : item.imageUri ? (
                      <Image
                        source={{ uri: item.imageUri }}
                        style={styles.videoGridThumbImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.videoGridThumbFallback}>
                        <Ionicons
                          name="bar-chart"
                          size={24}
                          color="rgba(255,255,255,0.6)"
                        />
                      </View>
                    )}
                  </View>
                  <View style={styles.videoGridInfo}>
                    <Text style={styles.videoGridTitle} numberOfLines={2}>
                      {item.description.trim() || "题目可视化"}
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
                    <Image
                      source={{ uri: item.imageUri }}
                      style={styles.taskImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.taskImageFallback}>
                      <Ionicons name="image-outline" size={20} color="#999" />
                    </View>
                  )}
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskName} numberOfLines={1}>
                      {item.description.trim() ||
                        item.job.step ||
                        "拍题视频任务"}
                    </Text>
                    <View style={styles.taskMetaRow}>
                      <View
                        style={[
                          styles.taskStatusBadge,
                          { backgroundColor: statusInfo.color + "18" },
                        ]}
                      >
                        <View
                          style={[
                            styles.taskStatusDot,
                            { backgroundColor: statusInfo.color },
                          ]}
                        />
                        <Text
                          style={[
                            styles.taskStatusText,
                            { color: statusInfo.color },
                          ]}
                        >
                          {statusInfo.text}
                        </Text>
                      </View>
                      <Text style={styles.taskTime}>
                        {formatHistoryTime(item.updatedAt)}
                      </Text>
                    </View>
                    {PROCESSING_STATUSES.includes(item.job.status) && (
                      <View style={styles.taskProgressBar}>
                        <View
                          style={[
                            styles.taskProgressFill,
                            { width: `${Math.max(item.job.progress, 8)}%` },
                          ]}
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
            <Text style={styles.emptySub}>
              拍照或从相册选择题目图片{"\n"}AI 将为你生成题解 / 讲解视频 /
              可视化图表 / 交互演示
            </Text>
          </View>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(actionStep)}
        transparent
        animationType="fade"
        onRequestClose={() => setActionStep(null)}
      >
        <TouchableOpacity
          style={styles.actionSheetOverlay}
          activeOpacity={1}
          onPress={() => setActionStep(null)}
        >
          <TouchableOpacity
            style={[
              styles.actionSheet,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
            activeOpacity={1}
          >
            <Text style={styles.actionSheetTitle} numberOfLines={2}>
              {actionStep?.title || "解题步骤"}
            </Text>
            <Text style={styles.actionSheetHint}>
              选择 AI 导师接下来要帮你的方式
            </Text>
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => runStepAction("socratic")}
            >
              <Ionicons name="help-circle-outline" size={21} color={BRAND_BLUE} />
              <View style={styles.actionSheetItemText}>
                <Text style={styles.actionSheetItemTitle}>引导追问</Text>
                <Text style={styles.actionSheetItemSub}>先用问题帮你自己想出来</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => runStepAction("explain")}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={21} color={BRAND_BLUE} />
              <View style={styles.actionSheetItemText}>
                <Text style={styles.actionSheetItemTitle}>直接解释</Text>
                <Text style={styles.actionSheetItemSub}>说明为什么能这样做</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => runStepAction("reframe")}
            >
              <Ionicons name="color-wand-outline" size={21} color={BRAND_BLUE} />
              <View style={styles.actionSheetItemText}>
                <Text style={styles.actionSheetItemTitle}>换种讲法</Text>
                <Text style={styles.actionSheetItemSub}>用更直观的语言重新讲</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => runStepAction("practice")}
            >
              <Ionicons name="create-outline" size={21} color={BRAND_BLUE} />
              <View style={styles.actionSheetItemText}>
                <Text style={styles.actionSheetItemTitle}>生成类似题</Text>
                <Text style={styles.actionSheetItemSub}>用一道小题检查是否掌握</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSheetCancel}
              onPress={() => setActionStep(null)}
            >
              <Text style={styles.actionSheetCancelText}>取消</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <Modal
        visible={Boolean(videoModalUrl)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setVideoModalUrl(null)}
      >
        <View style={[styles.videoModalContainer, { paddingTop: insets.top }]}>
          <View style={styles.videoModalHeader}>
            <TouchableOpacity
              style={styles.videoModalIconButton}
              onPress={() => setVideoModalUrl(null)}
            >
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.videoModalTitle}>{videoModalTitle}</Text>
            <TouchableOpacity
              style={styles.videoModalIconButton}
              onPress={() => {
                if (!videoModalUrl) return;
                Linking.openURL(resolveUrl(videoModalUrl)).catch(() => {
                  setJob((prev) => ({ ...prev, error: "无法打开视频链接" }));
                });
              }}
            >
              <Ionicons name="open-outline" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>
          {videoModalUrl && (
            <WebView
              source={{
                uri: resolveUrl(videoModalUrl),
                headers: TUNNEL_HEADERS,
              }}
              style={styles.videoWebView}
              allowsFullscreenVideo
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={styles.videoModalLoading}>
                  <ActivityIndicator color="#FFF" />
                  <Text style={styles.videoModalLoadingText}>
                    正在加载{videoModalTitle}...
                  </Text>
                </View>
              )}
            />
          )}
        </View>
      </Modal>
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
  videoModalContainer: { flex: 1, backgroundColor: "#000" },
  videoModalHeader: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    backgroundColor: "#111",
  },
  videoModalIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  videoModalTitle: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  videoWebView: { flex: 1, backgroundColor: "#000" },
  videoModalLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    gap: 10,
  },
  videoModalLoadingText: { color: "#FFF", fontSize: 13 },

  // ─── Step Action Sheet ───
  actionSheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  actionSheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  actionSheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1A1A1A",
    lineHeight: 22,
  },
  actionSheetHint: {
    fontSize: 13,
    color: "#8E8E93",
    marginTop: 4,
    marginBottom: 12,
  },
  actionSheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#EFEFF4",
  },
  actionSheetItemText: { flex: 1 },
  actionSheetItemTitle: {
    fontSize: 15,
    color: "#1A1A1A",
    fontWeight: "600",
  },
  actionSheetItemSub: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 2,
  },
  actionSheetCancel: {
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: "#F2F2F7",
  },
  actionSheetCancelText: {
    fontSize: 15,
    color: "#333",
    fontWeight: "600",
  },

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
  confirmIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  confirmTitle: { fontSize: 16, fontWeight: "600", color: "#F57C00" },
  confirmText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 14,
  },
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
  descriptionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
  },
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
  progressFill: {
    height: "100%",
    backgroundColor: BRAND_BLUE,
    borderRadius: 3,
  },
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

  // ─── Solution Steps ───
  stepsCard: {
    marginTop: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E8EFF8",
  },
  stepsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  stepsHeaderTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
    flex: 1,
  },
  stepsCount: { fontSize: 12, color: "#999" },
  stepItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F0F0F0",
    paddingVertical: 10,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: BRAND_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontSize: 13, fontWeight: "700", color: "#FFF" },
  stepTitle: { fontSize: 14, fontWeight: "600", color: "#333", flex: 1 },
  stepNarrationWrap: {
    marginTop: 8,
    marginLeft: 36,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: BRAND_BLUE_LIGHTER,
  },
  stepNarration: { fontSize: 13, color: "#555", lineHeight: 21 },
  stepFollowupButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: BRAND_BLUE_LIGHTER,
  },
  stepFollowupText: {
    fontSize: 12,
    color: BRAND_BLUE,
    fontWeight: "600",
  },

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
  interactivePreviewBg: {
    height: 140,
    backgroundColor: "#5B8DEF",
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
  completedText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
  },
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
  historyHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
    textAlign: "center",
  },

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
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    lineHeight: 22,
  },

  // ─── Mode Selector ───
  modeSelector: {
    marginTop: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
  },
  modeSelectorLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    marginBottom: 10,
  },
  modeTabs: {
    flexDirection: "row",
    gap: 8,
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BRAND_BLUE,
    backgroundColor: "#FFF",
  },
  modeTabActive: {
    backgroundColor: BRAND_BLUE,
    borderColor: BRAND_BLUE,
  },
  modeTabText: { fontSize: 14, fontWeight: "600", color: BRAND_BLUE },
  modeTabTextActive: { color: "#FFF" },

  // ─── Matplotlib Result ───
  matplotlibResultCard: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E8EFF8",
  },
  matplotlibHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F0F0F0",
  },
  matplotlibTitle: { fontSize: 15, fontWeight: "600", color: "#333" },
  matplotlibImage: {
    width: "100%",
    aspectRatio: 10 / 8,
    backgroundColor: "#FAFAFA",
  },
});
