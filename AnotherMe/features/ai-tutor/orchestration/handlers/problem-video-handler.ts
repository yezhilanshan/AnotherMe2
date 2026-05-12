/**
 * Problem Video Generation Capability Handler
 *
 * Wraps the problem video generation (upload + job creation) as a CapabilityRuntime handler.
 * The actual video rendering happens asynchronously in the AnotherMe2 gateway;
 * this handler only creates the job and returns the job metadata.
 */

import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { LearningContext } from '@/lib/types/learning-context';
import type { ProblemVideoModelConfig } from '@/features/problem-video/shared/model-config';

export interface ProblemVideoCapabilityPayload {
  imageObjectKey: string;
  problemText?: string;
  model?: string;
  visionModel?: string;
  ocrModel?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
  visionApiKey?: string;
  visionBaseUrl?: string;
  visionProviderType?: string;
  visionRequiresApiKey?: boolean;
  ocrApiKey?: string;
  ocrBaseUrl?: string;
  ocrProviderType?: string;
  ocrRequiresApiKey?: boolean;
  modelConfig?: ProblemVideoModelConfig;
  userId?: string;
  learnerSessionId?: string;
  learnerLookbackDays?: number;
  learningContext?: LearningContext;
}

export interface ProblemVideoCapabilityResult {
  success: boolean;
  jobId: string;
  status: string;
  step: string;
  progress: number;
  pollUrl: string;
  pollIntervalMs: number;
}

export const problemVideoGenerateHandler: CapabilityHandler<ProblemVideoCapabilityPayload> = {
  capabilityId: 'problem_video_generate',

  validatePayload(payload: unknown): ProblemVideoCapabilityPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.imageObjectKey || typeof p.imageObjectKey !== 'string') {
      throw new Error('Invalid payload: imageObjectKey required');
    }
    return {
      imageObjectKey: p.imageObjectKey,
      problemText: typeof p.problemText === 'string' ? p.problemText : undefined,
      model: typeof p.model === 'string' ? p.model : undefined,
      visionModel: typeof p.visionModel === 'string' ? p.visionModel : undefined,
      ocrModel: typeof p.ocrModel === 'string' ? p.ocrModel : undefined,
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : undefined,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
      providerType: typeof p.providerType === 'string' ? p.providerType : undefined,
      requiresApiKey: typeof p.requiresApiKey === 'boolean' ? p.requiresApiKey : undefined,
      visionApiKey: typeof p.visionApiKey === 'string' ? p.visionApiKey : undefined,
      visionBaseUrl: typeof p.visionBaseUrl === 'string' ? p.visionBaseUrl : undefined,
      visionProviderType: typeof p.visionProviderType === 'string' ? p.visionProviderType : undefined,
      visionRequiresApiKey: typeof p.visionRequiresApiKey === 'boolean' ? p.visionRequiresApiKey : undefined,
      ocrApiKey: typeof p.ocrApiKey === 'string' ? p.ocrApiKey : undefined,
      ocrBaseUrl: typeof p.ocrBaseUrl === 'string' ? p.ocrBaseUrl : undefined,
      ocrProviderType: typeof p.ocrProviderType === 'string' ? p.ocrProviderType : undefined,
      ocrRequiresApiKey: typeof p.ocrRequiresApiKey === 'boolean' ? p.ocrRequiresApiKey : undefined,
      modelConfig: p.modelConfig as ProblemVideoModelConfig | undefined,
      userId: typeof p.userId === 'string' ? p.userId : undefined,
      learnerSessionId: typeof p.learnerSessionId === 'string' ? p.learnerSessionId : undefined,
      learnerLookbackDays: typeof p.learnerLookbackDays === 'number' ? p.learnerLookbackDays : undefined,
      learningContext: p.learningContext as LearningContext | undefined,
    };
  },

  async *execute(request: CapabilityRequest<ProblemVideoCapabilityPayload>): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const {
      imageObjectKey,
      problemText,
      model,
      visionModel,
      ocrModel,
      apiKey,
      baseUrl,
      providerType,
      requiresApiKey,
      visionApiKey,
      visionBaseUrl,
      visionProviderType,
      visionRequiresApiKey,
      ocrApiKey,
      ocrBaseUrl,
      ocrProviderType,
      ocrRequiresApiKey,
      modelConfig,
      userId,
      learnerSessionId,
      learnerLookbackDays,
      learningContext,
    } = request.payload;

    // Stage: pre_process
    const preStart = Date.now();
    try {
      yield {
        stage: 'pre_process',
        success: true,
        output: { hasProblemText: !!problemText?.trim(), hasLearningContext: !!learningContext },
        durationMs: Date.now() - preStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      yield {
        stage: 'pre_process',
        success: false,
        error: { code: 'PRE_PROCESS_FAILED', message: err.message },
        durationMs: Date.now() - preStart,
        completedAt: Date.now(),
      };
      throw err;
    }

    // Stage: agent_invoke (create the job via gateway)
    const invokeStart = Date.now();
    let jobResult: { job_id: string; status: string; step: string; progress: number };

    try {
      const { createAnotherMe2ProblemVideoJob } = await import('@/lib/server/anotherme2-gateway');
      jobResult = await createAnotherMe2ProblemVideoJob({
        imageObjectKey,
        ...(problemText ? { problemText } : {}),
        ...(model ? { model } : {}),
        ...(visionModel ? { visionModel } : {}),
        ...(ocrModel ? { ocrModel } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(providerType ? { providerType } : {}),
        ...(typeof requiresApiKey === 'boolean' ? { requiresApiKey } : {}),
        ...(visionApiKey ? { visionApiKey } : {}),
        ...(visionBaseUrl ? { visionBaseUrl } : {}),
        ...(visionProviderType ? { visionProviderType } : {}),
        ...(typeof visionRequiresApiKey === 'boolean' ? { visionRequiresApiKey } : {}),
        ...(ocrApiKey ? { ocrApiKey } : {}),
        ...(ocrBaseUrl ? { ocrBaseUrl } : {}),
        ...(ocrProviderType ? { ocrProviderType } : {}),
        ...(typeof ocrRequiresApiKey === 'boolean' ? { ocrRequiresApiKey } : {}),
        ...(modelConfig ? { modelConfig } : {}),
        ...(userId ? { userId } : {}),
        ...(learnerSessionId ? { learnerSessionId } : {}),
        ...(typeof learnerLookbackDays === 'number' ? { learnerLookbackDays } : {}),
        ...(learningContext ? { learningContext } : {}),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      yield {
        stage: 'agent_invoke',
        success: false,
        error: { code: 'AGENT_INVOKE_FAILED', message: err.message },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };
      throw err;
    }

    yield {
      stage: 'agent_invoke',
      success: true,
      output: { jobId: jobResult.job_id, status: jobResult.status, step: jobResult.step },
      durationMs: Date.now() - invokeStart,
      completedAt: Date.now(),
    };

    // Stage: post_process (extract knowledge points for ClassroomBook)
    const postStart = Date.now();
    const knowledgePointIds =
      learningContext?.knowledgeTracing?.teachingDecisions
        ?.map((d: { knowledgePointId: string }) => d.knowledgePointId)
        .filter(Boolean) || [];

    yield {
      stage: 'post_process',
      success: true,
      output: { knowledgePointIds },
      durationMs: Date.now() - postStart,
      completedAt: Date.now(),
    };

    // Stage: persist
    const persistStart = Date.now();
    yield {
      stage: 'persist',
      success: true,
      output: { jobId: jobResult.job_id, wasAborted: false },
      durationMs: Date.now() - persistStart,
      completedAt: Date.now(),
    };

    // Stage: complete
    const completeStage: CapabilityStageResult = {
      stage: 'complete',
      success: true,
      output: {
        jobId: jobResult.job_id,
        status: jobResult.status,
        step: jobResult.step,
        progress: jobResult.progress,
      },
      durationMs: Date.now() - startTime,
      completedAt: Date.now(),
    };
    yield completeStage;

    return {
      success: true,
      output: {
        jobId: jobResult.job_id,
        status: jobResult.status,
        step: jobResult.step,
        progress: jobResult.progress,
      },
      stages: [],
      traceEvents: [],
      totalDurationMs: Date.now() - startTime,
    };
  },
};
