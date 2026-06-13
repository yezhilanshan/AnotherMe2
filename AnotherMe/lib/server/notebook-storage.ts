/**
 * Server-side notebook snapshot storage.
 *
 * This is a JSON backup target for the client IndexedDB notebook. It is not a
 * conflict-resolution service; the client uploads complete snapshots and can
 * restore from this file when local IndexedDB is empty.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  NotebookBookRecord,
  NotebookNoteRecord,
  NotebookSettingsRecord,
  NotebookTrashRecord,
} from '@/lib/utils/database';
import { getRuntimeDataDir } from './runtime-data-dir';

const NOTEBOOK_DIR = getRuntimeDataDir('notebooks');
const NOTEBOOK_FILE = path.join(NOTEBOOK_DIR, 'default.json');

export interface PersistedNotebookSnapshot {
  version: 1;
  updatedAt: number;
  notes: NotebookNoteRecord[];
  trash: NotebookTrashRecord[];
  books: NotebookBookRecord[];
  settings: NotebookSettingsRecord | null;
}

export function createEmptyNotebookSnapshot(): PersistedNotebookSnapshot {
  return {
    version: 1,
    updatedAt: 0,
    notes: [],
    trash: [],
    books: [],
    settings: null,
  };
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeNotebookSnapshot(value: unknown): PersistedNotebookSnapshot {
  if (!value || typeof value !== 'object') {
    return createEmptyNotebookSnapshot();
  }

  const raw = value as Partial<PersistedNotebookSnapshot>;
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    notes: asArray<NotebookNoteRecord>(raw.notes),
    trash: asArray<NotebookTrashRecord>(raw.trash),
    books: asArray<NotebookBookRecord>(raw.books),
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : null,
  };
}

export async function loadNotebookSnapshot(): Promise<PersistedNotebookSnapshot> {
  try {
    const content = await fs.readFile(NOTEBOOK_FILE, 'utf-8');
    return normalizeNotebookSnapshot(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyNotebookSnapshot();
    }
    throw error;
  }
}

export async function saveNotebookSnapshot(
  snapshot: PersistedNotebookSnapshot,
): Promise<PersistedNotebookSnapshot> {
  const next = normalizeNotebookSnapshot({
    ...snapshot,
    updatedAt: snapshot.updatedAt || Date.now(),
  });
  await writeJsonFileAtomic(NOTEBOOK_FILE, next);
  return next;
}
