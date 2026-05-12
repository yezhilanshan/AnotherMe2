import type { LearningContext } from '@/lib/types/learning-context';
import { parseModelString, PROVIDERS } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/types/provider';
import { resolveApiKey, resolveBaseUrl } from '@/lib/server/provider-config';
import type {
  ProblemVideoModelConfig,
  ProblemVideoModelRoleConfig,
} from '@/features/problem-video/shared/model-config';
import { AnotherMe2GatewayError, DEFAULT_PROBLEM_VIDEO_USER_ID, gatewayFetch } from './core';
import type {
  AnotherMe2JobSummary,
  AnotherMe2ProblemVideoResult,
  AnotherMe2UploadResponse,
} from './types';

interface AnotherMe2JobResultResponse {
  job_id: string;
  status: string;
  result: AnotherMe2ProblemVideoResult;
}

interface ResolvedProblemVideoModelRole {
  provider_id: string;
  model: string;
  api_key?: string;
  base_url?: string;
  provider_type?: string;
  requires_api_key?: boolean;
}

function toLegacyRoleConfig(role: ResolvedProblemVideoModelRole) {
  return {
    provider_id: role.provider_id,
    model: role.model,
    ...(role.api_key ? { api_key: role.api_key } : {}),
    ...(role.base_url ? { base_url: role.base_url } : {}),
    ...(role.provider_type ? { provider_type: role.provider_type } : {}),
    ...(typeof role.requires_api_key === 'boolean'
      ? { requires_api_key: role.requires_api_key }
      : {}),
  };
}

function resolveProblemVideoRoleConfig(params: {
  label: string;
  role?: ProblemVideoModelRoleConfig;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}): ResolvedProblemVideoModelRole | undefined {
  const modelString = (params.role?.model || params.model || '').trim();
  const providerIdFromRole = params.role?.providerId?.trim();

  if (!modelString && !providerIdFromRole) {
    return undefined;
  }

  const parsed = parseModelString(modelString || `${providerIdFromRole}:`);
  const providerId = (providerIdFromRole || parsed.providerId) as ProviderId;
  const modelId = parsed.modelId.trim();
  const provider = PROVIDERS[providerId];
  const requiresApiKey =
    params.role?.requiresApiKey ?? params.requiresApiKey ?? provider?.requiresApiKey ?? true;
  const providerType = params.role?.providerType || params.providerType || provider?.type;
  const clientApiKey = params.role?.apiKey?.trim() || params.apiKey?.trim() || '';
  const clientBaseUrl = params.role?.baseUrl?.trim() || params.baseUrl?.trim() || '';
  const apiKey = resolveApiKey(providerId, clientApiKey);
  const baseUrl = resolveBaseUrl(providerId, clientBaseUrl) || provider?.defaultBaseUrl || '';

  if (!modelId) {
    throw new AnotherMe2GatewayError(`${params.label}缺少模型名称，请在设置页面选择模型。`, 400);
  }
  if (requiresApiKey && !apiKey) {
    throw new AnotherMe2GatewayError(
      `${params.label}缺少 API Key，请在设置页面配置，或在服务端配置该 provider。`,
      400,
    );
  }
  if (!baseUrl) {
    throw new AnotherMe2GatewayError(
      `${params.label}缺少 Base URL，请在设置页面或服务端配置。`,
      400,
    );
  }

  return {
    provider_id: providerId,
    model: modelString || `${providerId}:${modelId}`,
    ...(apiKey ? { api_key: apiKey } : {}),
    base_url: baseUrl,
    ...(providerType ? { provider_type: providerType } : {}),
    requires_api_key: requiresApiKey,
  };
}

function buildProblemVideoLlmConfig(params: {
  modelConfig?: ProblemVideoModelConfig;
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
}): Record<string, unknown> {
  const text = resolveProblemVideoRoleConfig({
    label: '文本模型',
    role: params.modelConfig?.text,
    model: params.model,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    providerType: params.providerType,
    requiresApiKey: params.requiresApiKey,
  });
  const vision = resolveProblemVideoRoleConfig({
    label: '视觉模型',
    role: params.modelConfig?.vision,
    model: params.visionModel,
    apiKey: params.visionApiKey,
    baseUrl: params.visionBaseUrl,
    providerType: params.visionProviderType,
    requiresApiKey: params.visionRequiresApiKey,
  });
  const ocr = resolveProblemVideoRoleConfig({
    label: 'OCR模型',
    role: params.modelConfig?.ocr,
    model: params.ocrModel,
    apiKey: params.ocrApiKey,
    baseUrl: params.ocrBaseUrl,
    providerType: params.ocrProviderType,
    requiresApiKey: params.ocrRequiresApiKey,
  });

  if (!text && !vision && !ocr) {
    return {};
  }
  if (!text || !vision || !ocr) {
    const missing = [
      !text ? '文本模型' : '',
      !vision ? '视觉模型' : '',
      !ocr ? 'OCR模型' : '',
    ].filter(Boolean);
    throw new AnotherMe2GatewayError(`模型配置不完整，缺少：${missing.join('、')}。`, 400);
  }

  return {
    roles: {
      text: toLegacyRoleConfig(text),
      vision: toLegacyRoleConfig(vision),
      ocr: toLegacyRoleConfig(ocr),
    },
    model: text.model,
    vision_model: vision.model,
    ocr_model: ocr.model,
    ...(text.api_key ? { api_key: text.api_key } : {}),
    ...(text.base_url ? { base_url: text.base_url } : {}),
    ...(text.provider_type ? { provider_type: text.provider_type } : {}),
    ...(typeof text.requires_api_key === 'boolean'
      ? { requires_api_key: text.requires_api_key }
      : {}),
    ...(vision.api_key ? { vision_api_key: vision.api_key } : {}),
    ...(vision.base_url ? { vision_base_url: vision.base_url } : {}),
    ...(vision.provider_type ? { vision_provider_type: vision.provider_type } : {}),
    ...(typeof vision.requires_api_key === 'boolean'
      ? { vision_requires_api_key: vision.requires_api_key }
      : {}),
    ...(ocr.api_key ? { ocr_api_key: ocr.api_key } : {}),
    ...(ocr.base_url ? { ocr_base_url: ocr.base_url } : {}),
    ...(ocr.provider_type ? { ocr_provider_type: ocr.provider_type } : {}),
    ...(typeof ocr.requires_api_key === 'boolean'
      ? { ocr_requires_api_key: ocr.requires_api_key }
      : {}),
  };
}

export async function uploadProblemImageToAnotherMe2(
  file: File,
): Promise<AnotherMe2UploadResponse> {
  const body = new FormData();
  body.append('file', file, file.name);
  return gatewayFetch<AnotherMe2UploadResponse>('/v1/uploads', {
    method: 'POST',
    body,
  });
}

export async function createAnotherMe2ProblemVideoJob(params: {
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
  outputProfile?: '1080p';
  userId?: string;
  learnerSessionId?: string;
  learnerLookbackDays?: number;
  learningContext?: LearningContext;
}): Promise<AnotherMe2JobSummary> {
  const payload: Record<string, unknown> = {
    image_object_key: params.imageObjectKey,
    output_profile: params.outputProfile || '1080p',
  };
  if (params.problemText?.trim()) {
    payload.problem_text = params.problemText.trim();
  }
  if (params.model?.trim()) {
    payload.model_name = params.model.trim();
  }
  const llmConfig = buildProblemVideoLlmConfig(params);
  if (Object.keys(llmConfig).length > 0) {
    payload.llm_config = llmConfig;
  }
  if (params.userId?.trim()) {
    payload.learner_user_id = params.userId.trim();
  }
  if (params.learnerSessionId?.trim()) {
    payload.learner_session_id = params.learnerSessionId.trim();
  }
  if (typeof params.learnerLookbackDays === 'number') {
    payload.learner_lookback_days = params.learnerLookbackDays;
  }
  if (params.learningContext) {
    payload.learning_context = params.learningContext;
  }

  return gatewayFetch<AnotherMe2JobSummary>('/v1/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_type: 'problem_video_generate',
      user_id: params.userId?.trim() || DEFAULT_PROBLEM_VIDEO_USER_ID,
      payload,
    }),
  });
}

export async function getAnotherMe2Job(jobId: string): Promise<AnotherMe2JobSummary> {
  return gatewayFetch<AnotherMe2JobSummary>(`/v1/jobs/${jobId}`);
}

export async function getAnotherMe2ProblemVideoResult(
  jobId: string,
): Promise<AnotherMe2ProblemVideoResult> {
  const payload = await gatewayFetch<AnotherMe2JobResultResponse>(`/v1/jobs/${jobId}/result`);
  return payload.result || {};
}
