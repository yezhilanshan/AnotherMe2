export interface ProblemVideoJobCreateResponse {
  success: boolean;
  jobId?: string;
  pollUrl?: string;
  pollIntervalMs?: number;
  error?: string;
}

export type ProblemVideoCreatedJob = ProblemVideoJobCreateResponse & {
  jobId: string;
};

export interface ProblemVideoJobResponse {
  success: boolean;
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  step?: string;
  progress?: number;
  errorCode?: string;
  errorMessage?: string | null;
  details?: string;
  result?: {
    videoUrl?: string;
    durationSec?: number;
    scriptStepsCount?: number;
    debugBundleUrl?: string | null;
  };
  error?: string;
}

async function readProblemVideoJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error('视频生成服务返回了无法解析的响应。');
  }
}

export async function createProblemVideoJob(
  formData: FormData,
  signal?: AbortSignal,
): Promise<ProblemVideoCreatedJob> {
  const response = await fetch('/api/problem-video', {
    method: 'POST',
    body: formData,
    signal,
  });
  const payload = await readProblemVideoJson<ProblemVideoJobCreateResponse>(response);
  if (!response.ok || !payload.success || !payload.jobId) {
    throw new Error(payload.error || '创建拍题讲解任务失败。');
  }
  return payload as ProblemVideoCreatedJob;
}

export async function fetchProblemVideoJobStatus(
  pollUrl: string,
  signal?: AbortSignal,
): Promise<ProblemVideoJobResponse> {
  const response = await fetch(pollUrl, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  const payload = await readProblemVideoJson<ProblemVideoJobResponse>(response);
  if (!response.ok || !payload.success) {
    throw new Error(
      payload.error ||
        payload.errorMessage ||
        payload.details ||
        '查询视频生成状态失败。',
    );
  }
  return payload;
}
