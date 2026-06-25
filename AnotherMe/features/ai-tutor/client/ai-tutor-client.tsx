'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Menu,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Stethoscope,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentModelConfig, validateModelConfigForFeature } from '@/lib/utils/model-config';
import { UNIFIED_MENTOR_PRESET } from '@/lib/orchestration/registry/classroom-presets';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/components/auth-provider';
import { DiagnosticProbePanel } from '@/features/diagnostic/components/diagnostic-probe/diagnostic-probe-panel';
import { buildDiagnosticSnapshot } from '@/lib/store/diagnostic';
import { NeuralLoader, BrainWaveLoader } from '@/features/ai-tutor/components/ai-elements/loader';
import { ToolTracePanel } from '@/features/ai-tutor/components/chat/tool-trace-panel';
import { TutorResponseRenderer } from '@/features/ai-tutor/components/chat/tutor-response-renderer';
import {
  MathAnimatorPreview,
  QuizPreview,
  ReasoningBlock,
  VisualizeResultPreview,
  VisualPreview,
} from '@/features/ai-tutor/pages/ai-tutor/tool-previews';
import {
  CAPABILITIES,
  CHAT_TOOLS,
  LEGACY_STORAGE_KEY,
  MAX_SESSIONS,
  STORAGE_KEY,
  TOOL_CONFIG_BY_CAPABILITY,
} from '@/features/ai-tutor/pages/ai-tutor/constants';
import type {
  CapabilityId,
  ChatApiEvent,
  ChatRequestMessage,
  TutorMessage,
  TutorSession,
  TutorToolName,
  TutorToolTrace,
} from '@/features/ai-tutor/pages/ai-tutor/types';
import {
  asTutorToolName,
  createSession,
  deriveSessionTitle,
  extractQuizPreviewQuestions,
  formatSessionTime,
  getSessionPreview,
  getDefaultTools,
  groupSessionsByTime,
  parseApiError,
  parseSSEChunk,
  safeParseSessions,
  stringifyEventValue,
  toToolExecutionTraces,
} from '@/features/ai-tutor/pages/ai-tutor/utils';

export default function AITutorPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [activeCapability, setActiveCapability] = useState<CapabilityId>('');
  const [selectedTools, setSelectedTools] = useState<TutorToolName[]>(getDefaultTools(''));
  const [useAgenticPipeline] = useState(true);
  const [showCapabilityMenu, setShowCapabilityMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showDiagnosticPanel, setShowDiagnosticPanel] = useState(false);
  const [tappedMessageId, setTappedMessageId] = useState<string | null>(null);
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [swipedSessionId, setSwipedSessionId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUserScrollingRef = useRef(false);
  const swipeStartRef = useRef<{ x: number; y: number; id: string } | null>(null);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [sessions],
  );

  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return orderedSessions;
    const q = sessionSearch.trim().toLowerCase();
    return orderedSessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [orderedSessions, sessionSearch]);

  const groupedSessions = useMemo(
    () => groupSessionsByTime(filteredSessions),
    [filteredSessions],
  );

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  const messages = useMemo(() => activeSession?.messages || [], [activeSession]);

  const currentCap = CAPABILITIES.find((c) => c.id === activeCapability) || CAPABILITIES[0];
  const toolConfig = TOOL_CONFIG_BY_CAPABILITY[activeCapability];
  const visibleTools = CHAT_TOOLS.filter((tool) => toolConfig.allowedTools.includes(tool.id));
  const _selectedToolLabels = visibleTools
    .filter((tool) => selectedTools.includes(tool.id))
    .map((tool) => tool.label);

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const savedSessions = safeParseSessions(
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY),
    );
    if (savedSessions.length > 0) {
      const sorted = [...savedSessions].sort(
        (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
      );
      setSessions(sorted.slice(0, MAX_SESSIONS));
      setActiveSessionId(sorted[0].id);
      setHydrated(true);
      return;
    }
    const initial = createSession();
    setSessions([initial]);
    setActiveSessionId(initial.id);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [hydrated, sessions]);

  // 移动端兜底：页面切到后台时立即持久化，防止浏览器暂停 JS 导致丢失
  useEffect(() => {
    if (!hydrated) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setSessions((prev) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
          return prev; // 不触发额外 re-render
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [hydrated]);

  useEffect(() => {
    if (!activeSessionId && orderedSessions[0]?.id) {
      setActiveSessionId(orderedSessions[0].id);
      return;
    }
    if (activeSessionId && !sessions.some((item) => item.id === activeSessionId)) {
      setActiveSessionId(orderedSessions[0]?.id || '');
    }
  }, [activeSessionId, orderedSessions, sessions]);

  // 检测用户是否在底部附近
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100; // 距离底部100px内视为在底部
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // 智能滚动：只有用户在底部时才自动滚动
  const smartScrollToBottom = useCallback(() => {
    if (isUserScrollingRef.current) return;
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isNearBottom]);

  // 手动滚动到底部
  const scrollToBottom = useCallback(() => {
    isUserScrollingRef.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setShowScrollToBottom(false);
  }, []);

  // 处理滚动事件 - 用户主动上滚时暂停自动滚动，回到附近时恢复
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    if (!nearBottom) {
      isUserScrollingRef.current = true;
    } else {
      isUserScrollingRef.current = false;
    }
    setShowScrollToBottom(!nearBottom);
  }, [isNearBottom]);

  useEffect(() => {
    smartScrollToBottom();
  }, [messages, smartScrollToBottom]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const updateSessionMessages = useCallback(
    (targetSessionId: string, updater: (prev: TutorMessage[]) => TutorMessage[]) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== targetSessionId) return session;
          const nextMessages = updater(session.messages);
          const nextTitle = session.autoTitle ? deriveSessionTitle(nextMessages) : session.title;
          return {
            ...session,
            messages: nextMessages,
            title: nextTitle || '新会话',
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [],
  );

  const toRequestMessages = (list: TutorMessage[]): ChatRequestMessage[] => {
    return list.map((item) => ({
      id: item.id,
      role: item.role,
      parts: [{ type: 'text', text: item.content }],
    }));
  };

  const handleNewSession = () => {
    if (isTyping) return;
    abortControllerRef.current?.abort();
    const next = createSession();
    setSessions((prev) => [next, ...prev].slice(0, MAX_SESSIONS));
    setActiveSessionId(next.id);
    setErrorText('');
    setInput('');
  };

  const _handleRenameSession = () => {
    if (!activeSession || isTyping) return;
    const nextTitle = window.prompt('请输入新标题', activeSession.title)?.trim();
    if (!nextTitle) return;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSession.id
          ? { ...session, title: nextTitle, autoTitle: false, updatedAt: new Date().toISOString() }
          : session,
      ),
    );
  };

  const _handleClearCurrent = () => {
    if (!activeSession || isTyping) return;
    setConfirmDialog({
      title: '清空当前会话',
      description: '确定清空当前会话的所有消息吗？此操作不可撤销。',
      confirmLabel: '清空',
      danger: true,
      onConfirm: () => {
        setSessions((prev) =>
          prev.map((session) =>
            session.id === activeSession.id
              ? {
                  ...session,
                  messages: [],
                  autoTitle: true,
                  title: '新会话',
                  updatedAt: new Date().toISOString(),
                }
              : session,
          ),
        );
        setErrorText('');
      },
    });
  };

  const handleClearAll = () => {
    if (isTyping) return;
    setConfirmDialog({
      title: '清空全部历史',
      description: `确定删除全部 ${sessions.length} 个会话吗？此操作不可撤销。`,
      confirmLabel: '全部清空',
      danger: true,
      onConfirm: () => {
        abortControllerRef.current?.abort();
        const fresh = createSession();
        setSessions([fresh]);
        setActiveSessionId(fresh.id);
        setInput('');
        setErrorText('');
        // 立即持久化，不等待 useEffect
        localStorage.setItem(STORAGE_KEY, JSON.stringify([fresh]));
      },
    });
  };

  const handleDeleteSession = (targetSessionId: string) => {
    if (isTyping) return;
    const target = sessions.find((s) => s.id === targetSessionId);
    setConfirmDialog({
      title: '删除会话',
      description: `确定删除「${target?.title || '新会话'}」吗？此操作不可撤销。`,
      confirmLabel: '删除',
      danger: true,
      onConfirm: () => {
        abortControllerRef.current?.abort();
        setSessions((prev) => {
          const next = prev.filter((s) => s.id !== targetSessionId);
          const finalSessions = next.length === 0 ? [createSession()] : next;
          // 立即持久化，不等待 useEffect
          localStorage.setItem(STORAGE_KEY, JSON.stringify(finalSessions));
          return finalSessions;
        });
        // 不在此处设置 activeSessionId，由已有的 useEffect 自动修正：
        // 当 activeSessionId 指向的 session 不存在时，自动切换到第一个 session
      },
    });
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleCapabilitySelect = (capability: CapabilityId) => {
    setActiveCapability(capability);
    setSelectedTools(getDefaultTools(capability));
    setShowCapabilityMenu(false);
    setShowToolsMenu(false);
  };

  const handleToggleTool = (tool: TutorToolName) => {
    if (!toolConfig.allowedTools.includes(tool)) return;
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((item) => item !== tool) : [...prev, tool],
    );
  };

  const handleEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  };

  const handleSaveEdit = () => {
    if (!editingMessageId || !activeSession) return;
    updateSessionMessages(activeSession.id, (prev) =>
      prev.map((msg) => (msg.id === editingMessageId ? { ...msg, content: editingContent } : msg)),
    );
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleRetry = async (messageId: string) => {
    if (isTyping || !activeSession) return;
    const messageIndex = activeSession.messages.findIndex((msg) => msg.id === messageId);
    if (messageIndex === -1 || messageIndex === 0) return;
    const userMessage = activeSession.messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== 'user') return;
    const messagesToKeep = activeSession.messages.slice(0, messageIndex);
    updateSessionMessages(activeSession.id, () => messagesToKeep);
    await handleSend(userMessage.content);
  };

  const handleFeedback = (messageId: string, feedback: 'up' | 'down' | null) => {
    if (!activeSession) return;
    updateSessionMessages(activeSession.id, (prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, feedback } : msg)),
    );
  };

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping || !activeSession) return;

    // Validate model configurations before sending
    const validation = validateModelConfigForFeature('chat');
    if (!validation.valid) {
      const missingText = validation.missingRoles.join('、');
      toast.error('模型配置不完整', {
        description: `请先在设置页面配置：${missingText}`,
      });
      return;
    }

    const targetSessionId = activeSession.id;
    const userMessage: TutorMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const assistantId = `assistant-${Date.now() + 1}`;
    const assistantPlaceholder: TutorMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      capability: activeCapability,
    };

    const snapshotMessages = [...activeSession.messages, userMessage, assistantPlaceholder];
    updateSessionMessages(targetSessionId, () => snapshotMessages);
    setInput('');
    setIsTyping(true);
    setErrorText('');

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let assistantContent = '';
    const deltaQueue: string[] = [];
    let hasStructuredResult = false;
    const structuredOnlyCapability =
      activeCapability === 'math_animator' ||
      activeCapability === 'visualize' ||
      activeCapability === 'quiz_practice';

    const renderAssistant = () => {
      updateSessionMessages(targetSessionId, (prev) =>
        prev.map((msg) => (msg.id === assistantId ? { ...msg, content: assistantContent } : msg)),
      );
    };

    const appendToolEvent = (event: ChatApiEvent) => {
      const toolName = asTutorToolName(event.data?.toolName);
      if (!toolName) return;
      const toolId =
        typeof event.data?.toolId === 'string' ? event.data.toolId : `${toolName}-${Date.now()}`;
      const now = Date.now();

      updateSessionMessages(targetSessionId, (prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          const traces = msg.toolTraces || [];

          if (event.type === 'tool_start') {
            if (traces.some((trace) => trace.id === toolId)) {
              return {
                ...msg,
                toolTraces: traces.map((trace) =>
                  trace.id === toolId ? { ...trace, status: 'running' as const } : trace,
                ),
              };
            }
            return {
              ...msg,
              toolTraces: [...traces, { id: toolId, toolName, status: 'running', startTime: now }],
            };
          }

          const success = event.data?.success !== false;
          const output = stringifyEventValue(event.data?.output);
          const error = stringifyEventValue(event.data?.error);
          const nextTrace: TutorToolTrace = {
            id: toolId,
            toolName,
            status: success ? 'success' : 'error',
            startTime: now,
            endTime: now,
            output,
            error,
          };

          if (!traces.some((trace) => trace.id === toolId)) {
            return { ...msg, toolTraces: [...traces, nextTrace] };
          }

          return {
            ...msg,
            toolTraces: traces.map((trace) =>
              trace.id === toolId
                ? {
                    ...trace,
                    status: success ? 'success' : 'error',
                    endTime: now,
                    output,
                    error,
                  }
                : trace,
            ),
          };
        }),
      );
    };

    const flushDelta = (budget = 2) => {
      let remaining = budget;
      let changed = false;
      while (remaining > 0 && deltaQueue.length > 0) {
        const chunk = deltaQueue[0];
        if (!chunk) {
          deltaQueue.shift();
          continue;
        }
        const take = Math.min(remaining, chunk.length);
        assistantContent += chunk.slice(0, take);
        remaining -= take;
        changed = true;
        if (take >= chunk.length) {
          deltaQueue.shift();
        } else {
          deltaQueue[0] = chunk.slice(take);
        }
      }
      if (changed) renderAssistant();
      return changed;
    };

    const streamTimer = window.setInterval(() => {
      flushDelta(2);
    }, 18);

    try {
      const modelConfig = getCurrentModelConfig();
      const isCapabilityMode = activeCapability !== '';
      const apiEndpoint = isCapabilityMode ? `/api/capabilities/${activeCapability}` : '/api/chat';

      const requestBody = isCapabilityMode
        ? {
            message: trimmed,
            messages: toRequestMessages(snapshotMessages.slice(0, -1)),
            enabledTools: selectedTools,
            ...(activeCapability === 'math_animator'
              ? { outputFormat: 'video', tts: { enabled: false } }
              : {}),
            apiKey: modelConfig.apiKey || '',
            baseUrl: modelConfig.baseUrl || undefined,
            model: modelConfig.modelString || undefined,
            visionModel: modelConfig.visionModelString || undefined,
            ocrModel: modelConfig.ocrModelString || undefined,
            providerType: modelConfig.providerType || undefined,
            requiresApiKey: modelConfig.requiresApiKey,
            visionApiKey: modelConfig.visionApiKey || undefined,
            visionBaseUrl: modelConfig.visionBaseUrl || undefined,
            visionProviderType: modelConfig.visionProviderType || undefined,
            visionRequiresApiKey: modelConfig.visionRequiresApiKey,
            ocrApiKey: modelConfig.ocrApiKey || undefined,
            ocrBaseUrl: modelConfig.ocrBaseUrl || undefined,
            ocrProviderType: modelConfig.ocrProviderType || undefined,
            ocrRequiresApiKey: modelConfig.ocrRequiresApiKey,
          }
        : {
            messages: toRequestMessages(snapshotMessages.slice(0, -1)),
            storeState: {
              stage: null,
              scenes: [],
              currentSceneId: null,
              mode: 'autonomous',
              whiteboardOpen: false,
            },
            config: {
              agentIds: [UNIFIED_MENTOR_PRESET.id],
              sessionType: 'qa',
              enabledTutorTools: selectedTools,
              tutorToolConfig: {},
              useAgenticPipeline: selectedTools.length > 0 ? useAgenticPipeline : false,
            },
            persistence: {
              enabled: true,
              sessionId: targetSessionId,
              title: activeSession.title || 'AI 导师对话',
              source: 'ai_tutor',
              latestUserMessageId: userMessage.id,
            },
            diagnosticSession: buildDiagnosticSnapshot(),
            apiKey: modelConfig.apiKey || '',
            baseUrl: modelConfig.baseUrl || undefined,
            model: modelConfig.modelString || undefined,
            providerType: modelConfig.providerType || undefined,
            requiresApiKey: modelConfig.requiresApiKey,
          };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await parseApiError(response);
        throw new Error(errText || 'AI 导师服务暂时不可用。');
      }
      if (!response.body) {
        throw new Error('AI 导师服务未返回可读取的流。');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = '';

      const processEventBlocks = (blocks: string[]) => {
        for (const block of blocks) {
          const dataLines = block
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data:'));
          for (const line of dataLines) {
            const payloadText = line.replace(/^data:\s*/, '');
            if (!payloadText) continue;
            let event: ChatApiEvent;
            try {
              event = JSON.parse(payloadText) as ChatApiEvent;
            } catch {
              continue;
            }
            if (event.type === 'text_delta') {
              const delta = typeof event.data?.content === 'string' ? event.data.content : '';
              if (delta && !structuredOnlyCapability) deltaQueue.push(delta);
            }
            if (event.type === 'thinking') {
              const content = typeof event.data?.content === 'string' ? event.data.content : '';
              if (content && !structuredOnlyCapability) {
                // 将思考内容累积到 reasoning 字段
                updateSessionMessages(targetSessionId, (prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, reasoning: (msg.reasoning || '') + content }
                      : msg,
                  ),
                );
              }
            }
            if (event.type === 'code_delta') {
              const code = typeof event.data?.code === 'string' ? event.data.code : '';
              if (code && !structuredOnlyCapability) deltaQueue.push(code);
            }
            if (event.type === 'text_end' && structuredOnlyCapability) {
              continue;
            }
            if (event.type === 'tool_start' || event.type === 'tool_end') {
              appendToolEvent(event);
            }
            if (event.type === 'result') {
              const result = event.data && typeof event.data === 'object' ? event.data : {};
              if (structuredOnlyCapability) {
                hasStructuredResult = true;
                assistantContent = '';
                deltaQueue.length = 0;
              }
              updateSessionMessages(targetSessionId, (prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        content: structuredOnlyCapability ? '' : msg.content,
                        capabilityResult: result as Record<string, unknown>,
                      }
                    : msg,
                ),
              );
            }
            if (event.type === 'text_end') {
              const fullText = typeof event.data?.content === 'string' ? event.data.content : '';
              if (fullText) {
                const pendingText = `${assistantContent}${deltaQueue.join('')}`;
                if (fullText.startsWith(pendingText)) {
                  const tail = fullText.slice(pendingText.length);
                  if (tail) deltaQueue.push(tail);
                } else {
                  deltaQueue.length = 0;
                  assistantContent = fullText;
                  renderAssistant();
                }
              }
            }
            if (event.type === 'error') {
              const message =
                typeof event.data?.message === 'string' ? event.data.message : 'AI 导师返回错误。';
              throw new Error(message);
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawBuffer += decoder.decode(value, { stream: true });
        const parsed = parseSSEChunk(rawBuffer);
        rawBuffer = parsed.rest;
        processEventBlocks(parsed.events);
      }

      rawBuffer += decoder.decode();
      const tailParsed = parseSSEChunk(rawBuffer);
      processEventBlocks(tailParsed.events);

      while (flushDelta(9999)) {
        // flush all remaining queued chars
      }

      if (!assistantContent.trim() && !(structuredOnlyCapability && hasStructuredResult)) {
        assistantContent = '收到请求，但当前没有返回文本结果。请检查模型配置后重试。';
        renderAssistant();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        // switched session or new request; ignore aborted errors
      } else {
        const message = error instanceof Error ? error.message : 'AI 导师请求失败。';
        setErrorText(message);
        updateSessionMessages(targetSessionId, (prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content: `请求失败：${message}` } : msg,
          ),
        );
      }
    } finally {
      window.clearInterval(streamTimer);
      setIsTyping(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = '28px';
    const next = Math.max(el.scrollHeight, 28);
    const bounded = Math.min(next, 120);
    el.style.height = `${bounded}px`;
    el.style.overflowY = next > 120 ? 'auto' : 'hidden';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input);
    }
  };

  // 滑动删除手势处理
  const handleSwipeTouchStart = (e: React.TouchEvent, sessionId: string) => {
    const touch = e.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, id: sessionId };
  };
  const handleSwipeTouchEnd = (e: React.TouchEvent, sessionId: string) => {
    if (!swipeStartRef.current || swipeStartRef.current.id !== sessionId) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - swipeStartRef.current.x;
    const dy = touch.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;
    // 水平左滑超过 60px 且垂直偏移小于 40px 时触发
    if (dx < -60 && Math.abs(dy) < 40) {
      setSwipedSessionId(sessionId);
    } else if (dx > 30) {
      setSwipedSessionId((prev) => (prev === sessionId ? null : prev));
    }
  };

  if (!hydrated || !activeSession) {
    return (
      <div className="h-mobile-app flex items-center justify-center text-gray-500 md:h-[calc(var(--app-dvh)-4rem)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在初始化 AI 导师...
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col overflow-hidden bg-[#faf9f7] dark:bg-[#171411] max-md:top-14 md:left-64 md:flex-row">
      {/* 会话列表侧边栏 */}
      <aside className="hidden md:flex bg-[#f5f4f2] dark:bg-[#1c1814] border-r border-gray-200/60 dark:border-gray-800/60 md:flex-col h-full overflow-hidden w-60 shrink-0">
        <div className="p-4 border-b border-gray-200/60 dark:border-gray-800/60">
          <button
            type="button"
            disabled={isTyping}
            onClick={handleNewSession}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#201c18] text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#2a241f] disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-gray-200 dark:border-gray-800 shadow-sm w-full"
          >
            <Plus className="h-4 w-4" />
            <span>新对话</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
          {orderedSessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={cn(
                  'group w-full text-left px-3 py-2.5 rounded-xl mb-1 transition-all text-sm flex items-center gap-2',
                  active
                    ? 'bg-white dark:bg-[#201c18] text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200/80 dark:border-gray-800/80'
                    : 'hover:bg-white/60 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400',
                )}
              >
                <button
                  type="button"
                  disabled={isTyping}
                  onClick={() => setActiveSessionId(session.id)}
                  className="flex-1 min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="font-medium truncate">{session.title}</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {formatSessionTime(session.updatedAt)}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={isTyping}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(session.id);
                  }}
                  className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors md:opacity-0 md:group-hover:opacity-100 disabled:opacity-0"
                  title="删除会话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-gray-200/60 dark:border-gray-800/60 space-y-1">
          <button
            type="button"
            disabled={isTyping}
            onClick={handleClearAll}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-[#201c18] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Trash2 className="h-4 w-4" />
            <span>清空对话历史</span>
          </button>
        </div>
      </aside>

      {/* 移动端会话抽屉 */}
      <div
        className={cn(
          'fixed inset-0 z-50 md:hidden transition-opacity duration-300',
          mobileSessionsOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      >
        <button
          type="button"
          aria-label="关闭会话列表遮罩"
          className={cn(
            'absolute inset-0 bg-black/40 transition-opacity duration-300',
            mobileSessionsOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMobileSessionsOpen(false)}
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col overflow-hidden border-r border-gray-200/60 bg-[#f5f4f2] pt-safe shadow-2xl dark:border-gray-800/60 dark:bg-[#1c1814] transition-transform duration-300 ease-out',
            mobileSessionsOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {/* 抽屉头部：新对话 + 关闭 */}
          <div className="flex items-center justify-between border-b border-gray-200/60 px-4 pt-4 pb-3 dark:border-gray-800/60">
            <button
              type="button"
              disabled={isTyping}
              onClick={() => {
                setMobileSessionsOpen(false);
                handleNewSession();
              }}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-[#201c18] dark:text-gray-200 dark:hover:bg-[#2a241f]"
            >
              <Plus className="h-4 w-4" />
              <span>新对话</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileSessionsOpen(false)}
              className="ml-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-white dark:hover:bg-[#201c18]"
              aria-label="关闭会话列表"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* 搜索栏 */}
          <div className="px-3 py-2 border-b border-gray-200/40 dark:border-gray-800/40">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="搜索会话..."
                className="w-full min-h-[40px] rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-300 focus:ring-1 focus:ring-gray-200 dark:border-gray-700 dark:bg-[#201c18] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-700"
              />
              {sessionSearch && (
                <button
                  type="button"
                  onClick={() => setSessionSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 pb-safe scroll-touch">
            {groupedSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
                <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">{sessionSearch ? '未找到匹配的会话' : '暂无会话'}</p>
              </div>
            ) : (
              groupedSessions.map(([groupLabel, groupSessions]) => (
                <div key={groupLabel} className="mb-1">
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {groupLabel}
                  </p>
                  {groupSessions.map((session) => {
                    const active = session.id === activeSessionId;
                    const preview = getSessionPreview(session);
                    const msgCount = session.messages.length;
                    const isSwiped = swipedSessionId === session.id;
                    return (
                      <div
                        key={session.id}
                        className="relative mb-0.5 overflow-hidden rounded-xl"
                        onTouchStart={(e) => handleSwipeTouchStart(e, session.id)}
                        onTouchEnd={(e) => handleSwipeTouchEnd(e, session.id)}
                      >
                        {/* 滑动露出的删除按钮 */}
                        <div
                          className={cn(
                            'absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-red-500 text-white transition-opacity duration-200',
                            isSwiped ? 'opacity-100' : 'opacity-0 pointer-events-none',
                          )}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSwipedSessionId(null);
                              handleDeleteSession(session.id);
                            }}
                            className="flex h-full w-full items-center justify-center gap-1 text-sm font-medium"
                          >
                            <Trash2 className="h-4 w-4" />
                            删除
                          </button>
                        </div>

                        {/* 会话项主体 */}
                        <div
                          className={cn(
                            'relative flex min-h-[60px] w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200',
                            isSwiped ? '-translate-x-20' : 'translate-x-0',
                            active
                              ? 'bg-white text-gray-900 shadow-sm border border-gray-200/80 dark:border-gray-800/80 dark:bg-[#201c18] dark:text-gray-100'
                              : 'text-gray-600 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/5',
                          )}
                        >
                          <button
                            type="button"
                            disabled={isTyping}
                            onClick={() => {
                              setActiveSessionId(session.id);
                              setMobileSessionsOpen(false);
                              setSwipedSessionId(null);
                            }}
                            className="flex flex-1 items-center gap-2.5 min-w-0 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <div
                              className={cn(
                                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                active
                                  ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
                              )}
                            >
                              <MessageSquare className="h-4 w-4" />
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="block truncate font-medium">{session.title}</span>
                                {msgCount > 0 && (
                                  <span className="shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                                    {msgCount}
                                  </span>
                                )}
                              </span>
                              {preview ? (
                                <span className="mt-0.5 block truncate text-[12px] text-gray-400 dark:text-gray-500">
                                  {preview}
                                </span>
                              ) : (
                                <span className="mt-0.5 block text-[11px] text-gray-400 dark:text-gray-500">
                                  {formatSessionTime(session.updatedAt)}
                                </span>
                              )}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* 底部操作 */}
          <div className="border-t border-gray-200/60 px-3 py-3 pb-safe dark:border-gray-800/60">
            <button
              type="button"
              disabled={isTyping || sessions.length <= 1}
              onClick={handleClearAll}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-[#201c18] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Trash2 className="h-4 w-4" />
              <span>清空全部 ({sessions.length})</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Main Chat Area */}
      <section className="flex-1 flex flex-col min-w-0 bg-[#faf9f7] dark:bg-[#171411] h-full overflow-hidden">
        {/* Top header bar */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200/60 bg-[#faf9f7] px-3 dark:border-gray-800/60 dark:bg-[#171411] md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileSessionsOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm md:hidden"
              aria-label="打开会话列表"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* 移动端显示当前会话标题，可点击切换 */}
            <button
              type="button"
              onClick={() => setMobileSessionsOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-1.5 md:hidden"
            >
              <span className="truncate text-[14px] font-semibold tracking-tight text-gray-800 dark:text-gray-100">
                {activeSession.title}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            </button>
            {/* 桌面端固定标题 */}
            <span className="hidden md:block truncate text-[14px] font-semibold tracking-tight text-gray-800 dark:text-gray-100">
              聊天
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewSession}
              disabled={isTyping}
              className="hidden items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-[#201c18] dark:text-gray-300 dark:hover:bg-[#2a241f] sm:inline-flex"
            >
              <NotebookPen className="h-3.5 w-3.5" />
              保存到笔记本
            </button>
            {/* 桌面端辅助按钮 */}
            <button
              disabled={isTyping}
              className="hidden md:inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a241f] transition-colors shadow-sm disabled:opacity-50"
              title="通知"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              disabled={isTyping}
              className="hidden md:inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a241f] transition-colors shadow-sm disabled:opacity-50"
              title="设置"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowDiagnosticPanel((v) => !v)}
              disabled={isTyping}
              className={cn(
                'hidden md:inline-flex items-center justify-center h-8 w-8 rounded-lg border transition-colors shadow-sm disabled:opacity-50',
                showDiagnosticPanel
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-white dark:bg-[#201c18] border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a241f]',
              )}
              title="诊断练习"
            >
              <Stethoscope className="h-4 w-4" />
            </button>
            <button
              onClick={handleNewSession}
              disabled={isTyping}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#2d2d2d] px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-black disabled:opacity-50 dark:bg-[#f1dfc5] dark:text-[#1a1612] dark:hover:bg-[#e8d5b8]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">新对话</span>
            </button>
          </div>
        </div>

        {/* Messages area - Flex-1 with internal scroll */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          {messages.length === 0 ? (
            /* Empty state - Centered, no scroll */
            <div className="flex h-full flex-col items-center justify-center px-4 py-12 md:px-6">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white mb-4 shadow-xl shadow-indigo-500/20">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
                  我们先从哪里开始呢？
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6">你的专属AI导师随时为你服务</p>

                {/* 能力滑动选择 */}
                <div className="flex gap-2 overflow-x-auto pb-2 px-2 -mx-2 scrollbar-hide">
                  {CAPABILITIES.filter(cap => cap.id !== '').map((cap) => {
                    const Icon = cap.icon;
                    const isActive = cap.id === activeCapability;
                    return (
                      <button
                        key={cap.id}
                        type="button"
                        onClick={() => {
                          handleCapabilitySelect(cap.id);
                          textareaRef.current?.focus();
                        }}
                        className={cn(
                          'flex items-center gap-2 px-4 py-2.5 rounded-full border whitespace-nowrap transition-all shrink-0',
                          isActive
                            ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600',
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-sm font-medium">{cap.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full mx-auto py-6 px-4 lg:px-10 space-y-6">
              {messages.map((msg, index) => {
                // 如果是 AI 消息且内容为空且正在输入，跳过渲染（思考动画会单独显示）
                const isEmptyAssistant =
                  msg.role === 'assistant' &&
                  !msg.content &&
                  isTyping &&
                  index === messages.length - 1;
                if (isEmptyAssistant) return null;

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'group/message flex gap-3 animate-thinking-enter',
                      msg.role === 'user' && 'flex-row-reverse',
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                    onClick={() => setTappedMessageId(tappedMessageId === msg.id ? null : msg.id)}
                  >
                    <div className="shrink-0">
                      {msg.role === 'user' ? (
                        <div className="h-8 w-8 rounded-full bg-[#2d2d2d] dark:bg-[#f1dfc5] flex items-center justify-center text-white dark:text-[#1a1612] text-xs font-semibold shadow-sm">
                          你
                        </div>
                      ) : (
                        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
                          <Bot className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        'flex-1 overflow-hidden',
                        msg.role === 'user' ? 'text-right' : 'text-left',
                      )}
                    >
                      <div
                        className={cn(
                          'inline-block px-4 py-3 rounded-2xl text-[14px] leading-relaxed max-w-full break-words',
                          msg.role === 'user'
                            ? 'bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] rounded-br-sm'
                            : 'bg-white dark:bg-[#201c18] text-gray-800 dark:text-gray-100 rounded-bl-sm border border-gray-100 dark:border-gray-800 shadow-sm',
                        )}
                      >
                        {editingMessageId === msg.id && msg.role === 'user' ? (
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full min-h-[80px] bg-white/20 dark:bg-black/20 text-white dark:text-[#1a1612] rounded-lg px-3 py-2 text-sm outline-none resize-y placeholder:text-white/70 dark:placeholder:text-black/50"
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-3 py-1.5 text-xs rounded-md bg-white/20 dark:bg-black/20 text-white dark:text-[#1a1612] hover:bg-white/30 dark:hover:bg-black/30"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                className="px-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#2a241f] text-blue-600 dark:text-[#f1dfc5] hover:bg-gray-100 dark:hover:bg-[#332c25]"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        ) : msg.role === 'assistant' ? (
                          <div className="ai-tutor-markdown text-gray-800 dark:text-gray-100">
                            {msg.reasoning ? (
                              <ReasoningBlock
                                reasoning={msg.reasoning}
                                isStreaming={isTyping && index === messages.length - 1}
                              />
                            ) : null}
                            {msg.capability !== 'math_animator' &&
                            msg.capability !== 'visualize' &&
                            msg.capability !== 'quiz_practice' ? (
                              <ToolTracePanel
                                traces={toToolExecutionTraces(msg.toolTraces)}
                                isStreaming={isTyping && index === messages.length - 1}
                              />
                            ) : null}
                            {(() => {
                              const quizQuestions =
                                msg.capability === 'quiz_practice'
                                  ? extractQuizPreviewQuestions(msg.capabilityResult)
                                  : [];

                              if (quizQuestions.length > 0) {
                                return <QuizPreview questions={quizQuestions} />;
                              }

                              if (msg.capability === 'math_animator' && msg.capabilityResult) {
                                return <MathAnimatorPreview result={msg.capabilityResult} />;
                              }

                              if (msg.capability === 'visualize' && msg.capabilityResult) {
                                return <VisualizeResultPreview result={msg.capabilityResult} />;
                              }

                              return (
                                <>
                                  <VisualPreview content={msg.content} />
                                  <TutorResponseRenderer content={msg.content} />
                                </>
                              );
                            })()}
                          </div>
                        ) : (
                          msg.content
                        )}
                      </div>
                      <div
                        className={cn(
                          'flex gap-1 mt-2 transition-opacity duration-200',
                          'md:opacity-0 md:group-hover/message:opacity-100',
                          'max-md:opacity-60',
                          tappedMessageId === msg.id ? '!opacity-100' : '',
                          msg.role === 'user' ? 'justify-end' : 'justify-start',
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {msg.role === 'user' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditMessage(msg.id, msg.content)}
                              disabled={isTyping}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 text-xs transition-colors"
                              title="编辑"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.content)}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs transition-colors"
                              title="复制"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.content)}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs transition-colors"
                              title="复制"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRetry(msg.id)}
                              disabled={isTyping}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 text-xs transition-colors"
                              title="重试"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleFeedback(msg.id, msg.feedback === 'up' ? null : 'up')
                              }
                              disabled={isTyping}
                              className={cn(
                                'min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 text-xs transition-colors',
                                msg.feedback === 'up'
                                  ? 'text-orange-600'
                                  : 'text-gray-400 hover:text-orange-600',
                              )}
                              title="点赞"
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleFeedback(msg.id, msg.feedback === 'down' ? null : 'down')
                              }
                              disabled={isTyping}
                              className={cn(
                                'min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 text-xs transition-colors',
                                msg.feedback === 'down'
                                  ? 'text-orange-600'
                                  : 'text-gray-400 hover:text-orange-600',
                              )}
                              title="点踩"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {isTyping &&
              messages.length > 0 &&
              messages[messages.length - 1]?.role === 'assistant' &&
              !messages[messages.length - 1]?.content ? (
                <div className="flex gap-3 items-start animate-thinking-enter">
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm shrink-0">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="bg-white dark:bg-[#201c18] border border-amber-200 dark:border-amber-800/50 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm animate-border-glow">
                    <div className="flex items-center gap-2.5 text-[14px] text-gray-700 dark:text-gray-200">
                      <BrainWaveLoader size={18} />
                      <span className="thinking-text-shimmer text-transparent">思考中</span>
                      <NeuralLoader size="sm" color="bg-amber-500" />
                    </div>
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* 滚动到底部按钮 */}
          {showScrollToBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 right-6 z-10 flex min-h-[44px] items-center gap-1.5 px-3 py-2 rounded-full bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 shadow-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2a241f] hover:text-gray-900 dark:hover:text-gray-100 transition-all"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              回到底部
            </button>
          )}
        </div>

        {/* Composer - Fixed height, no overflow */}
        <div className="px-4 pb-3 pt-2 pb-safe shrink-0 border-t border-gray-200/60 dark:border-gray-800/60 bg-[#faf9f7] dark:bg-[#171411]">
          {errorText ? (
            <p className="text-xs text-red-600 dark:text-red-400 mb-1.5 text-center">{errorText}</p>
          ) : null}

          <div className="mx-auto w-full px-0 sm:px-4 lg:px-10">
            <div className="relative">
              {showCapabilityMenu && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(280px,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-[#201c18]">
                  {CAPABILITIES.map((cap) => {
                    const Icon = cap.icon;
                    const isActive = cap.id === activeCapability;
                    return (
                      <button
                        key={cap.id}
                        type="button"
                        onClick={() => handleCapabilitySelect(cap.id)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#2a241f]',
                          isActive && 'bg-gray-50 dark:bg-[#2a241f]',
                        )}
                      >
                        <div className="mt-0.5 text-gray-500 dark:text-gray-400">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                              {cap.label}
                            </span>
                            {isActive ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                            {cap.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {showToolsMenu && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(240px,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-[#201c18]">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                      工具
                    </h3>
                  </div>

                  <div className="py-1.5">
                    {CHAT_TOOLS.map((tool) => {
                      const Icon = tool.icon;
                      const isSelected = selectedTools.includes(tool.id);
                      const isAllowed = toolConfig.allowedTools.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          disabled={!isAllowed || isTyping}
                          onClick={() => {
                            if (!isAllowed) return;
                            handleToggleTool(tool.id);
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                            isAllowed
                              ? 'hover:bg-gray-50 dark:hover:bg-[#2a241f] text-gray-700 dark:text-gray-300'
                              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed',
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-5 h-5',
                              isAllowed ? 'text-gray-500' : 'text-gray-300 dark:text-gray-600',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px]">{tool.label}</span>
                              {isSelected && isAllowed && (
                                <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                              )}
                            </div>
                            <div className="text-[11px] text-gray-400">{tool.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="relative rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#201c18] shadow-[0_1px_8px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_8px_rgba(0,0,0,0.2)]">
                {/* Textarea */}
                <div className="px-4 pt-2.5 pb-1.5">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={isTyping}
                    placeholder="今天我能帮你什么？"
                    className="w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-relaxed text-gray-900 dark:text-gray-100 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 disabled:opacity-50"
                    style={{ transition: 'height 0.15s ease-out', minHeight: 24, maxHeight: 120 }}
                  />
                </div>

                {/* Bottom toolbar - Simplified style */}
                <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2">
                  <div className="flex items-center justify-between">
                    {/* Left: icon tools */}
                    <div className="flex items-center gap-0.5">
                      {/* Capability button */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowCapabilityMenu(!showCapabilityMenu);
                          setShowToolsMenu(false);
                        }}
                        disabled={isTyping}
                        className={cn(
                          'inline-flex items-center gap-1 py-1.5 px-2 text-[11px] font-medium transition-colors disabled:opacity-40 rounded-lg',
                          showCapabilityMenu
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800',
                        )}
                        title="能力模式"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="text-[11px]">{currentCap.label}</span>
                        <ChevronDown
                          className={cn(
                            'w-3 h-3 transition-transform',
                            showCapabilityMenu && 'rotate-180',
                          )}
                        />
                      </button>

                      {/* Tools button */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(!showToolsMenu);
                          setShowCapabilityMenu(false);
                        }}
                        disabled={isTyping}
                        className={cn(
                          'inline-flex items-center gap-1 py-1.5 px-2 text-[11px] font-medium transition-colors rounded-lg',
                          showToolsMenu
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800',
                        )}
                        title="工具"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>工具</span>
                        <ChevronDown
                          className={cn(
                            'w-3 h-3 transition-transform',
                            showToolsMenu && 'rotate-180',
                          )}
                        />
                      </button>

                      {/* Reference button */}
                      <button
                        type="button"
                        disabled={isTyping}
                        className="inline-flex items-center gap-1 py-1.5 px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 rounded-lg"
                        title="参考"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">参考</span>
                      </button>
                    </div>

                    {/* Right: send button */}
                    <button
                      type="button"
                      onClick={() => void handleSend(input)}
                      disabled={!input.trim() || isTyping}
                      className="flex items-center justify-center w-11 h-11 rounded-full bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] shadow-lg transition-all hover:bg-black dark:hover:bg-[#e8d5b8] hover:shadow-xl hover:scale-105 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed disabled:hover:scale-100"
                      aria-label="发送"
                    >
                      <ArrowUp className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Right sidebar - Diagnostic Panel (desktop only) */}
      {showDiagnosticPanel && (
        <aside className="hidden md:block w-80 shrink-0 border-l border-gray-200/60 dark:border-gray-800/60 bg-[#f5f4f2] dark:bg-[#1c1814] h-full overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
              <Stethoscope className="h-4 w-4 text-primary" />
              诊断练习
            </h2>
            <button
              onClick={() => setShowDiagnosticPanel(false)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              type="button"
            >
              关闭
            </button>
          </div>
          <DiagnosticProbePanel
            userId={user?.id || ''}
            onAnswered={() => {
              // Diagnostic answers are persisted via the store.
              // The AI tutor picks them up on the next chat message
              // via buildDiagnosticSnapshot → LearningContext.diagnosticSession.
            }}
          />
        </aside>
      )}

      {/* 移动端底部确认弹窗 */}
      <div
        className={cn(
          'fixed inset-0 z-[60] flex items-end md:hidden transition-opacity duration-200',
          confirmDialog ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="关闭"
          onClick={() => setConfirmDialog(null)}
        />
        <div
          className={cn(
            'relative w-full rounded-t-2xl bg-white dark:bg-[#1c1814] pb-safe transition-transform duration-300 ease-out',
            confirmDialog ? 'translate-y-0' : 'translate-y-full',
          )}
        >
          <div className="px-6 pt-5 pb-4">
            {/* 拖拽指示条 */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {confirmDialog?.title}
            </h3>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              {confirmDialog?.description}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 min-h-[48px] rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#201c18] dark:text-gray-300 dark:hover:bg-[#2a241f]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDialog?.onConfirm();
                  setConfirmDialog(null);
                }}
                className={cn(
                  'flex-1 min-h-[48px] rounded-xl text-sm font-medium text-white transition-colors',
                  confirmDialog?.danger
                    ? 'bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700'
                    : 'bg-[#2d2d2d] hover:bg-black dark:bg-[#f1dfc5] dark:text-[#1a1612] dark:hover:bg-[#e8d5b8]',
                )}
              >
                {confirmDialog?.confirmLabel || '确认'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
