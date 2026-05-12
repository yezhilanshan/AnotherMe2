import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInitialProblemVideoStageStatus,
  clearProblemVideoProgressSnapshot,
  isProblemVideoProjectRestart,
  markProblemVideoProjectStarted,
  readProblemVideoProgressSnapshot,
  saveProblemVideoProgressSnapshot,
} from '@/features/problem-video/client/progress-storage';
import {
  formatProblemVideoDuration,
  readRecentProblemVideos,
  saveRecentProblemVideos,
  type RecentVideoItem,
} from '@/features/problem-video/client/recent-videos';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  };
}

describe('problem video client storage helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T10:30:00+08:00'));
    vi.stubGlobal('window', {
      localStorage: createStorage(),
      sessionStorage: createStorage(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('formats generated video duration labels', () => {
    expect(formatProblemVideoDuration(42.5)).toBe('0:43');
    expect(formatProblemVideoDuration(65)).toBe('1:05');
    expect(formatProblemVideoDuration(0)).toBe('--');
  });

  it('keeps the bundled latest video and caps recent records', () => {
    const items: RecentVideoItem[] = Array.from({ length: 13 }, (_, index) => ({
      id: `video-${index}`,
      title: `讲解 ${index}`,
      date: '今天 10:00',
      duration: '1:00',
      status: 'succeeded',
      subject: '数学',
      createdAt: new Date().toISOString(),
    }));

    saveRecentProblemVideos(items);
    const stored = readRecentProblemVideos();

    expect(stored).toHaveLength(12);
    expect(stored[0].id).toBe('latest-local-problem-video');
    expect(stored[1].id).toBe('video-0');
  });

  it('normalizes persisted progress snapshots by known stage keys', () => {
    const stageKeys = ['uploading_image', 'queueing'];
    saveProblemVideoProgressSnapshot(
      {
        isGenerating: true,
        statusText: '任务已创建',
        backendStepText: '排队等待',
        overallProgress: 12,
        stageStatusMap: { uploading_image: 'completed', unknown: 'failed' },
        activeJob: {
          jobId: 'job-1',
          pollUrl: '/api/problem-video/job-1',
          pollIntervalMs: 3000,
          title: '拍题讲解',
        },
        updatedAt: new Date().toISOString(),
      },
      stageKeys,
    );

    const snapshot = readProblemVideoProgressSnapshot(stageKeys);

    expect(snapshot?.stageStatusMap).toEqual({
      uploading_image: 'completed',
      queueing: 'pending',
    });
    expect(snapshot?.activeJob?.jobId).toBe('job-1');
  });

  it('clears project restart and stale progress state helpers predictably', () => {
    expect(isProblemVideoProjectRestart()).toBe(true);
    markProblemVideoProjectStarted();
    expect(isProblemVideoProjectRestart()).toBe(false);

    expect(buildInitialProblemVideoStageStatus(['a', 'b'])).toEqual({ a: 'pending', b: 'pending' });
    clearProblemVideoProgressSnapshot();
    expect(readProblemVideoProgressSnapshot(['a'])).toBeNull();
  });
});
