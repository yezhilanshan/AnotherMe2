import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import type { ApiErrorCode } from '@/lib/server/api-response';
import {
  isAnotherMe2GatewayError,
  uploadProblemImageToAnotherMe2,
} from '@/lib/server/anotherme2-gateway';
import { buildLearningContext } from '@/lib/server/learning-context';
import { createDefaultRuntime } from '@/lib/orchestration/capability-runtime';
import { globalStreamBus } from '@/lib/orchestration/stream-bus';
import { problemVideoGenerateHandler } from '@/lib/orchestration/handlers/problem-video-handler';
import {
  buildProblemVideoClassroomBook,
  saveClassroomBook,
} from '@/lib/server/classroom-book-service';
import { createLearningContext } from '@/lib/types/learning-context';
import type { ProblemVideoModelConfig } from '@/features/problem-video/shared/model-config';

const DEFAULT_POLL_INTERVAL_MS = 3000;

export class ProblemVideoRequestError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProblemVideoRequestError';
  }
}

type CreateProblemVideoJobInput = {
  image: File;
  problemText: string;
  model: string;
  visionModel: string;
  ocrModel: string;
  apiKey: string;
  baseUrl: string;
  providerType: string;
  requiresApiKeyValue: string;
  visionApiKey: string;
  visionBaseUrl: string;
  visionProviderType: string;
  visionRequiresApiKeyValue: string;
  ocrApiKey: string;
  ocrBaseUrl: string;
  ocrProviderType: string;
  ocrRequiresApiKeyValue: string;
  modelConfig?: ProblemVideoModelConfig;
  learnerSessionId: string;
  learnerLookbackDays?: number;
  userId?: string;
  signal: AbortSignal;
};

type CreateProblemVideoJobResult = {
  jobId: string;
  status: string;
  step: string;
  progress: number;
  pollUrl: string;
  pollIntervalMs: number;
};

async function resolveAuthenticatedUserId(request: NextRequest): Promise<string | undefined> {
  try {
    const { getAuthenticatedUserFromRequest } = await import('@/lib/auth/session');
    const user = await getAuthenticatedUserFromRequest(request);
    return user?.id?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function parseOptionalModelConfig(modelConfigRaw: string): ProblemVideoModelConfig | undefined {
  if (!modelConfigRaw) return undefined;

  try {
    const parsed = JSON.parse(modelConfigRaw) as ProblemVideoModelConfig;
    if (!parsed || typeof parsed !== 'object' || !parsed.text || !parsed.vision || !parsed.ocr) {
      throw new ProblemVideoRequestError('INVALID_REQUEST', 400, 'Invalid modelConfig payload');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ProblemVideoRequestError) throw error;
    throw new ProblemVideoRequestError('INVALID_REQUEST', 400, 'Invalid modelConfig JSON');
  }
}

export function parseCreateProblemVideoFormData(
  formData: FormData,
  userId: string | undefined,
  signal: AbortSignal,
): CreateProblemVideoJobInput {
  const image = formData.get('image');
  if (!(image instanceof File) || image.size <= 0) {
    throw new ProblemVideoRequestError('MISSING_REQUIRED_FIELD', 400, 'Problem image is required');
  }

  const learnerLookbackRaw = Number(formData.get('learnerLookbackDays'));
  const learnerLookbackDays = Number.isFinite(learnerLookbackRaw)
    ? Math.max(14, Math.min(365, Math.trunc(learnerLookbackRaw)))
    : undefined;

  return {
    image,
    problemText: String(formData.get('problemText') || '').trim(),
    model: String(formData.get('model') || '').trim(),
    visionModel: String(formData.get('visionModel') || '').trim(),
    ocrModel: String(formData.get('ocrModel') || '').trim(),
    apiKey: String(formData.get('apiKey') || '').trim(),
    baseUrl: String(formData.get('baseUrl') || '').trim(),
    providerType: String(formData.get('providerType') || '').trim(),
    requiresApiKeyValue: String(formData.get('requiresApiKey') || '').trim(),
    visionApiKey: String(formData.get('visionApiKey') || '').trim(),
    visionBaseUrl: String(formData.get('visionBaseUrl') || '').trim(),
    visionProviderType: String(formData.get('visionProviderType') || '').trim(),
    visionRequiresApiKeyValue: String(formData.get('visionRequiresApiKey') || '').trim(),
    ocrApiKey: String(formData.get('ocrApiKey') || '').trim(),
    ocrBaseUrl: String(formData.get('ocrBaseUrl') || '').trim(),
    ocrProviderType: String(formData.get('ocrProviderType') || '').trim(),
    ocrRequiresApiKeyValue: String(formData.get('ocrRequiresApiKey') || '').trim(),
    modelConfig: parseOptionalModelConfig(String(formData.get('modelConfig') || '').trim()),
    learnerSessionId: String(formData.get('learnerSessionId') || '').trim(),
    learnerLookbackDays,
    userId,
    signal,
  };
}

export async function createProblemVideoJob(
  input: CreateProblemVideoJobInput,
): Promise<CreateProblemVideoJobResult> {
  const upload = await uploadProblemImageToAnotherMe2(input.image);
  const learningContext = input.userId
    ? await buildLearningContext({
        userId: input.userId,
        source: 'problem_video',
        topic: input.problemText || input.image.name,
        language: 'zh-CN',
        aiSessionId: input.learnerSessionId || null,
        extra: {
          imageObjectKey: upload.object_key,
          imageName: input.image.name,
          imageSize: input.image.size,
        },
        enabledTools: [
          { id: 'problem_video_generation', enabled: true, config: {} },
          { id: 'learner_memory', enabled: true, config: {} },
        ],
        lookbackDays: input.learnerLookbackDays,
      })
    : undefined;

  const runtime = createDefaultRuntime({
    buildContext: async () =>
      learningContext ||
      createLearningContext(input.userId || 'anonymous', {
        metadata: {
          source: 'problem_video',
          topic: null,
          language: 'zh-CN',
          grade: null,
          extra: {},
        },
      }),
    checkGuard: async () => ({ passed: true }),
    emitTrace: async (event) => {
      globalStreamBus.publish(event);
    },
    persistResult: async (result) => {
      const output = result.output as Record<string, unknown> | undefined;
      const jobId = typeof output?.jobId === 'string' ? output.jobId : '';
      const knowledgePointIds =
        (result.stages.find((s) => s.stage === 'post_process')?.output?.knowledgePointIds as
          | string[]
          | undefined) || [];

      if (jobId && input.userId) {
        try {
          const book = buildProblemVideoClassroomBook({
            userId: input.userId,
            jobId,
            problemText: input.problemText,
            imageObjectKey: upload.object_key,
            sourceCapability: 'problem_video_generate',
            knowledgePointIds,
          });
          await saveClassroomBook(book);
        } catch {
          // ClassroomBook persistence is best-effort and must not block video generation.
        }
      }
    },
  });
  runtime.registerHandler(problemVideoGenerateHandler);

  const requestId = `pv-${input.userId || 'anon'}-${Date.now()}`;
  const capabilityRequest = {
    requestId,
    capabilityId: 'problem_video_generate' as const,
    userId: input.userId || 'anonymous',
    payload: {
      imageObjectKey: upload.object_key,
      ...(input.problemText ? { problemText: input.problemText } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.visionModel ? { visionModel: input.visionModel } : {}),
      ...(input.ocrModel ? { ocrModel: input.ocrModel } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.providerType ? { providerType: input.providerType } : {}),
      ...(input.requiresApiKeyValue
        ? { requiresApiKey: input.requiresApiKeyValue === 'true' }
        : {}),
      ...(input.visionApiKey ? { visionApiKey: input.visionApiKey } : {}),
      ...(input.visionBaseUrl ? { visionBaseUrl: input.visionBaseUrl } : {}),
      ...(input.visionProviderType ? { visionProviderType: input.visionProviderType } : {}),
      ...(input.visionRequiresApiKeyValue
        ? { visionRequiresApiKey: input.visionRequiresApiKeyValue === 'true' }
        : {}),
      ...(input.ocrApiKey ? { ocrApiKey: input.ocrApiKey } : {}),
      ...(input.ocrBaseUrl ? { ocrBaseUrl: input.ocrBaseUrl } : {}),
      ...(input.ocrProviderType ? { ocrProviderType: input.ocrProviderType } : {}),
      ...(input.ocrRequiresApiKeyValue
        ? { ocrRequiresApiKey: input.ocrRequiresApiKeyValue === 'true' }
        : {}),
      ...(input.modelConfig ? { modelConfig: input.modelConfig } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.learnerSessionId ? { learnerSessionId: input.learnerSessionId } : {}),
      ...(typeof input.learnerLookbackDays === 'number'
        ? { learnerLookbackDays: input.learnerLookbackDays }
        : {}),
      ...(learningContext ? { learningContext } : {}),
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
    throw new ProblemVideoRequestError('INTERNAL_ERROR', 500, 'Failed to create problem video job');
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

export async function handleCreateProblemVideoPost(request: NextRequest) {
  try {
    const userId = await resolveAuthenticatedUserId(request);
    const input = parseCreateProblemVideoFormData(await request.formData(), userId, request.signal);
    const result = await createProblemVideoJob(input);
    return apiSuccess(result, 202);
  } catch (error) {
    if (error instanceof ProblemVideoRequestError) {
      return apiError(error.code, error.status, error.message);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to create AnotherMe2 problem video job',
    );
  }
}
