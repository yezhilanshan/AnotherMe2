/**
 * Server-side storage cleanup — TTL-based garbage collection for
 * file-system-stored data that accumulates over time.
 *
 * Cleanup targets:
 *   - Classroom jobs (data/classroom-jobs/) — completed/failed jobs older than TTL
 *   - Classroom books (.workbuddy/classroom-books/) — books not accessed within TTL
 *   - Stage sync data (data/stages/) — stages not updated within TTL
 *   - RAG vector store (data/rag/) — manual trigger only (destructive)
 *
 * Usage:
 *   import { runCleanup, cleanupClassroomJobs } from '@/lib/server/storage-cleanup';
 *   const result = await runCleanup();           // full cleanup
 *   const jobs = await cleanupClassroomJobs(7);  // clean jobs older than 7 days
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getRuntimeDataDir } from './runtime-data-dir';

const log = (msg: string) => console.log(`[storage-cleanup] ${msg}`);

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_CLASSROOM_JOB_TTL_DAYS = 7;
const DEFAULT_CLASSROOM_BOOK_TTL_DAYS = 90;
const DEFAULT_STAGE_SYNC_TTL_DAYS = 30;
const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── Helpers ────────────────────────────────────────────────────────

async function fileAge(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

async function removeFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeDirRecursive(dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir: string, ext?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((name) => !ext || name.endsWith(ext))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

// ── Classroom Jobs Cleanup ─────────────────────────────────────────

export interface CleanupResult {
  target: string;
  scanned: number;
  removed: number;
  errors: number;
}

/**
 * Clean up completed/failed classroom job files older than `ttlDays`.
 * Also removes stale "running" jobs that haven't been updated in 30 minutes.
 */
export async function cleanupClassroomJobs(
  ttlDays: number = DEFAULT_CLASSROOM_JOB_TTL_DAYS,
): Promise<CleanupResult> {
  const jobsDir = getRuntimeDataDir('classroom-jobs');
  const files = await listFiles(jobsDir, '.json');
  const cutoff = ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let errors = 0;

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const job = JSON.parse(content);
      const age = await fileAge(filePath);
      if (age === null) { errors++; continue; }

      let shouldRemove = false;

      // Remove completed/failed jobs older than TTL
      if ((job.status === 'completed' || job.status === 'failed') && age > cutoff) {
        shouldRemove = true;
      }

      // Remove stale running jobs (no update in 30 min)
      if (job.status === 'running') {
        const updatedAt = new Date(job.updatedAt || 0).getTime();
        if (Date.now() - updatedAt > STALE_JOB_TIMEOUT_MS && age > cutoff) {
          shouldRemove = true;
        }
      }

      if (shouldRemove) {
        if (await removeFile(filePath)) removed++;
        else errors++;
      }
    } catch {
      errors++;
    }
  }

  const result: CleanupResult = { target: 'classroom-jobs', scanned: files.length, removed, errors };
  log(`classroom-jobs: scanned=${files.length}, removed=${removed}, errors=${errors}`);
  return result;
}

// ── Classroom Books Cleanup ────────────────────────────────────────

/**
 * Clean up classroom books not accessed within `ttlDays`.
 * Checks file mtime (last read/write).
 */
export async function cleanupClassroomBooks(
  ttlDays: number = DEFAULT_CLASSROOM_BOOK_TTL_DAYS,
): Promise<CleanupResult> {
  const booksBase = getRuntimeDataDir('classroom-books');
  // Also check .workbuddy path
  const altBase = path.join(process.cwd(), '.workbuddy', 'classroom-books');

  let scanned = 0;
  let removed = 0;
  let errors = 0;
  const cutoff = ttlDays * 24 * 60 * 60 * 1000;

  for (const baseDir of [booksBase, altBase]) {
    const userDirs = await listDirs(baseDir);
    for (const userDir of userDirs) {
      const files = await listFiles(userDir, '.json');
      scanned += files.length;
      for (const filePath of files) {
        const age = await fileAge(filePath);
        if (age !== null && age > cutoff) {
          if (await removeFile(filePath)) removed++;
          else errors++;
        }
      }
      // Remove empty user directories
      try {
        const remaining = await fs.readdir(userDir);
        if (remaining.length === 0) await fs.rmdir(userDir);
      } catch { /* ignore */ }
    }
  }

  const result: CleanupResult = { target: 'classroom-books', scanned, removed, errors };
  log(`classroom-books: scanned=${scanned}, removed=${removed}, errors=${errors}`);
  return result;
}

// ── Stage Sync Cleanup ─────────────────────────────────────────────

/**
 * Clean up server-synced stage data not updated within `ttlDays`.
 * These are redundant copies of IndexedDB data; old ones can be pruned.
 */
export async function cleanupStageSync(
  ttlDays: number = DEFAULT_STAGE_SYNC_TTL_DAYS,
): Promise<CleanupResult> {
  const stagesDir = getRuntimeDataDir('stages');
  const files = await listFiles(stagesDir, '.json');
  const cutoff = ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let errors = 0;

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stage = JSON.parse(content);
      const updatedAt = stage.updatedAt || stage.createdAt || 0;
      if (Date.now() - updatedAt > cutoff) {
        if (await removeFile(filePath)) removed++;
        else errors++;
      }
    } catch {
      errors++;
    }
  }

  const result: CleanupResult = { target: 'stages', scanned: files.length, removed, errors };
  log(`stages: scanned=${files.length}, removed=${removed}, errors=${errors}`);
  return result;
}

// ── Full Cleanup ───────────────────────────────────────────────────

/**
 * Run all cleanup tasks. Returns results for each target.
 */
export async function runCleanup(options?: {
  jobTtlDays?: number;
  bookTtlDays?: number;
  stageTtlDays?: number;
}): Promise<CleanupResult[]> {
  log('Starting full cleanup...');
  const results = await Promise.all([
    cleanupClassroomJobs(options?.jobTtlDays),
    cleanupClassroomBooks(options?.bookTtlDays),
    cleanupStageSync(options?.stageTtlDays),
  ]);
  const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);
  log(`Cleanup complete. Total removed: ${totalRemoved}`);
  return results;
}
