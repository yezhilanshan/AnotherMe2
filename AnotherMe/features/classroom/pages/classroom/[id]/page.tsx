'use client';

import { Stage } from '@/features/classroom/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { REQUIRED_CLASSROOM_AGENT_IDS } from '@/lib/orchestration/registry/classroom-presets';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useIsMobileLandscape } from '@/hooks/use-landscape';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const classroomId = params?.id as string;

  const { loadFromStorage } = useStageStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMobileLandscape = useIsMobileLandscape();

  // Override viewport meta to prevent user scaling on mobile
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute('content');

    // Lock scaling for mobile classroom
    meta.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    );

    return () => {
      // Restore original viewport when leaving classroom
      if (original) {
        meta.setAttribute('content', original);
      }
    };
  }, []);

  const generationStartedRef = useRef(false);

  // Loading timeout — if loading takes too long (e.g. IndexedDB stuck on mobile), show error
  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => {
      if (loading) {
        setError('加载超时，请检查网络连接后重试。');
        setLoading(false);
      }
    }, 15000); // 15 seconds
    return () => clearTimeout(timeout);
  }, [loading]);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
  });

  const loadClassroom = useCallback(async () => {
    try {
      await loadFromStorage(classroomId);
      const hasLocalData = !!useStageStore.getState().stage;

      if (hasLocalData) {
        // IndexedDB has data. Check if server also has it — if not, sync up
        // so the classroom is accessible from other devices.
        fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`, { method: 'GET' })
          .then(async (res) => {
            if (res.status === 404) {
              // Server doesn't have this classroom — sync from local
              log.info('Classroom not on server, syncing from IndexedDB:', classroomId);
              const state = useStageStore.getState();
              await fetch('/api/classroom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: state.stage, scenes: state.scenes }),
              });
              log.info('Synced classroom to server:', classroomId);
            }
          })
          .catch((err) => log.warn('Server sync check failed:', err));
      } else {
        // No local data — try server-side storage
        log.info('No IndexedDB data, trying server-side storage for:', classroomId);
        try {
          const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.classroom) {
              const { stage, scenes } = json.classroom;
              useStageStore.getState().setStage(stage);
              useStageStore.setState({
                scenes,
                currentSceneId: scenes[0]?.id ?? null,
              });
              log.info('Loaded from server-side storage:', classroomId);

              // Hydrate server-generated agents into IndexedDB + registry
              if (stage.generatedAgentConfigs?.length) {
                const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
                const { useSettingsStore } = await import('@/lib/store/settings');
                const agentIds = await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
                useSettingsStore.getState().setSelectedAgentIds(agentIds);
                log.info('Hydrated server-generated agents:', agentIds);
              }
            }
          } else if (res.status === 404) {
            throw new Error('课堂数据不存在（可能未同步到服务器）。请回到课程列表重新进入。');
          }
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.message.includes('课堂数据不存在')) {
            throw fetchErr;
          }
          log.warn('Server-side storage fetch failed:', fetchErr);
        }
      }

      // If still no stage data after both attempts, throw
      if (!useStageStore.getState().stage) {
        throw new Error('无法加载课堂数据。请检查网络连接或回到课程列表重新进入。');
      }

      // Restore completed media generation tasks from IndexedDB
      await useMediaGenerationStore.getState().restoreFromDB(classroomId);
      // Restore agents for this stage
      const { loadGeneratedAgentsForStage, useAgentRegistry } =
        await import('@/lib/orchestration/registry/store');
      const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
      const { useSettingsStore } = await import('@/lib/store/settings');
      if (generatedAgentIds.length > 0) {
        // Auto mode — use generated agents from IndexedDB
        useSettingsStore.getState().setAgentMode('auto');
        useSettingsStore.getState().setSelectedAgentIds(generatedAgentIds);
      } else {
        // Preset mode — restore agent IDs saved in the stage at creation time.
        // Filter out any stale generated IDs that may have been persisted before
        // the bleed-fix, so they don't resolve against a leftover registry entry.
        const stage = useStageStore.getState().stage;
        const stageAgentIds = stage?.agentIds;
        const registry = useAgentRegistry.getState();
        const cleanIds = stageAgentIds?.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(
            cleanIds && cleanIds.length > 0 ? cleanIds : [...REQUIRED_CLASSROOM_AGENT_IDS],
          );
      }
    } catch (error) {
      log.error('Failed to load classroom:', error);
      setError(error instanceof Error ? error.message : 'Failed to load classroom');
    } finally {
      setLoading(false);
    }
  }, [classroomId, loadFromStorage]);

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    setLoading(true);
    setError(null);
    generationStartedRef.current = false;

    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    // Placeholder IDs (gen_img_1, gen_vid_1) are NOT globally unique across stages,
    // so stale tasks from a previous classroom would shadow the new one's.
    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Clear whiteboard history to prevent snapshots from a previous course leaking in.
    useWhiteboardHistoryStore.getState().clearHistory();

    loadClassroom();

    // Cancel ongoing generation when classroomId changes or component unmounts
    return () => {
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;

    const state = useStageStore.getState();
    const { outlines, scenes, stage } = state;

    // Check if there are pending outlines
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      // Load generation params from sessionStorage (stored by generation-preview before navigating)
      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      // Reconstruct imageMapping from IndexedDB using pdfImages storageIds
      const storageIds = (params.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      loadImageMapping(storageIds).then((imageMapping) => {
        generateRemaining({
          pdfImages: params.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            language: stage.language,
            style: stage.style,
          },
          agents: params.agents,
          userProfile: params.userProfile,
        });
      });
    } else if (outlines.length > 0 && stage) {
      // All scenes are generated, but some media may not have finished.
      // Resume media generation for any tasks not yet in IndexedDB.
      // generateMediaForOutlines skips already-completed tasks automatically.
      generationStartedRef.current = true;
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-mobile-screen flex flex-col overflow-hidden relative">
          {/* Mobile back button — hidden in landscape (native WebView handles back) */}
          {!isMobileLandscape && (
            <button
              type="button"
              onClick={() => router.back()}
              className="fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[100] min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm shadow-lg md:hidden active:bg-black/70 transition-colors"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-[#f6f4f0] dark:bg-gray-950">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-gray-400" />
                <p className="text-sm text-gray-500">正在加载课堂...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-[#f6f4f0] dark:bg-gray-950 px-6">
              <div className="text-center max-w-sm">
                <p className="text-red-600 dark:text-red-400 mb-4 text-sm">加载失败：{error}</p>
                <div className="flex gap-3 justify-center">
                  <button
                    type="button"
                    onClick={() => router.push('/classes')}
                    className="min-h-[44px] px-4 py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
                  >
                    返回课程列表
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setLoading(true);
                      loadClassroom();
                    }}
                    className="min-h-[44px] px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
                  >
                    重试
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <Stage onRetryOutline={retrySingleOutline} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
