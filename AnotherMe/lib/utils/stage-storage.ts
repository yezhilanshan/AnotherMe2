/**
 * Stage Storage Manager
 *
 * Manages multiple stage data in IndexedDB
 * Each stage has its own storage key based on stageId
 */

import { Stage, Scene } from '../types/stage';
import { ChatSession } from '../types/chat';
import { db } from './database';
import { saveChatSessions, loadChatSessions, deleteChatSessions } from './chat-storage';
import {
  clearPlaybackState,
  loadPlaybackState,
  savePlaybackState,
  type PlaybackSnapshot,
} from './playback-storage';
import { createLogger } from '@/lib/logger';
import { migrateStage, migrateSceneContent } from './schema-migration';

const log = createLogger('StageStorage');

export interface StageStoreData {
  stage: Stage;
  scenes: Scene[];
  currentSceneId: string | null;
  chats: ChatSession[];
}

export interface StageListItem {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Save stage data to IndexedDB
 */
export async function saveStageData(stageId: string, data: StageStoreData): Promise<void> {
  try {
    const now = Date.now();

    // Save to stages table
    await db.stages.put({
      id: stageId,
      name: data.stage.name || 'Untitled Stage',
      description: data.stage.description,
      createdAt: data.stage.createdAt || now,
      updatedAt: now,
      language: data.stage.language,
      style: data.stage.style,
      currentSceneId: data.currentSceneId || undefined,
      agentIds: data.stage.agentIds,
    });

    // Delete old scenes first to avoid orphaned data
    await db.scenes.where('stageId').equals(stageId).delete();

    // Save new scenes
    if (data.scenes && data.scenes.length > 0) {
      await db.scenes.bulkPut(
        data.scenes.map((scene, index) => ({
          ...scene,
          stageId,
          order: scene.order ?? index,
          createdAt: scene.createdAt || now,
          updatedAt: scene.updatedAt || now,
        })),
      );
    }

    // Save chat sessions to independent table
    if (data.chats) {
      await saveChatSessions(stageId, data.chats);
    }

    log.info(`Saved stage: ${stageId}`);

    // Trigger debounced sync to server (best-effort)
    debouncedSyncToServer(stageId);
  } catch (error) {
    log.error('Failed to save stage:', error);
    throw error;
  }
}

/**
 * Load stage data from IndexedDB
 */
export async function loadStageData(stageId: string): Promise<StageStoreData | null> {
  try {
    // Load stage
    const rawStage = await db.stages.get(stageId);
    if (!rawStage) {
      log.info(`Stage not found: ${stageId}`);
      return null;
    }
    // Apply schema migrations for legacy data
    const stage = migrateStage(rawStage as Stage);

    // Load scenes
    const rawScenes = await db.scenes.where('stageId').equals(stageId).sortBy('order');
    // Apply schema migrations to scene content (slides)
    const scenes = rawScenes.map((s) => ({
      ...s,
      content: migrateSceneContent(s.content),
    }));

    // Load chat sessions from independent table
    const chats = await loadChatSessions(stageId);

    log.info(`Loaded stage: ${stageId}, scenes: ${scenes.length}, chats: ${chats.length}`);

    return {
      stage,
      scenes,
      currentSceneId:
        (rawStage as unknown as { currentSceneId?: string }).currentSceneId ||
        scenes[0]?.id ||
        null,
      chats,
    };
  } catch (error) {
    log.error('Failed to load stage:', error);
    return null;
  }
}

/**
 * Delete stage and all related data
 */
export async function deleteStageData(stageId: string): Promise<void> {
  try {
    // Delete stage
    await db.stages.delete(stageId);

    // Delete scenes
    await db.scenes.where('stageId').equals(stageId).delete();

    // Delete chat sessions and playback state
    await deleteChatSessions(stageId);
    await clearPlaybackState(stageId);

    log.info(`Deleted stage: ${stageId}`);

    // Sync deletion to server (best-effort)
    try {
      await fetch(`${STAGES_API}/${stageId}`, { method: 'DELETE' });
    } catch {
      // Best-effort
    }
  } catch (error) {
    log.error('Failed to delete stage:', error);
    throw error;
  }
}

/**
 * List all stages
 */
export async function listStages(): Promise<StageListItem[]> {
  try {
    const stages = await db.stages.orderBy('updatedAt').reverse().toArray();

    const stageList: StageListItem[] = await Promise.all(
      stages.map(async (stage) => {
        const sceneCount = await db.scenes.where('stageId').equals(stage.id).count();

        return {
          id: stage.id,
          name: stage.name,
          description: stage.description,
          sceneCount,
          createdAt: stage.createdAt,
          updatedAt: stage.updatedAt,
        };
      }),
    );

    return stageList;
  } catch (error) {
    log.error('Failed to list stages:', error);
    return [];
  }
}

/**
 * Get first slide scene's canvas data for each stage (for thumbnail preview).
 * Also resolves gen_img_* placeholders from mediaFiles so thumbnails show real images.
 * Returns the slide map and a revokeUrls() cleanup function to free object URLs.
 */
export async function getFirstSlideByStages(stageIds: string[]): Promise<{
  slides: Record<string, import('../types/slides').Slide>;
  revokeUrls: () => void;
}> {
  const result: Record<string, import('../types/slides').Slide> = {};
  const objectUrls: string[] = [];
  try {
    await Promise.all(
      stageIds.map(async (stageId) => {
        const scenes = await db.scenes.where('stageId').equals(stageId).sortBy('order');
        const firstSlide = scenes.find((s) => s.content?.type === 'slide');
        if (firstSlide && firstSlide.content.type === 'slide') {
          const slide = structuredClone(firstSlide.content.canvas);

          // Resolve gen_img_* placeholders from mediaFiles
          const placeholderEls = slide.elements.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (el: any) => el.type === 'image' && /^gen_(img|vid)_[\w-]+$/i.test(el.src as string),
          );
          if (placeholderEls.length > 0) {
            const mediaRecords = await db.mediaFiles.where('stageId').equals(stageId).toArray();
            const mediaMap = new Map(
              mediaRecords.map((r) => {
                // Key format: stageId:elementId → extract elementId
                const elementId = r.id.includes(':') ? r.id.split(':').slice(1).join(':') : r.id;
                return [elementId, r.blob] as const;
              }),
            );
            for (const el of placeholderEls as Array<{ src: string }>) {
              const blob = mediaMap.get(el.src);
              if (blob) {
                const url = URL.createObjectURL(blob);
                objectUrls.push(url);
                el.src = url;
              } else {
                // Clear unresolved placeholder so BaseImageElement won't subscribe
                // to the global media store (which may have stale data from another course)
                el.src = '';
              }
            }
          }

          result[stageId] = slide;
        }
      }),
    );
  } catch (error) {
    log.error('Failed to load thumbnails:', error);
  }
  return {
    slides: result,
    revokeUrls: () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    },
  };
}

/**
 * Rename a stage (updates only the name field in IndexedDB)
 */
export async function renameStage(stageId: string, newName: string): Promise<void> {
  try {
    await db.stages.update(stageId, { name: newName, updatedAt: Date.now() });
    log.info(`Renamed stage ${stageId} to "${newName}"`);

    // Sync rename to server (best-effort)
    debouncedSyncToServer(stageId);
  } catch (error) {
    log.error('Failed to rename stage:', error);
    throw error;
  }
}

/**
 * Check if stage exists
 */
export async function stageExists(stageId: string): Promise<boolean> {
  try {
    const stage = await db.stages.get(stageId);
    return !!stage;
  } catch (error) {
    log.error('Failed to check stage existence:', error);
    return false;
  }
}

// ==================== Server Sync ====================

const STAGES_API = '/api/stages';
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSyncIds = new Set<string>();

/**
 * Sync a single stage to the server (best-effort, non-blocking).
 * Now includes chat sessions and playback state for data safety.
 */
export async function syncStageToServer(stageId: string): Promise<void> {
  try {
    const data = await loadStageData(stageId);
    if (!data) return;

    // Load chat sessions and playback state for server sync
    const [chats, playbackState] = await Promise.all([
      loadChatSessions(stageId),
      loadPlaybackState(stageId),
    ]);

    const chatRecords =
      chats.length > 0
        ? chats.map((c) => ({
            id: c.id,
            stageId,
            type: c.type,
            title: c.title,
            status: c.status === 'active' ? ('interrupted' as const) : c.status,
            messages: c.messages.slice(-200),
            config: c.config,
            toolCalls: c.toolCalls,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            sceneId: c.sceneId,
            lastActionIndex: c.lastActionIndex,
          }))
        : undefined;

    const pbRecord = playbackState
      ? {
          sceneIndex: playbackState.sceneIndex,
          actionIndex: playbackState.actionIndex,
          consumedDiscussions: playbackState.consumedDiscussions,
          sceneId: playbackState.sceneId,
          updatedAt: Date.now(),
        }
      : undefined;

    const payload = {
      id: stageId,
      name: data.stage.name,
      description: data.stage.description,
      createdAt: data.stage.createdAt,
      updatedAt: Date.now(),
      language: data.stage.language,
      style: data.stage.style,
      currentSceneId: data.currentSceneId || undefined,
      agentIds: data.stage.agentIds,
      scenes: data.scenes.map((s) => ({
        id: s.id,
        stageId,
        type: s.type,
        title: s.title,
        order: s.order,
        content: s.content,
        actions: s.actions,
        whiteboards: s.whiteboards,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      chats: chatRecords,
      playbackState: pbRecord,
    };

    const res = await fetch(`${STAGES_API}/${stageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      log.warn(`Server sync failed for ${stageId}: ${res.status}`);
    }
  } catch {
    // Best-effort: sync failure should not affect local operations
  }
}

/**
 * Debounced batch sync — collects stage IDs and syncs them after a delay.
 */
export function debouncedSyncToServer(stageId: string): void {
  pendingSyncIds.add(stageId);
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const ids = [...pendingSyncIds];
    pendingSyncIds = new Set();
    syncTimer = null;
    for (const id of ids) {
      await syncStageToServer(id);
    }
  }, 2000);
}

/**
 * Pull stage data from server and merge into local IndexedDB.
 * Returns the merged data, or null if server has no data.
 * Now also restores chat sessions and playback state from server.
 */
export async function pullStageFromServer(stageId: string): Promise<StageStoreData | null> {
  try {
    const res = await fetch(`${STAGES_API}/${stageId}`);
    if (!res.ok) return null;

    const serverData = await res.json();
    if (!serverData?.id || !Array.isArray(serverData.scenes)) return null;

    // Check if server data is newer than local
    const localStage = await db.stages.get(stageId);
    const serverUpdated = serverData.updatedAt || 0;
    const localUpdated = localStage?.updatedAt || 0;

    if (serverUpdated <= localUpdated) {
      return null; // Local is newer or same, no merge needed
    }

    // Server is newer — save to local
    // Restore chat sessions from server if present
    let chats: ChatSession[] = [];
    if (Array.isArray(serverData.chats) && serverData.chats.length > 0) {
      chats = serverData.chats.map((c: Record<string, unknown>) => ({
        id: c.id as string,
        type: c.type as ChatSession['type'],
        title: c.title as string,
        status: c.status as ChatSession['status'],
        messages: (c.messages as ChatSession['messages']) || [],
        config: c.config as ChatSession['config'],
        toolCalls: (c.toolCalls as ChatSession['toolCalls']) || [],
        pendingToolCalls: [],
        createdAt: (c.createdAt as number) || Date.now(),
        updatedAt: (c.updatedAt as number) || Date.now(),
        sceneId: c.sceneId as string | undefined,
        lastActionIndex: c.lastActionIndex as number | undefined,
      }));
      await saveChatSessions(stageId, chats);
    }

    // Restore playback state from server if present
    if (serverData.playbackState && typeof serverData.playbackState.sceneIndex === 'number') {
      await savePlaybackState(stageId, {
        sceneIndex: serverData.playbackState.sceneIndex,
        actionIndex: serverData.playbackState.actionIndex || 0,
        consumedDiscussions: Array.isArray(serverData.playbackState.consumedDiscussions)
          ? serverData.playbackState.consumedDiscussions
          : [],
        sceneId: serverData.playbackState.sceneId,
      });
    }

    const stageStoreData: StageStoreData = {
      stage: {
        id: serverData.id,
        name: serverData.name,
        description: serverData.description,
        createdAt: serverData.createdAt,
        updatedAt: serverData.updatedAt || serverData.createdAt || Date.now(),
        language: serverData.language,
        style: serverData.style,
        agentIds: serverData.agentIds,
      },
      scenes: serverData.scenes,
      currentSceneId: serverData.currentSceneId || serverData.scenes[0]?.id || null,
      chats,
    };

    await saveStageData(stageId, stageStoreData);
    log.info(
      `Pulled stage from server: ${stageId} (with chats=${chats.length}, playback=${!!serverData.playbackState})`,
    );
    return stageStoreData;
  } catch {
    // Best-effort
    return null;
  }
}

/**
 * Merge local and remote stage lists. Returns deduplicated list
 * preferring the most recently updated version.
 */
export async function mergeStageList(): Promise<StageListItem[]> {
  const localStages = await listStages();

  try {
    const res = await fetch(STAGES_API);
    if (!res.ok) return localStages;

    const { stages: remoteStages } = await res.json();
    if (!Array.isArray(remoteStages)) return localStages;

    // Build a map: prefer the one with newer updatedAt
    const stageMap = new Map<string, StageListItem>();

    for (const s of localStages) {
      stageMap.set(s.id, s);
    }

    for (const s of remoteStages) {
      const existing = stageMap.get(s.id);
      if (!existing || (s.updatedAt || 0) > existing.updatedAt) {
        stageMap.set(s.id, {
          id: s.id,
          name: s.name,
          description: s.description,
          sceneCount: s.scenesCount || 0,
          createdAt: s.createdAt || s.updatedAt || 0,
          updatedAt: s.updatedAt || 0,
        });
      }
    }

    return [...stageMap.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return localStages;
  }
}
