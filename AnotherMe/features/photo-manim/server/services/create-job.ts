import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import type { ApiErrorCode } from '@/lib/server/api-response';
import {
  isAnotherMe2GatewayError,
  uploadProblemImageToAnotherMe2,
} from '@/lib/server/anotherme2-gateway';
import { createDefaultRuntime } from '@/lib/orchestration/capability-runtime';
import { globalStreamBus } from '@/lib/orchestration/stream-bus';
import { photoManimDirectHandler } from '@/features/ai-tutor/orchestration/handlers/photo-manim-direct-handler';

const DEFAULT_POLL_INTERVAL_MS = 3000;

export class PhotoManimRequestError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoManimRequestError';
  }
}

type CreatePhotoManimJobInput = {
  image: File;
  problemText: string;
  signal: AbortSignal;
};

type CreatePhotoManimJobResult = {
  jobId: string;
  status: string;
  step: string;
  progress: number;
  pollUrl: string;
  pollIntervalMs: number;
};

function parseCreatePhotoManimFormData(
  formData: FormData,
  signal: AbortSignal,
): CreatePhotoManimJobInput {
  const image = formData.get('image');
  if (!(image instanceof File) || image.size <= 0) {
    throw new PhotoManimRequestError('MISSING_REQUIRED_FIELD', 400, 'Problem image is required');
  }

  return {
    image,
    problemText: String(formData.get('problemText') || '').trim(),
    signal,
  };
}

export async function createPhotoManimJob(
  input: CreatePhotoManimJobInput,
): Promise<CreatePhotoManimJobResult> {
  const upload = await uploadProblemImageToAnotherMe2(input.image);

  const runtime = createDefaultRuntime({
    buildContext: async () => ({
      sessionId: 'photo-manim',
      userId: 'anonymous',
      preferences: {},
      language: 'zh-CN',
      subject: null,
      grade: null,
      metadata: {},
    }),
    checkGuard: async () => ({ passed: true }),
    emitTrace: async (event) => {
      globalStreamBus.publish(event);
    },
    persistResult: async () => {
      // no-op for photo-manim-direct
    },
  });
  runtime.registerHandler(photoManimDirectHandler);

  const requestId = `pm-${Date.now()}`;
  const capabilityRequest = {
    requestId,
    capabilityId: 'photo_manim_direct' as const,
    userId: 'mobile-user',
    payload: {
      imageObjectKey: upload.object_key,
      ...(input.problemText ? { problemText: input.problemText } : {}),
    },
    streaming: false,
    signal: input.signal,
  };

  let jobResult: { job_id: string; status: string; step: string; progress: number } | null = null;
  for await (const stageResult of runtime.run(capabilityRequest)) {
    if (stageResult.stage === 'agent_invoke' && stageResult.output?.jobId) {
      jobResult = {
        job_id: String(stageResult.output.jobId),
        status: String(stageResult.output.status || 'queued'),
        step: String(stageResult.output.step || 'queued'),
        progress: typeof stageResult.output.progress === 'number' ? stageResult.output.progress : 0,
      };
    }
  }

  if (!jobResult) {
    throw new PhotoManimRequestError('INTERNAL_ERROR', 500, 'Failed to create photo-manim job');
  }

  return {
    jobId: jobResult.job_id,
    status: jobResult.status,
    step: jobResult.step,
    progress: jobResult.progress,
    pollUrl: `/api/problem-video/${jobResult.job_id}`,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
}

export async function handleCreatePhotoManimPost(request: NextRequest) {
  try {
    const input = parseCreatePhotoManimFormData(await request.formData(), request.signal);
    const result = await createPhotoManimJob(input);
    return apiSuccess(result, 202);
  } catch (error) {
    if (error instanceof PhotoManimRequestError) {
      return apiError(error.code, error.status, error.message);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to create photo-manim job',
    );
  }
}
