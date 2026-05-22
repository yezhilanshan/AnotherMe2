import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { generateClassroom, type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import {
  markClassroomGenerationJobFailed,
  markClassroomGenerationJobRunning,
  markClassroomGenerationJobCanceled,
  markClassroomGenerationJobSucceeded,
  readClassroomGenerationJob,
  updateClassroomGenerationJobProgress,
} from '@/lib/server/classroom-job-store';
import { CLASSROOM_JOBS_DIR } from '@/lib/server/classroom-storage';
import {
  buildClassroomGenerationClassroomBook,
  saveClassroomBook,
} from '@/lib/server/classroom-book-service';

const log = createLogger('ClassroomJob');
const runningJobs = new Map<string, Promise<void>>();
const runningJobControllers = new Map<string, AbortController>();
const RUN_LOCK_STALE_MS = 35 * 60 * 1000;

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function runLockPath(jobId: string) {
  return path.join(CLASSROOM_JOBS_DIR, `${jobId}.run.lock`);
}

async function acquireRunLock(jobId: string): Promise<boolean> {
  await fs.mkdir(CLASSROOM_JOBS_DIR, { recursive: true });
  const lockPath = runLockPath(jobId);
  try {
    const fd = await fs.open(lockPath, 'wx');
    try {
      await fd.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf-8');
    } finally {
      await fd.close();
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;

    try {
      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs > RUN_LOCK_STALE_MS) {
        await fs.unlink(lockPath);
        const fd = await fs.open(lockPath, 'wx');
        try {
          await fd.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf-8');
        } finally {
          await fd.close();
        }
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

async function releaseRunLock(jobId: string): Promise<void> {
  try {
    await fs.unlink(runLockPath(jobId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Failed to release classroom run lock for ${jobId}:`, error);
    }
  }
}

export function runClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  baseUrl: string,
): Promise<void> {
  const existing = runningJobs.get(jobId);
  if (existing) {
    return existing;
  }

  const jobPromise = (async () => {
    const acquired = await acquireRunLock(jobId);
    if (!acquired) {
      log.info(`Skip classroom job ${jobId}: lock already held by another runner`);
      return;
    }
    try {
      const runningJob = await markClassroomGenerationJobRunning(jobId);
      if (runningJob.status === 'canceled') return;

      const controller = new AbortController();
      runningJobControllers.set(jobId, controller);

      const result = await generateClassroom(input, {
        baseUrl,
        signal: controller.signal,
        onProgress: async (progress) => {
          await updateClassroomGenerationJobProgress(jobId, progress);
        },
      });

      controller.signal.throwIfAborted();

      await markClassroomGenerationJobSucceeded(jobId, result);
      await persistSuccessfulClassroomBook(jobId, input, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbortError(error)) {
        log.info(`Classroom generation job ${jobId} canceled`);
        try {
          await markClassroomGenerationJobCanceled(jobId);
        } catch (markCanceledError) {
          log.error(`Failed to persist canceled status for job ${jobId}:`, markCanceledError);
        }
        return;
      }
      log.error(`Classroom generation job ${jobId} failed:`, error);
      try {
        await markClassroomGenerationJobFailed(jobId, message);
      } catch (markFailedError) {
        log.error(`Failed to persist failed status for job ${jobId}:`, markFailedError);
      }
    } finally {
      runningJobControllers.delete(jobId);
      await releaseRunLock(jobId);
      runningJobs.delete(jobId);
    }
  })();

  runningJobs.set(jobId, jobPromise);
  return jobPromise;
}

export async function cancelClassroomGenerationJob(jobId: string): Promise<boolean> {
  const controller = runningJobControllers.get(jobId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }

  const job = await readClassroomGenerationJob(jobId);
  if (!job) return false;
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
    return true;
  }

  await markClassroomGenerationJobCanceled(jobId);
  return true;
}

async function persistSuccessfulClassroomBook(
  jobId: string,
  input: GenerateClassroomInput,
  result: Awaited<ReturnType<typeof generateClassroom>>,
): Promise<void> {
  const userId = input.authUserId?.trim();
  if (!userId) return;

  try {
    const knowledgePointIds =
      input.learningContext?.knowledgeTracing?.teachingDecisions
        ?.map((decision: { knowledgePointId: string }) => decision.knowledgePointId)
        .filter(Boolean) || [];

    const book = buildClassroomGenerationClassroomBook({
      userId,
      jobId,
      requirement: input.requirement,
      sourceCapability: 'course_generate',
      knowledgePointIds,
      classroomId: result.id,
      url: result.url,
    });
    await saveClassroomBook(book);
  } catch (error) {
    log.warn(`Failed to persist ClassroomBook for classroom job ${jobId}:`, error);
  }
}
