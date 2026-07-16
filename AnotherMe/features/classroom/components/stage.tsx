'use client';

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStageStore } from '@/lib/store';
import { PENDING_SCENE_ID } from '@/lib/store/stage';
import { useCanvasStore } from '@/lib/store/canvas';
import { useSettingsStore } from '@/lib/store/settings';
import { useI18n } from '@/lib/hooks/use-i18n';
import { SceneSidebar } from './stage/scene-sidebar';
import { CanvasArea } from '@/features/classroom/components/canvas/canvas-area';
import { Roundtable } from '@/features/classroom/components/roundtable';
import { ReactionBar } from '@/features/classroom/components/roundtable/reaction-bar';
import { PlaybackEngine, computePlaybackView } from '@/lib/playback';
import type { EngineMode, TriggerEvent, Effect } from '@/lib/playback';
import { ActionEngine } from '@/lib/action/engine';
import { createAudioPlayer } from '@/lib/utils/audio-player';
import { useDiscussionTTS } from '@/lib/hooks/use-discussion-tts';
import { useAudioRecorder } from '@/lib/hooks/use-audio-recorder';
import type { AudioIndicatorState } from '@/features/classroom/components/roundtable/audio-indicator';
import type { Action, DiscussionAction, SpeechAction } from '@/lib/types/action';
import type { TutorToolState } from '@/lib/types/tutor-tools';
import { cn } from '@/lib/utils';
// Playback state persistence removed — refresh always starts from the beginning
import { ChatArea, type ChatAreaRef } from '@/features/ai-tutor/components/chat/chat-area';
import { agentsToParticipants, useAgentRegistry } from '@/lib/orchestration/registry/store';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { useIsMobileLandscape } from '@/hooks/use-landscape';
import { useSwipeGestures } from '@/hooks/use-swipe-gestures';
import { PresentationSpeechOverlay } from '@/features/classroom/components/roundtable/presentation-speech-overlay';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle,
  Play,
  Pause,
  Mic,
  MicOff,
  MessageSquare,
  Send,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Square,
} from 'lucide-react';
import { VisuallyHidden } from 'radix-ui';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import {
  DEFAULT_TEACHER_AVATAR,
  DEFAULT_STUDENT_AVATAR,
} from '@/features/classroom/components/roundtable/constants';
import type { Participant } from '@/lib/types/roundtable';
import { toast } from 'sonner';

/**
 * Stage Component
 *
 * The main container for the classroom/course.
 * Combines sidebar (scene navigation) and content area (scene viewer).
 * Supports two modes: autonomous and playback.
 */
export function Stage({
  onRetryOutline,
}: {
  onRetryOutline?: (outlineId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const { mode, getCurrentScene, scenes, currentSceneId, setCurrentSceneId, generatingOutlines } =
    useStageStore();
  const failedOutlines = useStageStore.use.failedOutlines();

  const currentScene = getCurrentScene();

  // Layout state from settings store (persisted via localStorage)
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const chatAreaWidth = useSettingsStore((s) => s.chatAreaWidth);
  const setChatAreaWidth = useSettingsStore((s) => s.setChatAreaWidth);
  const chatAreaCollapsed = useSettingsStore((s) => s.chatAreaCollapsed);
  const setChatAreaCollapsed = useSettingsStore((s) => s.setChatAreaCollapsed);
  const setTTSMuted = useSettingsStore((s) => s.setTTSMuted);
  const setTTSVolume = useSettingsStore((s) => s.setTTSVolume);

  // PlaybackEngine state
  const [engineMode, setEngineMode] = useState<EngineMode>('idle');
  const [playbackCompleted, setPlaybackCompleted] = useState(false); // Distinguishes "never played" idle from "finished" idle
  const [lectureSpeech, setLectureSpeech] = useState<string | null>(null); // From PlaybackEngine (lecture)
  const [liveSpeech, setLiveSpeech] = useState<string | null>(null); // From buffer (discussion/QA)
  const [speechProgress, setSpeechProgress] = useState<number | null>(null); // StreamBuffer reveal progress (0–1)
  const [discussionTrigger, setDiscussionTrigger] = useState<TriggerEvent | null>(null);

  // Speaking agent tracking (Issue 2)
  const [speakingAgentId, setSpeakingAgentId] = useState<string | null>(null);

  // Thinking state (Issue 5)
  const [thinkingState, setThinkingState] = useState<{
    stage: string;
    agentId?: string;
  } | null>(null);

  // Cue user state (Issue 7)
  const [isCueUser, setIsCueUser] = useState(false);

  // End flash state (Issue 3)
  const [showEndFlash, setShowEndFlash] = useState(false);
  const [endFlashSessionType, setEndFlashSessionType] = useState<'qa' | 'discussion'>('discussion');

  // Streaming state for stop button (Issue 1)
  const [chatIsStreaming, setChatIsStreaming] = useState(false);
  const [chatSessionType, setChatSessionType] = useState<string | null>(null);

  // Topic pending state: session is soft-paused, bubble stays visible, waiting for user input
  const [isTopicPending, setIsTopicPending] = useState(false);

  // Active bubble ID for playback highlight in chat area (Issue 8)
  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);

  // Scene switch confirmation dialog state
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPresentationInteractionActive, setIsPresentationInteractionActive] = useState(false);

  // Whiteboard state (from canvas store so AI tools can open it)
  const whiteboardOpen = useCanvasStore.use.whiteboardOpen();
  const setWhiteboardOpen = useCanvasStore.use.setWhiteboardOpen();

  // Selected agents from settings store (Zustand)
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const ttsMuted = useSettingsStore((s) => s.ttsMuted);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);

  // Generate participants from selected agents
  const participants = useMemo(
    () => agentsToParticipants(selectedAgentIds, t),
    [selectedAgentIds, t],
  );

  // Resolved AgentConfig array for hooks that need full agent objects
  // Subscribe to the agents record so voiceConfig changes trigger re-resolution
  const agentsRecord = useAgentRegistry((s) => s.agents);
  const selectedAgents = useMemo(
    () => selectedAgentIds.map((id) => agentsRecord[id]).filter((a): a is AgentConfig => a != null),
    [agentsRecord, selectedAgentIds],
  );
  const teacherAgentId = useMemo(
    () =>
      selectedAgents.find((agent) => agent.role === 'teacher')?.id ??
      participants.find((participant) => participant.role === 'teacher')?.id ??
      'default-1',
    [participants, selectedAgents],
  );
  const teacherAgentIdRef = useRef(teacherAgentId);

  useEffect(() => {
    teacherAgentIdRef.current = teacherAgentId;
  }, [teacherAgentId]);

  // Discussion TTS: audio indicator state
  const [audioIndicatorState, setAudioIndicatorState] = useState<AudioIndicatorState>('idle');
  const [audioAgentId, setAudioAgentId] = useState<string | null>(null);

  // AI导师工具状态
  const [tutorToolState, setTutorToolState] = useState<TutorToolState>({
    enabledTools: [],
    config: {},
    useAgenticPipeline: false, // 默认使用预执行模式（向后兼容）
  });

  const discussionTTS = useDiscussionTTS({
    enabled: ttsEnabled && !ttsMuted,
    agents: selectedAgents,
    onAudioStateChange: (agentId, state) => {
      setAudioAgentId(agentId);
      setAudioIndicatorState(state);
    },
  });

  // Pick a student agent for discussion trigger (prioritize student > non-teacher > fallback)
  const pickStudentAgent = useCallback((): string => {
    const registry = useAgentRegistry.getState();
    const agents = selectedAgentIds
      .map((id) => registry.getAgent(id))
      .filter((a): a is AgentConfig => a != null);
    const students = agents.filter((a) => a.role === 'student');
    if (students.length > 0) {
      return students[Math.floor(Math.random() * students.length)].id;
    }
    const nonTeachers = agents.filter((a) => a.role !== 'teacher');
    if (nonTeachers.length > 0) {
      return nonTeachers[Math.floor(Math.random() * nonTeachers.length)].id;
    }
    return agents[0]?.id || 'default-1';
  }, [selectedAgentIds]);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const audioPlayerRef = useRef(createAudioPlayer());
  const chatAreaRef = useRef<ChatAreaRef>(null);
  const isMobile = useIsMobile();
  const isMobileLandscape = useIsMobileLandscape();
  const [mobileSceneDrawerOpen, setMobileSceneDrawerOpen] = useState(false);
  const [mobileChatDrawerOpen, setMobileChatDrawerOpen] = useState(false);
  const lectureSessionIdRef = useRef<string | null>(null);
  const lectureActionCounterRef = useRef(0);
  const discussionAbortRef = useRef<AbortController | null>(null);
  const presentationIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Guard to prevent double flash when manual stop triggers onDiscussionEnd
  const manualStopRef = useRef(false);
  // Monotonic counter incremented on each scene switch — used to discard stale SSE callbacks
  const sceneEpochRef = useRef(0);
  // When true, the next engine init will auto-start playback (for auto-play scene advance)
  const autoStartRef = useRef(false);
  // Discussion buffer-level pause state (distinct from soft-pause which aborts SSE)
  const [isDiscussionPaused, setIsDiscussionPaused] = useState(false);

  // Listen for native shell commands (React Native WebView bridge)
  useEffect(() => {
    const toggleSceneList = () => setMobileSceneDrawerOpen((prev) => !prev);
    const toggleChat = () => setMobileChatDrawerOpen((prev) => !prev);
    window.addEventListener('native:toggleSceneList', toggleSceneList);
    window.addEventListener('native:toggleChat', toggleChat);
    return () => {
      window.removeEventListener('native:toggleSceneList', toggleSceneList);
      window.removeEventListener('native:toggleChat', toggleChat);
    };
  }, []);

  // Expose stage store state to native shell via window.__STAGE_STORE_STATE__
  useEffect(() => {
    const unsub = useStageStore.subscribe((state) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__STAGE_STORE_STATE__ = {
        currentSceneId: state.currentSceneId,
        scenes: state.scenes,
        totalScenes: state.scenes.length,
      };
    });
    // Initial write
    const s = useStageStore.getState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__STAGE_STORE_STATE__ = {
      currentSceneId: s.currentSceneId,
      scenes: s.scenes,
      totalScenes: s.scenes.length,
    };
    return unsub;
  }, []);

  /**
   * Resume a soft-paused topic: re-call /chat with existing session messages.
   * The director picks the next agent to continue.
   */
  const doResumeTopic = useCallback(async () => {
    // Clear old bubble immediately — no lingering on interrupted text
    setIsTopicPending(false);
    setLiveSpeech(null);
    setSpeakingAgentId(null);
    setThinkingState({ stage: 'director' });
    setChatIsStreaming(true);
    // Transition engine back to live — onInputActivate paused it when soft-pausing,
    // so we must explicitly resume to keep engine mode in sync with the chat loop.
    engineRef.current?.resume();
    // Fire new chat round — SSE events will drive thinking → agent_start → speech
    await chatAreaRef.current?.resumeActiveSession();
  }, []);

  /** Reset all live/discussion state (shared by doSessionCleanup & onDiscussionEnd) */
  const resetLiveState = useCallback(() => {
    setLiveSpeech(null);
    setSpeakingAgentId(null);
    setSpeechProgress(null);
    setThinkingState(null);
    setIsCueUser(false);
    setIsTopicPending(false);
    setChatIsStreaming(false);
    setChatSessionType(null);
    setIsDiscussionPaused(false);
  }, []);

  /** Full scene reset (scene switch) — resetLiveState + lecture/visual state */
  const resetSceneState = useCallback(() => {
    resetLiveState();
    setPlaybackCompleted(false);
    setLectureSpeech(null);
    setSpeechProgress(null);
    setShowEndFlash(false);
    setActiveBubbleId(null);
    setDiscussionTrigger(null);
  }, [resetLiveState]);

  /** Request failure should exit live discussion UI without hard-closing the session. */
  const handleLiveSessionError = useCallback(() => {
    engineRef.current?.handleDiscussionError();
    resetLiveState();
    setActiveBubbleId(null);
  }, [resetLiveState]);

  /**
   * Unified session cleanup — called by both roundtable stop button and chat area end button.
   * Handles: engine transition, flash, roundtable state clearing.
   */
  const doSessionCleanup = useCallback(() => {
    const activeType = chatSessionType;

    // Engine cleanup — guard to avoid double flash from onDiscussionEnd
    manualStopRef.current = true;
    engineRef.current?.handleEndDiscussion();
    manualStopRef.current = false;

    // Show end flash with correct session type
    if (activeType === 'qa' || activeType === 'discussion') {
      setEndFlashSessionType(activeType);
      setShowEndFlash(true);
      setTimeout(() => setShowEndFlash(false), 1800);
    }

    // Stop any in-flight discussion TTS audio
    discussionTTS.cleanup();

    resetLiveState();
  }, [chatSessionType, resetLiveState, discussionTTS]);

  // Shared stop-discussion handler (used by both Roundtable and Canvas toolbar)
  const handleStopDiscussion = useCallback(async () => {
    await chatAreaRef.current?.endActiveSession();
    doSessionCleanup();
  }, [doSessionCleanup]);

  const clearPresentationIdleTimer = useCallback(() => {
    if (presentationIdleTimerRef.current) {
      clearTimeout(presentationIdleTimerRef.current);
      presentationIdleTimerRef.current = null;
    }
  }, []);

  const resetPresentationIdleTimer = useCallback(() => {
    setControlsVisible(true);
    clearPresentationIdleTimer();
    if (isPresenting && !isPresentationInteractionActive) {
      presentationIdleTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [clearPresentationIdleTimer, isPresenting, isPresentationInteractionActive]);

  const togglePresentation = useCallback(async () => {
    const stageElement = stageRef.current;
    if (!stageElement) return;

    try {
      if (document.fullscreenElement === stageElement) {
        // Unlock Escape key before exiting fullscreen
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
        await document.exitFullscreen();
        return;
      }

      setControlsVisible(true);
      await stageElement.requestFullscreen();
      // Lock Escape key so it doesn't auto-exit fullscreen (#255)
      // Escape is handled manually in our keydown handler instead
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (navigator as any).keyboard?.lock?.(['Escape']).catch(() => {});
      setSidebarCollapsed(true);
      setChatAreaCollapsed(true);
    } catch {
      // Firefox may deny fullscreen from certain keyboard events (e.g. F11)
      console.warn('[Presentation] Fullscreen request denied — browser policy');
    }
  }, [setChatAreaCollapsed, setSidebarCollapsed]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === stageRef.current;
      setIsPresenting(active);

      if (!active) {
        // Ensure keyboard unlock on any fullscreen exit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
        setControlsVisible(true);
        clearPresentationIdleTimer();
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [clearPresentationIdleTimer]);

  useEffect(() => {
    if (!isPresenting) {
      setControlsVisible(true);
      clearPresentationIdleTimer();
      return;
    }

    const handleActivity = () => {
      resetPresentationIdleTimer();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('pointerdown', handleActivity);
    if (isPresentationInteractionActive) {
      setControlsVisible(true);
      clearPresentationIdleTimer();
    } else {
      resetPresentationIdleTimer();
    }

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('pointerdown', handleActivity);
      clearPresentationIdleTimer();
    };
  }, [
    clearPresentationIdleTimer,
    isPresenting,
    isPresentationInteractionActive,
    resetPresentationIdleTimer,
  ]);

  // Initialize playback engine when scene changes
  useEffect(() => {
    // Bump epoch so any stale SSE callbacks from the previous scene are discarded
    sceneEpochRef.current++;

    // End any active QA/discussion session — this synchronously aborts the SSE
    // stream inside use-chat-sessions (abortControllerRef.abort()), preventing
    // stale onLiveSpeech callbacks from leaking into the new scene.
    chatAreaRef.current?.endActiveSession();

    // Also abort the engine-level discussion controller
    if (discussionAbortRef.current) {
      discussionAbortRef.current.abort();
      discussionAbortRef.current = null;
    }

    // Stop any in-flight discussion TTS audio on scene switch
    discussionTTS.cleanup();

    // Reset all roundtable/live state so scenes are fully isolated
    resetSceneState();

    let cancelled = false;

    if (!currentScene || !currentScene.actions || currentScene.actions.length === 0) {
      engineRef.current = null;
      setEngineMode('idle');

      return () => {
        cancelled = true;
      };
    }

    // Stop previous engine
    if (engineRef.current) {
      engineRef.current.stop();
    }

    // Create ActionEngine for playback (with audioPlayer for TTS)
    const actionEngine = new ActionEngine(useStageStore, audioPlayerRef.current);

    // Create new PlaybackEngine
    const engine = new PlaybackEngine([currentScene], actionEngine, audioPlayerRef.current, {
      onModeChange: (mode) => {
        if (cancelled || engineRef.current !== engine) return;
        setEngineMode(mode);
      },
      onSceneChange: (_sceneId) => {
        // Scene change handled by engine
      },
      onSpeechStart: (text) => {
        if (cancelled || engineRef.current !== engine) return;
        setLectureSpeech(text);
        // Add to lecture session with incrementing index for dedup
        // Chat area pacing is handled by the StreamBuffer (onTextReveal)
        if (lectureSessionIdRef.current) {
          const idx = lectureActionCounterRef.current++;
          const speechId = `speech-${Date.now()}`;
          chatAreaRef.current?.addLectureMessage(
            lectureSessionIdRef.current,
            { id: speechId, type: 'speech', text } as Action,
            idx,
          );
          // Track active bubble for highlight (Issue 8)
          const msgId = chatAreaRef.current?.getLectureMessageId(lectureSessionIdRef.current!);
          if (msgId) setActiveBubbleId(msgId);
        }
      },
      onSpeechEnd: () => {
        if (cancelled || engineRef.current !== engine) return;
        // Don't clear lectureSpeech — let it persist until the next
        // onSpeechStart replaces it or the scene transitions.
        // Clearing here causes fallback to idleText (first sentence).
        setActiveBubbleId(null);
      },
      onEffectFire: (effect: Effect) => {
        if (cancelled || engineRef.current !== engine) return;
        // Add to lecture session with incrementing index
        if (
          lectureSessionIdRef.current &&
          (effect.kind === 'spotlight' || effect.kind === 'laser')
        ) {
          const idx = lectureActionCounterRef.current++;
          chatAreaRef.current?.addLectureMessage(
            lectureSessionIdRef.current,
            {
              id: `${effect.kind}-${Date.now()}`,
              type: effect.kind,
              elementId: effect.targetId,
            } as Action,
            idx,
          );
        }
      },
      onProactiveShow: (trigger) => {
        if (cancelled || engineRef.current !== engine) return;
        if (!trigger.agentId) {
          // Mutate in-place so engine.currentTrigger also gets the agentId
          // (confirmDiscussion reads agentId from the same object reference)
          trigger.agentId = pickStudentAgent();
        }
        setDiscussionTrigger(trigger);
      },
      onProactiveHide: () => {
        if (cancelled || engineRef.current !== engine) return;
        setDiscussionTrigger(null);
      },
      onDiscussionConfirmed: (topic, prompt, agentId) => {
        if (cancelled || engineRef.current !== engine) return;
        // Start SSE discussion via ChatArea
        handleDiscussionSSE(topic, prompt, agentId);
      },
      onDiscussionEnd: () => {
        if (cancelled || engineRef.current !== engine) return;
        // Abort any active SSE
        if (discussionAbortRef.current) {
          discussionAbortRef.current.abort();
          discussionAbortRef.current = null;
        }
        setDiscussionTrigger(null);
        // Stop any in-flight discussion TTS audio
        discussionTTS.cleanup();
        // Clear roundtable state (idempotent — may already be cleared by doSessionCleanup)
        resetLiveState();
        // Only show flash for engine-initiated ends (not manual stop — that's handled by doSessionCleanup)
        if (!manualStopRef.current) {
          setEndFlashSessionType('discussion');
          setShowEndFlash(true);
          setTimeout(() => setShowEndFlash(false), 1800);
        }
        // If all actions are exhausted (discussion was the last action), mark
        // playback as completed so the bubble shows reset instead of play.
        if (engineRef.current?.isExhausted()) {
          setPlaybackCompleted(true);
        }
      },
      onUserInterrupt: (text) => {
        if (cancelled || engineRef.current !== engine) return;
        // User interrupted → start a discussion via chat
        const teacherId = teacherAgentIdRef.current || 'default-1';
        chatAreaRef.current?.sendMessage(text, 'chat', {
          agentIds: [teacherId],
          defaultAgentId: teacherId,
        });
      },
      isAgentSelected: (agentId) => {
        const ids = useSettingsStore.getState().selectedAgentIds;
        return ids.includes(agentId);
      },
      getPlaybackSpeed: () => useSettingsStore.getState().playbackSpeed || 1,
      onComplete: () => {
        if (cancelled || engineRef.current !== engine) return;
        // lectureSpeech intentionally NOT cleared — last sentence stays visible
        // until scene transition (auto-play) or user restarts. Scene change
        // effect handles the reset.
        setPlaybackCompleted(true);

        // End lecture session on playback complete
        if (lectureSessionIdRef.current) {
          chatAreaRef.current?.endSession(lectureSessionIdRef.current);
          lectureSessionIdRef.current = null;
        }
        // Auto-play: advance to next scene after a short pause
        const { autoPlayLecture } = useSettingsStore.getState();
        if (autoPlayLecture) {
          setTimeout(() => {
            const stageState = useStageStore.getState();
            if (!useSettingsStore.getState().autoPlayLecture) return;
            const allScenes = stageState.scenes;
            const curId = stageState.currentSceneId;
            const idx = allScenes.findIndex((s) => s.id === curId);
            if (idx >= 0 && idx < allScenes.length - 1) {
              const currentScene = allScenes[idx];
              if (
                currentScene.type === 'quiz' ||
                currentScene.type === 'interactive' ||
                currentScene.type === 'pbl'
              ) {
                return;
              }
              autoStartRef.current = true;
              stageState.setCurrentSceneId(allScenes[idx + 1].id);
            } else if (idx === allScenes.length - 1 && stageState.generatingOutlines.length > 0) {
              // Last scene exhausted but next is still generating — go to pending page
              const currentScene = allScenes[idx];
              if (
                currentScene.type === 'quiz' ||
                currentScene.type === 'interactive' ||
                currentScene.type === 'pbl'
              ) {
                return;
              }
              autoStartRef.current = true;
              stageState.setCurrentSceneId(PENDING_SCENE_ID);
            }
          }, 1500);
        }
      },
    });

    engineRef.current = engine;

    // Auto-start playback
    const doAutoStart = async () => {
      if (currentScene && chatAreaRef.current) {
        const sessionId = await chatAreaRef.current.startLecture(currentScene.id);
        if (cancelled || engineRef.current !== engine) {
          chatAreaRef.current?.endSession(sessionId);
          return;
        }
        lectureSessionIdRef.current = sessionId;
        lectureActionCounterRef.current = 0;
      }
      if (cancelled || engineRef.current !== engine) return;
      engine.start();
    };

    if (autoStartRef.current) {
      // Triggered by auto-play scene advance
      autoStartRef.current = false;
      doAutoStart();
    } else if (isMobile || useSettingsStore.getState().autoPlayLecture) {
      // Mobile: always auto-start playback
      // Desktop: auto-start if autoPlayLecture is enabled
      doAutoStart();
    }
    return () => {
      cancelled = true;
      if (engineRef.current === engine) {
        engine.stop();
        actionEngine.dispose();
        engineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when scene changes, functions are stable refs
  }, [currentScene]);

  // Cleanup on unmount
  useEffect(() => {
    const audioPlayer = audioPlayerRef.current;
    const chatArea = chatAreaRef.current;
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
      audioPlayer.destroy();
      if (discussionAbortRef.current) {
        discussionAbortRef.current.abort();
      }
      discussionTTS.cleanup();
      chatArea?.endActiveSession();
      clearPresentationIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup, clearPresentationIdleTimer is stable
  }, []);

  // Sync mute state from settings store to audioPlayer
  useEffect(() => {
    audioPlayerRef.current.setMuted(ttsMuted);
  }, [ttsMuted]);

  // Sync volume from settings store to audioPlayer
  const ttsVolume = useSettingsStore((s) => s.ttsVolume);
  useEffect(() => {
    if (!ttsMuted) {
      audioPlayerRef.current.setVolume(ttsVolume);
    }
  }, [ttsVolume, ttsMuted]);

  // Sync playback speed to audio player (for live-updating current audio)
  const playbackSpeed = useSettingsStore((s) => s.playbackSpeed);
  useEffect(() => {
    audioPlayerRef.current.setPlaybackRate(playbackSpeed);
  }, [playbackSpeed]);

  // Audio unlock for mobile WebViews — required before Audio.play() can succeed.
  // Mobile browsers (iOS WKWebView, Android WebView) block programmatic audio
  // playback until the user has interacted with the page at least once.
  const audioUnlockAttemptedRef = useRef(false);
  const handleAudioUnlock = useCallback(async () => {
    if (audioUnlockAttemptedRef.current) return;
    if (audioPlayerRef.current.isAudioUnlocked()) {
      audioUnlockAttemptedRef.current = true;
      return;
    }
    audioUnlockAttemptedRef.current = true;
    try {
      await audioPlayerRef.current.unlockAudio();
      // After unlocking, any pending HTML5 Audio play request in processNext()
      // will automatically resolve. Also retry browser-native TTS if it was blocked.
      engineRef.current?.retryBrowserTTSAfterUnlock();
    } finally {
      if (!audioPlayerRef.current.isAudioUnlocked()) {
        audioUnlockAttemptedRef.current = false;
      }
    }
  }, []);

  /**
   * Handle discussion SSE — POST /api/chat and push events to engine
   */
  const handleDiscussionSSE = useCallback(
    async (topic: string, prompt?: string, agentId?: string) => {
      // Start discussion display in ChatArea (lecture speech is preserved independently)
      chatAreaRef.current?.startDiscussion({
        topic,
        prompt,
        agentId: agentId || 'default-1',
      });
      // Auto-switch to chat tab when discussion starts
      chatAreaRef.current?.switchToTab('chat');
      // Immediately mark streaming for synchronized stop button
      setChatIsStreaming(true);
      setChatSessionType('discussion');
      // Optimistic thinking: show thinking dots immediately (same as onMessageSend)
      setThinkingState({ stage: 'director' });
    },
    [],
  );

  const handleClassroomInputActivate = useCallback(() => {
    // Level-1 pause: freeze buffer tick + TTS audio while SSE keeps buffering.
    if (chatSessionType === 'qa' || chatSessionType === 'discussion') {
      const paused = chatAreaRef.current?.pauseActiveLiveBuffer();
      if (paused) {
        discussionTTS.pause();
        setIsDiscussionPaused(true);
      }
    }
    // Also pause playback engine.
    if (engineRef.current && (engineMode === 'playing' || engineMode === 'live')) {
      engineRef.current.pause();
    }
  }, [chatSessionType, discussionTTS, engineMode]);

  const sendTeacherQaMessage = useCallback(async (text: string) => {
    const teacherId = teacherAgentIdRef.current || 'default-1';
    await chatAreaRef.current?.sendMessage(text, 'chat', {
      agentIds: [teacherId],
      defaultAgentId: teacherId,
    });
  }, []);

  const handleClassroomQuestion = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text) return;

      const teacherId = teacherAgentIdRef.current || 'default-1';
      setIsDiscussionPaused(false);
      chatAreaRef.current?.resumeActiveLiveBuffer();
      discussionTTS.cleanup();

      if (isTopicPending) {
        setIsTopicPending(false);
        setLiveSpeech(null);
        setSpeakingAgentId(null);
      }

      if (
        engineRef.current &&
        (engineMode === 'playing' || engineMode === 'live' || engineMode === 'paused')
      ) {
        engineRef.current.handleUserInterrupt(text);
      } else {
        await sendTeacherQaMessage(text);
      }

      chatAreaRef.current?.switchToTab('chat');
      setIsCueUser(false);
      setChatIsStreaming(true);
      setChatSessionType(chatSessionType || 'qa');
      setThinkingState({ stage: 'director', agentId: teacherId });
      setSpeakingAgentId(teacherId);
    },
    [chatSessionType, discussionTTS, engineMode, isTopicPending, sendTeacherQaMessage],
  );

  // First speech text for idle display (extracted here for playbackView)
  const firstSpeechText = useMemo(
    () => currentScene?.actions?.find((a): a is SpeechAction => a.type === 'speech')?.text ?? null,
    [currentScene],
  );

  // Whether the speaking agent is a student (for bubble role derivation)
  const speakingStudentFlag = useMemo(() => {
    if (!speakingAgentId) return false;
    const agent = useAgentRegistry.getState().getAgent(speakingAgentId);
    return agent?.role !== 'teacher';
  }, [speakingAgentId]);

  // Centralised derived playback view
  const playbackView = useMemo(
    () =>
      computePlaybackView({
        engineMode,
        lectureSpeech,
        liveSpeech,
        speakingAgentId,
        thinkingState,
        isCueUser,
        isTopicPending,
        chatIsStreaming,
        discussionTrigger,
        playbackCompleted,
        idleText: firstSpeechText,
        speakingStudent: speakingStudentFlag,
        sessionType: chatSessionType,
      }),
    [
      engineMode,
      lectureSpeech,
      liveSpeech,
      speakingAgentId,
      thinkingState,
      isCueUser,
      isTopicPending,
      chatIsStreaming,
      discussionTrigger,
      playbackCompleted,
      firstSpeechText,
      speakingStudentFlag,
      chatSessionType,
    ],
  );

  const isTopicActive = playbackView.isTopicActive;

  /**
   * Gated scene switch — if a topic is active, show AlertDialog before switching.
   * Returns true if the switch was immediate, false if gated (dialog shown).
   */
  const gatedSceneSwitch = useCallback(
    (targetSceneId: string): boolean => {
      if (targetSceneId === currentSceneId) return false;
      if (isTopicActive) {
        setPendingSceneId(targetSceneId);
        return false;
      }
      setCurrentSceneId(targetSceneId);
      return true;
    },
    [currentSceneId, isTopicActive, setCurrentSceneId],
  );

  /** User confirmed scene switch via AlertDialog */
  const confirmSceneSwitch = useCallback(() => {
    if (!pendingSceneId) return;
    chatAreaRef.current?.endActiveSession();
    doSessionCleanup();
    setCurrentSceneId(pendingSceneId);
    setPendingSceneId(null);
  }, [pendingSceneId, setCurrentSceneId, doSessionCleanup]);

  /** User cancelled scene switch via AlertDialog */
  const cancelSceneSwitch = useCallback(() => {
    setPendingSceneId(null);
  }, []);

  // play/pause toggle
  const handlePlayPause = useCallback(async () => {
    await handleAudioUnlock();

    const engine = engineRef.current;
    if (!engine) return;

    const mode = engine.getMode();
    if (mode === 'playing' || mode === 'live') {
      engine.pause();
      // Pause lecture buffer so text stops immediately
      if (chatAreaRef.current?.pauseAllLectureBuffers) {
        chatAreaRef.current.pauseAllLectureBuffers();
      } else if (lectureSessionIdRef.current) {
        chatAreaRef.current?.pauseBuffer(lectureSessionIdRef.current);
      }
    } else if (mode === 'paused') {
      engine.resume();
      // Resume lecture buffer
      if (chatAreaRef.current?.resumeAllLectureBuffers) {
        chatAreaRef.current.resumeAllLectureBuffers();
      } else if (lectureSessionIdRef.current) {
        chatAreaRef.current?.resumeBuffer(lectureSessionIdRef.current);
      }
    } else {
      const wasCompleted = playbackCompleted;
      setPlaybackCompleted(false);
      // Starting playback - create/reuse lecture session
      if (currentScene && chatAreaRef.current) {
        const sessionId = await chatAreaRef.current.startLecture(currentScene.id);
        lectureSessionIdRef.current = sessionId;
      }
      if (wasCompleted) {
        // Restart from beginning (user clicked restart after completion)
        lectureActionCounterRef.current = 0;
        engine.start();
      } else {
        // Continue from current position (e.g. after discussion end)
        engine.continuePlayback();
      }
    }
  }, [handleAudioUnlock, playbackCompleted, currentScene]);

  // get scene information
  const isPendingScene = currentSceneId === PENDING_SCENE_ID;
  const hasNextPending = generatingOutlines.length > 0;

  // previous scene (gated)
  const handlePreviousScene = useCallback(() => {
    if (isPendingScene) {
      // From pending page → go to last real scene
      if (scenes.length > 0) {
        gatedSceneSwitch(scenes[scenes.length - 1].id);
      }
      return;
    }
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (currentIndex > 0) {
      gatedSceneSwitch(scenes[currentIndex - 1].id);
    }
  }, [currentSceneId, gatedSceneSwitch, isPendingScene, scenes]);

  // next scene (gated)
  const handleNextScene = useCallback(() => {
    if (isPendingScene) return; // Already on pending, nowhere to go
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (currentIndex < scenes.length - 1) {
      gatedSceneSwitch(scenes[currentIndex + 1].id);
    } else if (hasNextPending) {
      // On last real scene → advance to pending page
      setCurrentSceneId(PENDING_SCENE_ID);
    }
  }, [currentSceneId, gatedSceneSwitch, hasNextPending, isPendingScene, scenes, setCurrentSceneId]);

  const currentSceneIndex = isPendingScene
    ? scenes.length
    : scenes.findIndex((s) => s.id === currentSceneId);
  const totalScenesCount = scenes.length + (hasNextPending ? 1 : 0);

  // get action information
  const totalActions = currentScene?.actions?.length || 0;

  // whiteboard toggle
  const handleWhiteboardToggle = () => {
    setWhiteboardOpen(!whiteboardOpen);
  };

  const handleToggleSidebar = useCallback(() => {
    if (isMobileLandscape) return; // No sidebar in landscape
    if (isMobile) {
      setMobileSceneDrawerOpen((current) => !current);
      return;
    }
    setSidebarCollapsed(!sidebarCollapsed);
  }, [isMobile, isMobileLandscape, setSidebarCollapsed, sidebarCollapsed]);

  const handleToggleChat = useCallback(() => {
    if (isMobileLandscape) return; // No chat panel in landscape
    if (isMobile) {
      setMobileChatDrawerOpen((current) => !current);
      return;
    }
    setChatAreaCollapsed(!chatAreaCollapsed);
  }, [chatAreaCollapsed, isMobile, isMobileLandscape, setChatAreaCollapsed]);

  const isPresentationShortcutTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;

    if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
      return true;
    }

    return (
      target.closest(
        ['input', 'textarea', 'select', '[role="slider"]', 'input[type="range"]'].join(', '),
      ) !== null
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Let modifier-key combos (Ctrl+C, Ctrl+S, etc.) pass through to the browser
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        isPresentationShortcutTarget(event.target) ||
        isPresentationShortcutTarget(document.activeElement)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          if (!isPresenting) return;
          event.preventDefault();
          handlePreviousScene();
          resetPresentationIdleTimer();
          break;
        case 'ArrowRight':
          if (!isPresenting) return;
          event.preventDefault();
          handleNextScene();
          resetPresentationIdleTimer();
          break;
        case ' ':
        case 'Spacebar':
          // During active QA/discussion, Roundtable owns Space for
          // buffer-level pause/resume — don't also fire engine play/pause.
          if (chatSessionType === 'qa' || chatSessionType === 'discussion') break;
          event.preventDefault();
          handlePlayPause();
          break;
        case 'Escape':
          // With keyboard.lock(), Escape no longer auto-exits fullscreen.
          // If panels are open, roundtable handles Escape (close panels).
          // If no panels are open, manually exit fullscreen.
          if (isPresenting && !isPresentationInteractionActive) {
            event.preventDefault();
            togglePresentation();
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          setTTSVolume(ttsVolume + 0.1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setTTSVolume(ttsVolume - 0.1);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          setTTSMuted(!ttsMuted);
          break;
        case 's':
        case 'S':
          event.preventDefault();
          handleToggleSidebar();
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          handleToggleChat();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    chatSessionType,
    chatAreaCollapsed,
    handleNextScene,
    handlePlayPause,
    handlePreviousScene,
    handleToggleChat,
    handleToggleSidebar,
    isPresenting,
    isPresentationInteractionActive,
    isPresentationShortcutTarget,
    resetPresentationIdleTimer,
    setTTSMuted,
    setTTSVolume,
    togglePresentation,
    ttsMuted,
    ttsVolume,
  ]);

  // Intercept F11 to use our presentation fullscreen instead of browser fullscreen
  // This way ESC can exit fullscreen (browser F11 fullscreen requires F11 to exit)
  useEffect(() => {
    const onF11 = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        togglePresentation();
      }
    };

    window.addEventListener('keydown', onF11);
    return () => window.removeEventListener('keydown', onF11);
  }, [togglePresentation]);

  // Mobile: horizontal swipe on the stage to switch between scenes.
  // Left swipe → next scene; right swipe → previous scene.
  // Active only during playback on touch devices and outside the discussion
  // overlays so it doesn't fight with the chat / voice panels.
  const swipeEnabled = isMobile && mode === 'playback';
  useSwipeGestures(stageRef, {
    onSwipeLeft: swipeEnabled ? handleNextScene : undefined,
    onSwipeRight: swipeEnabled ? handlePreviousScene : undefined,
    shouldHandle: (target) => {
      if (!(target instanceof Element)) return true;
      // Don't hijack swipes that started on interactive controls.
      if (target.closest('input, textarea, select, button, [role="button"]')) {
        return false;
      }
      // Don't hijack when the canvas toolbar is open / when user is
      // interacting with a chalkboard draw stroke.
      if (target.closest('[data-no-swipe]')) return false;
      return true;
    },
  });

  // Map engine mode to the CanvasArea's expected engine state
  const canvasEngineState = (() => {
    switch (engineMode) {
      case 'playing':
      case 'live':
        return 'playing';
      case 'paused':
        return 'paused';
      default:
        return 'idle';
    }
  })();

  // Build discussion request for Roundtable ProactiveCard from trigger
  const discussionRequest: DiscussionAction | null = discussionTrigger
    ? {
        type: 'discussion',
        id: discussionTrigger.id,
        topic: discussionTrigger.question,
        prompt: discussionTrigger.prompt,
        agentId: discussionTrigger.agentId || 'default-1',
      }
    : null;

  // Calculate scene viewer height (keep space only for roundtable in playback mode)
  // Mobile portrait: full height (no roundtable bar, simplified UI)
  // Mobile landscape: full height (roundtable hidden, speech shown as overlay)
  const sceneViewerHeight = (() => {
    if (isMobileLandscape) return '100%';
    if (isMobile) return undefined; // Let flex handle it (canvas + subtitle + roundtable)
    if (mode !== 'playback' || isPresenting) return '100%';
    return 'calc(100% - 192px)';
  })();
  const chatDisplayWidth =
    isMobile && typeof window !== 'undefined' ? Math.min(window.innerWidth, 430) : chatAreaWidth;
  const chatDisplayCollapsed = isMobile ? !mobileChatDrawerOpen : chatAreaCollapsed;

  return (
    <div
      ref={stageRef}
      className={cn(
        'flex-1 flex overflow-hidden bg-[#f6f4f0] dark:bg-gray-950 relative',
        isPresenting && !controlsVisible && 'cursor-none',
      )}
      onClick={handleAudioUnlock}
      onTouchStart={handleAudioUnlock}
    >
      {/* Scene Sidebar */}
      <SceneSidebar
        collapsed={sidebarCollapsed}
        onCollapseChange={setSidebarCollapsed}
        onSceneSelect={gatedSceneSwitch}
        onRetryOutline={onRetryOutline}
        className="hidden md:flex md:absolute md:inset-y-3 md:left-3 md:z-40 md:rounded-3xl md:border md:border-white/70 md:shadow-[0_24px_80px_rgba(15,23,42,0.14)] md:dark:border-white/10"
      />

      {mobileSceneDrawerOpen && !isMobileLandscape && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="关闭场景列表遮罩"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileSceneDrawerOpen(false)}
          />
          <SceneSidebar
            collapsed={false}
            onCollapseChange={() => setMobileSceneDrawerOpen(false)}
            onSceneSelect={(sceneId) => {
              setMobileSceneDrawerOpen(false);
              gatedSceneSwitch(sceneId);
            }}
            onRetryOutline={onRetryOutline}
            className="absolute inset-y-0 left-0 h-mobile-screen w-[min(86vw,340px)] max-w-[86vw] pt-safe"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        {/* Canvas Area */}
        <div
          className="overflow-hidden relative flex-1 min-h-0 isolate"
          style={{
            height: sceneViewerHeight,
          }}
          suppressHydrationWarning
        >
          <CanvasArea
            currentScene={currentScene}
            currentSceneIndex={currentSceneIndex}
            scenesCount={totalScenesCount}
            mode={mode}
            engineState={canvasEngineState}
            isLiveSession={
              chatIsStreaming || isTopicPending || engineMode === 'live' || !!chatSessionType
            }
            whiteboardOpen={whiteboardOpen}
            sidebarCollapsed={sidebarCollapsed}
            chatCollapsed={chatAreaCollapsed}
            onToggleSidebar={handleToggleSidebar}
            onToggleChat={handleToggleChat}
            onPrevSlide={handlePreviousScene}
            onNextSlide={handleNextScene}
            onPlayPause={handlePlayPause}
            onWhiteboardClose={handleWhiteboardToggle}
            isPresenting={isPresenting}
            onTogglePresentation={togglePresentation}
            showStopDiscussion={
              engineMode === 'live' ||
              (chatIsStreaming && (chatSessionType === 'qa' || chatSessionType === 'discussion'))
            }
            onStopDiscussion={handleStopDiscussion}
            hideToolbar={mode === 'playback' || (isPresenting && !controlsVisible)}
            isPendingScene={isPendingScene}
            isGenerationFailed={
              isPendingScene && failedOutlines.some((f) => f.id === generatingOutlines[0]?.id)
            }
            onRetryGeneration={
              onRetryOutline && generatingOutlines[0]
                ? () => onRetryOutline(generatingOutlines[0].id)
                : undefined
            }
          />
        </div>

        {/* Mobile: full-width subtitle bar above the Roundtable */}
        {mode === 'playback' &&
          isMobile &&
          !isMobileLandscape &&
          (playbackView.sourceText ||
            (playbackView.phase === 'discussionActive' && playbackView.bubbleRole)) && (
          <MobileSubtitleBar
            text={playbackView.sourceText}
            role={playbackView.bubbleRole}
            participants={participants}
            speakingAgentId={speakingAgentId}
            isLoading={!playbackView.sourceText && playbackView.phase === 'discussionActive'}
            buttonState={playbackView.buttonState}
            isPaused={engineMode === 'paused'}
            onBubbleClick={handlePlayPause}
          />
        )}

        {/* Roundtable Area — hidden on mobile landscape (has floating overlay) */}
        {mode === 'playback' && !isMobileLandscape && (
          <div
            className={cn(
              'transition-opacity duration-300',
              !isPresenting && 'shrink-0',
              isPresenting && 'absolute inset-x-0 bottom-0 z-20',
            )}
          >
            <Roundtable
              mode={mode}
              initialParticipants={participants}
              playbackView={playbackView}
              currentSpeech={liveSpeech}
              lectureSpeech={lectureSpeech}
              idleText={firstSpeechText}
              playbackCompleted={playbackCompleted}
              discussionRequest={discussionRequest}
              engineMode={engineMode}
              isStreaming={chatIsStreaming}
              audioIndicatorState={audioIndicatorState}
              audioAgentId={audioAgentId}
              sessionType={
                chatSessionType === 'qa'
                  ? 'qa'
                  : chatSessionType === 'discussion'
                    ? 'discussion'
                    : undefined
              }
              speakingAgentId={speakingAgentId}
              speechProgress={speechProgress}
              showEndFlash={showEndFlash}
              endFlashSessionType={endFlashSessionType}
              thinkingState={thinkingState}
              isCueUser={isCueUser}
              isTopicPending={isTopicPending}
              onMessageSend={handleClassroomQuestion}
              onDiscussionStart={() => {
                // User clicks "Join" on ProactiveCard
                engineRef.current?.confirmDiscussion();
              }}
              onDiscussionSkip={() => {
                // User clicks "Skip" on ProactiveCard
                engineRef.current?.skipDiscussion();
              }}
              onStopDiscussion={handleStopDiscussion}
              onInputActivate={handleClassroomInputActivate}
              onResumeTopic={doResumeTopic}
              onPlayPause={handlePlayPause}
              isDiscussionPaused={isDiscussionPaused}
              onDiscussionPause={() => {
                const paused = chatAreaRef.current?.pauseActiveLiveBuffer();
                if (paused) {
                  discussionTTS.pause();
                  setIsDiscussionPaused(true);
                }
              }}
              onDiscussionResume={() => {
                chatAreaRef.current?.resumeActiveLiveBuffer();
                discussionTTS.resume();
                setIsDiscussionPaused(false);
              }}
              totalActions={totalActions}
              currentActionIndex={0}
              currentSceneIndex={currentSceneIndex}
              scenesCount={totalScenesCount}
              whiteboardOpen={whiteboardOpen}
              sidebarCollapsed={sidebarCollapsed}
              chatCollapsed={chatAreaCollapsed}
              onToggleSidebar={handleToggleSidebar}
              onToggleChat={handleToggleChat}
              onPrevSlide={handlePreviousScene}
              onNextSlide={handleNextScene}
              onWhiteboardClose={handleWhiteboardToggle}
              isPresenting={isPresenting}
              controlsVisible={controlsVisible}
              onTogglePresentation={togglePresentation}
              onPresentationInteractionChange={setIsPresentationInteractionActive}
              fullscreenContainerRef={stageRef}
              tutorToolState={tutorToolState}
              onTutorToolStateChange={setTutorToolState}
            />
            {/* Reaction Bar — floating at the bottom during active discussion */}
            {chatIsStreaming && chatSessionType === 'discussion' && (
              <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2">
                <ReactionBar onReaction={(type) => chatAreaRef.current?.addReaction(type)} />
              </div>
            )}
          </div>
        )}

        {/* Mobile Landscape: floating speech overlay (replaces Roundtable) */}
        {mode === 'playback' && isMobileLandscape && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <MobileSlideNav
              currentSceneIndex={currentSceneIndex}
              scenesCount={totalScenesCount}
              onPrevSlide={handlePreviousScene}
              onNextSlide={handleNextScene}
            />

            <PresentationSpeechOverlay
              playbackView={playbackView}
              participants={participants}
              speakingAgentId={speakingAgentId}
              isTopicPending={isTopicPending}
              side="left"
              onBubbleClick={handlePlayPause}
              audioIndicatorState={audioIndicatorState}
              buttonState={
                playbackView.phase === 'lecturePlaying' || playbackView.phase === 'discussionActive'
                  ? 'bars'
                  : playbackView.phase === 'lecturePaused' ||
                      playbackView.phase === 'discussionPaused'
                    ? 'play'
                    : playbackCompleted
                      ? 'restart'
                      : 'none'
              }
              isPaused={engineMode === 'paused'}
            />

            {/* Right-side participation dock — recording (Mic) + typing (MessageSquare) */}
            <MobileLandscapeDock
              onMessageSend={handleClassroomQuestion}
              onInputActivate={handleClassroomInputActivate}
              onPlayPause={handlePlayPause}
              playbackButtonState={
                playbackView.phase === 'lecturePlaying' || playbackView.phase === 'discussionActive'
                  ? 'bars'
                  : playbackView.phase === 'lecturePaused' ||
                      playbackView.phase === 'discussionPaused'
                    ? 'play'
                    : playbackCompleted
                      ? 'restart'
                      : 'none'
              }
              isPaused={engineMode === 'paused'}
              showStopDiscussion={
                engineMode === 'live' ||
                (chatIsStreaming && (chatSessionType === 'qa' || chatSessionType === 'discussion'))
              }
              onStopDiscussion={handleStopDiscussion}
            />
          </div>
        )}
      </div>

      {/* Chat Area — visually hidden in mobile landscape but stays mounted for SSE logic */}
      {mobileChatDrawerOpen && !isMobileLandscape && (
        <button
          type="button"
          aria-label="关闭聊天遮罩"
          className="fixed inset-0 z-[45] bg-black/40 md:hidden"
          onClick={() => setMobileChatDrawerOpen(false)}
        />
      )}
      <ChatArea
        ref={chatAreaRef}
        width={chatDisplayWidth}
        onWidthChange={setChatAreaWidth}
        collapsed={isMobileLandscape ? true : chatDisplayCollapsed}
        onCollapseChange={(collapsed) => {
          if (isMobileLandscape) return; // No chat in landscape
          if (isMobile) {
            setMobileChatDrawerOpen(!collapsed);
          } else {
            setChatAreaCollapsed(collapsed);
          }
        }}
        className={cn(
          'md:absolute md:inset-y-3 md:right-3 md:z-40 md:h-[calc(100%-1.5rem)] md:rounded-3xl md:border md:border-white/70 md:shadow-[0_24px_80px_rgba(15,23,42,0.14)] md:dark:border-white/10 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:z-50 max-md:h-[min(82dvh,calc(100dvh-env(safe-area-inset-top)-0.75rem))] max-md:max-w-full max-md:rounded-t-[22px] max-md:border-t max-md:border-white/70 max-md:pb-safe max-md:shadow-[0_-24px_70px_rgba(15,23,42,0.25)]',
          isMobileLandscape && 'hidden',
        )}
        activeBubbleId={activeBubbleId}
        onActiveBubble={(id) => setActiveBubbleId(id)}
        currentSceneId={currentSceneId}
        onLiveSpeech={(text, agentId) => {
          // Capture epoch at call time — discard if scene has changed since
          const epoch = sceneEpochRef.current;
          // Use queueMicrotask to let any pending scene-switch reset settle first
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return; // stale — scene changed
            setLiveSpeech(text);
            if (agentId !== undefined) {
              setSpeakingAgentId(agentId);
            }
            if (text !== null || agentId) {
              setChatIsStreaming(true);
              setChatSessionType(chatAreaRef.current?.getActiveSessionType?.() ?? null);
              setIsTopicPending(false);
            } else if (text === null && agentId === null) {
              setChatIsStreaming(false);
              // Don't clear chatSessionType here — it's needed by the stop
              // button when director cues user (cue_user → done → liveSpeech null).
              // It gets properly cleared in doSessionCleanup and scene change.
            }
          });
        }}
        onSpeechProgress={(ratio) => {
          const epoch = sceneEpochRef.current;
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return;
            setSpeechProgress(ratio);
          });
        }}
        onThinking={(state) => {
          const epoch = sceneEpochRef.current;
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return;
            setThinkingState(state);
          });
        }}
        onCueUser={(_fromAgentId, _prompt) => {
          setIsCueUser(true);
        }}
        onLiveSessionError={handleLiveSessionError}
        onStopSession={doSessionCleanup}
        onSegmentSealed={discussionTTS.handleSegmentSealed}
        shouldHoldAfterReveal={discussionTTS.shouldHold}
        tutorToolState={tutorToolState}
      />

      {/* Scene switch confirmation dialog */}
      <AlertDialog
        open={!!pendingSceneId}
        onOpenChange={(open) => {
          if (!open) cancelSceneSwitch();
        }}
      >
        <AlertDialogContent
          container={isPresenting ? stageRef.current : undefined}
          className="max-w-sm rounded-2xl p-0 overflow-hidden border-0 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)]"
        >
          <VisuallyHidden.Root>
            <AlertDialogTitle>{t('stage.confirmSwitchTitle')}</AlertDialogTitle>
          </VisuallyHidden.Root>
          {/* Top accent bar */}
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" />

          <div className="px-6 pt-5 pb-2 flex flex-col items-center text-center">
            {/* Icon */}
            <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4 ring-1 ring-amber-200/50 dark:ring-amber-700/30">
              <AlertTriangle className="w-6 h-6 text-amber-500 dark:text-amber-400" />
            </div>
            {/* Title */}
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1.5">
              {t('stage.confirmSwitchTitle')}
            </h3>
            {/* Description */}
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('stage.confirmSwitchMessage')}
            </p>
          </div>

          <AlertDialogFooter className="px-6 pb-5 pt-3 flex-row gap-3">
            <AlertDialogCancel onClick={cancelSceneSwitch} className="flex-1 rounded-xl">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSceneSwitch}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-md shadow-amber-200/50 dark:shadow-amber-900/30"
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MobileSlideNav({
  currentSceneIndex,
  scenesCount,
  onPrevSlide,
  onNextSlide,
}: {
  readonly currentSceneIndex: number;
  readonly scenesCount: number;
  readonly onPrevSlide: () => void;
  readonly onNextSlide: () => void;
}) {
  if (scenesCount <= 1) return null;

  const canGoPrev = currentSceneIndex > 0;
  const canGoNext = currentSceneIndex < scenesCount - 1;
  const buttonClass =
    'pointer-events-auto absolute top-1/2 -translate-y-1/2 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-xl transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-25';

  return (
    <>
      <button
        type="button"
        aria-label="上一页"
        disabled={!canGoPrev}
        onClick={(event) => {
          event.stopPropagation();
          onPrevSlide();
        }}
        className={cn(buttonClass, 'left-[calc(env(safe-area-inset-left,0px)+14px)]')}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="下一页"
        disabled={!canGoNext}
        onClick={(event) => {
          event.stopPropagation();
          onNextSlide();
        }}
        className={cn(buttonClass, 'right-[calc(env(safe-area-inset-right,0px)+68px)]')}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </>
  );
}

/** Mobile full-width subtitle bar — rendered above the Roundtable */
function MobileSubtitleBar({
  text,
  role,
  participants,
  speakingAgentId,
  isLoading,
  buttonState,
  isPaused,
  onBubbleClick,
}: {
  readonly text: string;
  readonly role: 'teacher' | 'user' | 'agent' | null;
  readonly participants: Participant[];
  readonly speakingAgentId: string | null;
  readonly isLoading?: boolean;
  readonly buttonState?: 'play' | 'bars' | 'restart' | 'none';
  readonly isPaused?: boolean;
  readonly onBubbleClick?: () => void;
}) {
  const teacherParticipant = participants.find((p) => p.role === 'teacher');
  const speakingStudent = speakingAgentId
    ? participants.find(
        (p) => p.id === speakingAgentId && p.role !== 'teacher' && p.role !== 'user',
      )
    : null;

  const name =
    role === 'teacher'
      ? teacherParticipant?.name || ''
      : role === 'agent'
        ? speakingStudent?.name || ''
        : role === 'user'
          ? ''
          : '';

  const avatar =
    role === 'teacher'
      ? teacherParticipant?.avatar || DEFAULT_TEACHER_AVATAR
      : role === 'agent'
        ? speakingStudent?.avatar || DEFAULT_STUDENT_AVATAR
        : '';

  if ((!text && !isLoading) || !role) return null;

  const playbackButtonLabel =
    buttonState === 'play' || buttonState === 'restart' || isPaused
      ? 'Play classroom playback'
      : 'Pause classroom playback';

  return (
    <div className="shrink-0 px-3 pb-1">
      <div
        className={cn(
          'w-full rounded-xl border backdrop-blur-xl shadow-lg overflow-hidden transition-transform',
          role === 'user'
            ? 'bg-violet-900/70 border-violet-700/40'
            : role === 'agent'
              ? 'bg-blue-900/70 border-blue-700/40'
              : 'bg-gray-900/75 border-gray-600/40',
        )}
      >
        <div className="flex items-center gap-2.5 px-3 py-2">
          {avatar && (
            <div
              className={cn(
                'w-7 h-7 rounded-full overflow-hidden border-2 shrink-0',
                role === 'user'
                  ? 'border-violet-400/60'
                  : role === 'agent'
                    ? 'border-blue-400/60'
                    : 'border-purple-400/60',
              )}
            >
              <AvatarDisplay src={avatar} alt={name} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {name && (
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wider',
                  role === 'user'
                    ? 'text-violet-300'
                    : role === 'agent'
                      ? 'text-blue-300'
                      : 'text-purple-300',
                )}
              >
                {name}
              </span>
            )}
            {isLoading ? (
              <div className="flex gap-1 items-center py-0.5">
                {[0, 0.2, 0.4].map((delay) => (
                  <motion.div
                    key={delay}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay }}
                    className="w-1.5 h-1.5 rounded-full bg-purple-400"
                  />
                ))}
              </div>
            ) : (
              <p className="text-[13px] leading-snug text-gray-100 line-clamp-2 break-words">
                {text}
              </p>
            )}
          </div>

          {buttonState && buttonState !== 'none' && role !== 'user' && (
            <button
              type="button"
              aria-label={playbackButtonLabel}
              onClick={(e) => {
                e.stopPropagation();
                onBubbleClick?.();
              }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors shrink-0"
            >
              {buttonState === 'play' || buttonState === 'restart' ? (
                <Play className="w-4 h-4 text-white ml-0.5" />
              ) : isPaused ? (
                <Play className="w-4 h-4 text-amber-400 ml-0.5" />
              ) : (
                <Pause className="w-4 h-4 text-white" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile landscape right-side participation dock.
 *
 * Mirrors the recording (Mic) and typing (MessageSquare) controls that exist
 * in the desktop Roundtable. Renders as a floating pill on the right edge of
 * the screen, stacked above the bottom subtitle bar.
 */
function MobileLandscapeDock({
  onMessageSend,
  onInputActivate,
  onPlayPause,
  playbackButtonState,
  isPaused,
  showStopDiscussion,
  onStopDiscussion,
}: {
  readonly onMessageSend: (message: string) => Promise<void> | void;
  readonly onInputActivate?: () => void;
  readonly onPlayPause?: () => void;
  readonly playbackButtonState?: 'play' | 'bars' | 'restart' | 'none';
  readonly isPaused?: boolean;
  readonly showStopDiscussion?: boolean;
  readonly onStopDiscussion?: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const asrEnabled = useSettingsStore((s) => s.asrEnabled);

  const [isInputOpen, setIsInputOpen] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isSendCooldown, setIsSendCooldown] = useState(false);
  const isSendCooldownRef = useRef(false);
  const voicePressActiveRef = useRef(false);
  const showPlaybackButton = !!onPlayPause && playbackButtonState && playbackButtonState !== 'none';
  const shouldShowPlayIcon =
    playbackButtonState === 'play' || playbackButtonState === 'restart' || isPaused;

  const { isRecording, isProcessing, startRecording, stopRecording, cancelRecording } =
    useAudioRecorder({
      onTranscription: (text) => {
        if (!text.trim()) {
          toast.info(t('roundtable.noSpeechDetected'));
          setIsVoiceOpen(false);
          return;
        }
        if (isSendCooldownRef.current) {
          setIsVoiceOpen(false);
          return;
        }
        void onMessageSend(text);
        setIsSendCooldown(true);
        isSendCooldownRef.current = true;
        setIsVoiceOpen(false);
      },
      onError: (error) => {
        toast.error(error);
        setIsVoiceOpen(false);
      },
    });

  const handleSendMessage = useCallback(() => {
    if (!inputValue.trim() || isSendCooldown) return;
    void onMessageSend(inputValue);
    setIsSendCooldown(true);
    isSendCooldownRef.current = true;
    setInputValue('');
    setIsInputOpen(false);
  }, [inputValue, isSendCooldown, onMessageSend]);

  const handleStopDiscussion = useCallback(() => {
    if (isRecording || isProcessing) {
      cancelRecording();
    }
    setIsInputOpen(false);
    setIsVoiceOpen(false);
    setIsSendCooldown(false);
    isSendCooldownRef.current = false;
    void onStopDiscussion?.();
  }, [cancelRecording, isProcessing, isRecording, onStopDiscussion]);

  const handleToggleInput = useCallback(() => {
    if (isSendCooldown) return;
    if (!isInputOpen) {
      onInputActivate?.();
    }
    setIsInputOpen(!isInputOpen);
    if (isVoiceOpen || isProcessing) {
      cancelRecording();
      setIsVoiceOpen(false);
    }
  }, [cancelRecording, isInputOpen, isProcessing, isSendCooldown, isVoiceOpen, onInputActivate]);

  const handleVoicePressStart = useCallback(() => {
    if (voicePressActiveRef.current || isSendCooldown || isProcessing) return;
    voicePressActiveRef.current = true;
    onInputActivate?.();
    setIsVoiceOpen(true);
    setIsInputOpen(false);
    void startRecording();
  }, [isProcessing, isSendCooldown, onInputActivate, startRecording]);

  const handleVoicePressEnd = useCallback(() => {
    if (!voicePressActiveRef.current) return;
    voicePressActiveRef.current = false;
    stopRecording();
  }, [stopRecording]);

  const handleVoicePressCancel = useCallback(() => {
    if (!voicePressActiveRef.current) return;
    voicePressActiveRef.current = false;
    cancelRecording();
    setIsVoiceOpen(false);
  }, [
    cancelRecording,
  ]);

  const handleVoiceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        handleVoicePressStart();
      }
    },
    [handleVoicePressStart],
  );

  const handleVoiceKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleVoicePressEnd();
      }
    },
    [handleVoicePressEnd],
  );

  // Clear cooldown when agent starts speaking
  useEffect(() => {
    if (!isSendCooldown) return;
    const timer = setTimeout(() => {
      setIsSendCooldown(false);
      isSendCooldownRef.current = false;
    }, 1500);
    return () => clearTimeout(timer);
  }, [isSendCooldown]);

  // Voice wave bars (lighter weight than Roundtable's full waveform)
  const VOICE_BARS = [16, 22, 14, 20, 24, 17, 21, 15] as const;

  return (
    <div
      className="absolute z-40 flex flex-col items-end gap-2 pointer-events-none"
      style={{
        right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      }}
      aria-label={t('roundtable.dock') || '参与课堂'}
    >
      {/* Text input panel — opens above the dock */}
      <AnimatePresence>
        {isInputOpen && (
          <motion.div
            key="ml-input"
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="w-[min(320px,calc(100vw-2.5rem))] pointer-events-auto"
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl border bg-white/85 dark:bg-black/70 backdrop-blur-xl border-gray-200/60 dark:border-white/10 shadow-lg">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={t('roundtable.inputPlaceholder')}
                autoFocus
                rows={1}
                className="flex-1 resize-none bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-gray-900 dark:text-white placeholder:text-gray-400 max-h-[80px] leading-[28px]"
                style={{ fieldSizing: 'content' } as Record<string, string>}
              />
              <button
                onClick={handleSendMessage}
                disabled={isSendCooldown}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all',
                  isSendCooldown
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-700',
                )}
                aria-label={t('roundtable.send') || '发送'}
              >
                {isSendCooldown ? (
                  <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-white" />
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice recording pill */}
      <AnimatePresence>
        {isVoiceOpen && (
          <motion.div
            key="ml-voice"
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="pointer-events-auto"
          >
            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-white/85 dark:bg-black/70 backdrop-blur-xl border border-purple-200/60 dark:border-purple-700/40 shadow-lg">
              <div className="flex items-end gap-0.5 h-5">
                {VOICE_BARS.map((peak, i) => (
                  <motion.div
                    key={i}
                    animate={{ height: [3, peak, 3], opacity: [0.4, 1, 0.4] }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.5 + (i % 3) * 0.1,
                      delay: i * 0.05,
                      ease: 'easeInOut',
                    }}
                    className="w-[2px] rounded-full bg-gradient-to-t from-purple-500 to-indigo-500"
                  />
                ))}
              </div>
              <span className="text-[10px] font-semibold tracking-wider text-purple-600 dark:text-purple-300 uppercase">
                {isProcessing ? t('roundtable.processing') : t('roundtable.listening')}
              </span>
              <div
                className="relative w-9 h-9 rounded-full bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center shadow-md border border-white/20"
                aria-hidden="true"
              >
                <Mic className="w-4 h-4 text-white" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The dock pill with the two participation buttons */}
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-black/60 backdrop-blur-xl border border-gray-200/60 dark:border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-2 py-2">
        {showPlaybackButton && (
          <button
            type="button"
            aria-label={shouldShowPlayIcon ? '继续讲解' : '暂停讲解'}
            onClick={onPlayPause}
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95',
              shouldShowPlayIcon
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-white/10',
            )}
          >
            {shouldShowPlayIcon ? (
              <Play className="w-4 h-4 ml-0.5" />
            ) : (
              <Pause className="w-4 h-4" />
            )}
          </button>
        )}

        {showStopDiscussion && (
          <button
            type="button"
            aria-label={t('roundtable.stopDiscussion')}
            onClick={handleStopDiscussion}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 bg-red-500/12 text-red-600 dark:text-red-300 hover:bg-red-500/20 dark:hover:bg-red-500/25"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        )}

        {isSendCooldown ? (
          <div className="flex items-center justify-center w-9 h-9">
            <div className="flex items-center gap-[3px]">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ y: [0, -3, 0], opacity: [0.35, 0.9, 0.35] }}
                  transition={{
                    repeat: Infinity,
                    duration: 0.9,
                    delay: i * 0.12,
                    ease: 'easeInOut',
                  }}
                  className="w-[3px] h-[3px] rounded-full bg-purple-400"
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Mic (recording) button */}
            <button
              type="button"
              aria-label={
                asrEnabled ? '按住说话，松开结束' : t('roundtable.voiceInputDisabled')
              }
              onPointerDown={(event) => {
                if (!asrEnabled) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                handleVoicePressStart();
              }}
              onPointerUp={(event) => {
                event.preventDefault();
                handleVoicePressEnd();
              }}
              onPointerCancel={handleVoicePressCancel}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={handleVoiceKeyDown}
              onKeyUp={handleVoiceKeyUp}
              disabled={!asrEnabled || isProcessing}
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95',
                !asrEnabled
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : isVoiceOpen
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-white/10',
              )}
            >
              {asrEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            {/* MessageSquare (typing) button */}
            <button
              type="button"
              aria-label={t('roundtable.textInput')}
              onClick={handleToggleInput}
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95',
                isInputOpen
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-white/10',
              )}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Tap-outside backdrop to dismiss input/voice */}
      {(isInputOpen || isVoiceOpen) && (
        <button
          type="button"
          aria-label="关闭输入面板"
          className="fixed inset-0 z-[-1] cursor-default"
          onClick={() => {
            setIsInputOpen(false);
            setIsVoiceOpen(false);
            if (isRecording || isProcessing) cancelRecording();
          }}
        />
      )}
    </div>
  );
}
