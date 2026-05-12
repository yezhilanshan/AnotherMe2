export type StageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ActiveJobMeta {
  jobId: string;
  pollUrl: string;
  pollIntervalMs: number;
  title: string;
}

export interface PersistedProgressSnapshot {
  version: number;
  isGenerating: boolean;
  statusText: string;
  backendStepText: string;
  overallProgress: number;
  stageStatusMap: Record<string, StageStatus>;
  activeJob: ActiveJobMeta | null;
  updatedAt: string;
}

const PROJECT_START_KEY = 'anotherme:dashboard:project-start-flag';
const PROGRESS_STORAGE_KEY = 'anotherme:dashboard:problem-video-progress:v1';
const PROGRESS_SNAPSHOT_VERSION = 1;
const PROGRESS_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function buildInitialProblemVideoStageStatus(stageKeys: string[]): Record<string, StageStatus> {
  return stageKeys.reduce<Record<string, StageStatus>>((acc, key) => {
    acc[key] = 'pending';
    return acc;
  }, {});
}

export function normalizeProblemVideoStageStatusMap(
  map: Record<string, StageStatus> | null | undefined,
  stageKeys: string[],
): Record<string, StageStatus> {
  const base = buildInitialProblemVideoStageStatus(stageKeys);
  if (!map) return base;
  stageKeys.forEach((key) => {
    const value = map[key];
    if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
      base[key] = value;
    }
  });
  return base;
}

export function isProblemVideoProjectRestart() {
  return typeof window !== 'undefined' && !window.sessionStorage.getItem(PROJECT_START_KEY);
}

export function markProblemVideoProjectStarted() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PROJECT_START_KEY, 'true');
}

export function clearProblemVideoProgressSnapshot() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PROGRESS_STORAGE_KEY);
}

export function readProblemVideoProgressSnapshot(stageKeys: string[]): PersistedProgressSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProgressSnapshot;
    if (!parsed || parsed.version !== PROGRESS_SNAPSHOT_VERSION) return null;
    const updatedAtMs = Date.parse(String(parsed.updatedAt || ''));
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > PROGRESS_SNAPSHOT_MAX_AGE_MS) {
      clearProblemVideoProgressSnapshot();
      return null;
    }

    return {
      version: PROGRESS_SNAPSHOT_VERSION,
      isGenerating: Boolean(parsed.isGenerating),
      statusText: String(parsed.statusText || ''),
      backendStepText: String(parsed.backendStepText || ''),
      overallProgress: Number(parsed.overallProgress || 0),
      stageStatusMap: normalizeProblemVideoStageStatusMap(parsed.stageStatusMap, stageKeys),
      activeJob: parsed.activeJob || null,
      updatedAt: String(parsed.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

export function saveProblemVideoProgressSnapshot(
  snapshot: Omit<PersistedProgressSnapshot, 'version'>,
  stageKeys: string[],
) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    PROGRESS_STORAGE_KEY,
    JSON.stringify({
      ...snapshot,
      version: PROGRESS_SNAPSHOT_VERSION,
      stageStatusMap: normalizeProblemVideoStageStatusMap(snapshot.stageStatusMap, stageKeys),
    }),
  );
}
