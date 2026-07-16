/**
 * Server-side stage storage — persists course data to the file system.
 *
 * Data layout:
 *   data/stages/{stageId}.json        — stage metadata + scenes
 *
 * Follows the same atomic-write pattern as classroom-storage.ts.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getRuntimeDataDir } from './runtime-data-dir';

const STAGES_DIR = getRuntimeDataDir('stages');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

export interface PersistedChatData {
  id: string;
  stageId: string;
  type: string;
  title: string;
  status: string;
  messages: unknown[];
  config?: unknown;
  toolCalls?: unknown[];
  createdAt: number;
  updatedAt: number;
  sceneId?: string;
  lastActionIndex?: number;
}

export interface PersistedPlaybackData {
  sceneIndex: number;
  actionIndex: number;
  consumedDiscussions: string[];
  sceneId?: string;
  updatedAt: number;
}

export interface PersistedStageData {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  language?: string;
  style?: string;
  currentSceneId?: string;
  agentIds?: string[];
  scenes: PersistedSceneData[];
  chats?: PersistedChatData[];
  playbackState?: PersistedPlaybackData;
}

export interface PersistedSceneData {
  id: string;
  stageId: string;
  type: string;
  title: string;
  order: number;
  content: unknown;
  actions?: unknown[];
  whiteboard?: unknown[];
  createdAt: number;
  updatedAt: number;
}

export interface StageSummary {
  id: string;
  name: string;
  description?: string;
  updatedAt: number;
  scenesCount: number;
}

/**
 * Save stage data (upsert). Overwrites existing file.
 */
export async function saveStage(stageData: PersistedStageData): Promise<void> {
  await ensureDir(STAGES_DIR);
  const filePath = path.join(STAGES_DIR, `${stageData.id}.json`);
  await writeJsonFileAtomic(filePath, stageData);
}

/**
 * Load stage data by ID.
 */
export async function loadStage(stageId: string): Promise<PersistedStageData | null> {
  const filePath = path.join(STAGES_DIR, `${stageId}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PersistedStageData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Delete stage data by ID.
 */
export async function deleteStage(stageId: string): Promise<boolean> {
  const filePath = path.join(STAGES_DIR, `${stageId}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * List all stage summaries (lightweight, without full scene data).
 */
export async function listStageSummaries(limit = 100): Promise<StageSummary[]> {
  await ensureDir(STAGES_DIR);

  let files: string[];
  try {
    files = await fs.readdir(STAGES_DIR);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((name) => name.endsWith('.json'));
  const summaries: StageSummary[] = [];

  for (const fileName of jsonFiles.slice(0, limit)) {
    try {
      const filePath = path.join(STAGES_DIR, fileName);
      const content = await fs.readFile(filePath, 'utf-8');
      const item = JSON.parse(content) as Partial<PersistedStageData>;
      if (!item.id) continue;

      summaries.push({
        id: item.id,
        name: item.name || item.id,
        description: item.description,
        updatedAt: item.updatedAt || 0,
        scenesCount: Array.isArray(item.scenes) ? item.scenes.length : 0,
      });
    } catch {
      // Skip corrupted files
      continue;
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}
