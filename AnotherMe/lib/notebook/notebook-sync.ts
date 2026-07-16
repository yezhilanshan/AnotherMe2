import { db, type NotebookSettingsRecord } from '@/lib/utils/database';
import type {
  NotebookBookRecord,
  NotebookNoteRecord,
  NotebookTrashRecord,
} from '@/lib/utils/database';

const NOTEBOOK_API = '/api/notebook';
const SYNC_DELAY_MS = 1500;

export interface NotebookSnapshot {
  version: 1;
  updatedAt: number;
  notes: NotebookNoteRecord[];
  trash: NotebookTrashRecord[];
  books: NotebookBookRecord[];
  settings: NotebookSettingsRecord | null;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pullAttempted = false;

function canUseNetwork(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

async function getLocalNotebookUpdatedAt(): Promise<number> {
  const [notes, trash, books, settings] = await Promise.all([
    db.notebookNotes.toArray(),
    db.notebookTrash.toArray(),
    db.notebookBooks.toArray(),
    db.notebookSettings.get('default'),
  ]);

  return Math.max(
    0,
    ...notes.map((item) => item.updatedAt || 0),
    ...trash.map((item) => item.deletedAt || item.updatedAt || 0),
    ...books.map((item) => item.updatedAt || 0),
    settings ? 1 : 0,
  );
}

export async function buildNotebookSnapshot(): Promise<NotebookSnapshot> {
  const [notes, trash, books, settings] = await Promise.all([
    db.notebookNotes.toArray(),
    db.notebookTrash.toArray(),
    db.notebookBooks.toArray(),
    db.notebookSettings.get('default'),
  ]);

  return {
    version: 1,
    updatedAt: Date.now(),
    notes,
    trash,
    books,
    settings: settings || null,
  };
}

export async function syncNotebookToServer(): Promise<void> {
  if (!canUseNetwork()) return;
  const snapshot = await buildNotebookSnapshot();
  const response = await fetch(NOTEBOOK_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) {
    throw new Error(`Notebook sync failed: ${response.status}`);
  }
}

export function debouncedSyncNotebookToServer(): void {
  if (!canUseNetwork()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncNotebookToServer().catch(() => {
      // Notebook backup is best-effort and must not break local IndexedDB writes.
    });
  }, SYNC_DELAY_MS);
}

function hasSnapshotData(snapshot: NotebookSnapshot): boolean {
  return (
    snapshot.notes.length > 0 ||
    snapshot.trash.length > 0 ||
    snapshot.books.length > 0 ||
    Boolean(snapshot.settings)
  );
}

export async function pullNotebookFromServerIfLocalEmpty(): Promise<boolean> {
  if (!canUseNetwork() || pullAttempted) return false;
  pullAttempted = true;

  const localUpdatedAt = await getLocalNotebookUpdatedAt();
  if (localUpdatedAt > 0) return false;

  try {
    const response = await fetch(NOTEBOOK_API);
    if (!response.ok) return false;

    const snapshot = (await response.json()) as NotebookSnapshot;
    if (!hasSnapshotData(snapshot)) return false;

    await db.transaction(
      'rw',
      [db.notebookNotes, db.notebookTrash, db.notebookBooks, db.notebookSettings],
      async () => {
        await Promise.all([
          db.notebookNotes.clear(),
          db.notebookTrash.clear(),
          db.notebookBooks.clear(),
          db.notebookSettings.clear(),
        ]);
        if (snapshot.notes.length > 0) await db.notebookNotes.bulkPut(snapshot.notes);
        if (snapshot.trash.length > 0) await db.notebookTrash.bulkPut(snapshot.trash);
        if (snapshot.books.length > 0) await db.notebookBooks.bulkPut(snapshot.books);
        if (snapshot.settings) await db.notebookSettings.put(snapshot.settings);
      },
    );
    return true;
  } catch {
    return false;
  }
}
