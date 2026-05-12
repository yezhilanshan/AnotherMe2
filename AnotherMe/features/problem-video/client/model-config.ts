import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { ProblemVideoModelConfig } from '@/features/problem-video/shared/model-config';

export function getProblemVideoModelConfig(): ProblemVideoModelConfig {
  const config = getCurrentModelConfig();

  return {
    text: {
      providerId: config.providerId,
      model: config.modelString,
      apiKey: config.apiKey || undefined,
      baseUrl: config.baseUrl || undefined,
      providerType: config.providerType,
      requiresApiKey: config.requiresApiKey,
      isServerConfigured: config.isServerConfigured,
    },
    vision: {
      providerId: config.visionProviderId,
      model: config.visionModelString,
      apiKey: config.visionApiKey || undefined,
      baseUrl: config.visionBaseUrl || undefined,
      providerType: config.visionProviderType,
      requiresApiKey: config.visionRequiresApiKey,
      isServerConfigured: config.visionIsServerConfigured,
    },
    ocr: {
      providerId: config.ocrProviderId,
      model: config.ocrModelString,
      apiKey: config.ocrApiKey || undefined,
      baseUrl: config.ocrBaseUrl || undefined,
      providerType: config.ocrProviderType,
      requiresApiKey: config.ocrRequiresApiKey,
      isServerConfigured: config.ocrIsServerConfigured,
    },
  };
}

export function appendProblemVideoModelConfig(
  formData: FormData,
  config: ProblemVideoModelConfig = getProblemVideoModelConfig(),
): void {
  formData.append('modelConfig', JSON.stringify(config));

  // Compatibility fields for existing API route tests and older server paths.
  if (config.text.model) formData.append('model', config.text.model);
  if (config.vision.model) formData.append('visionModel', config.vision.model);
  if (config.ocr.model) formData.append('ocrModel', config.ocr.model);
  if (config.text.apiKey) formData.append('apiKey', config.text.apiKey);
  if (config.text.baseUrl) formData.append('baseUrl', config.text.baseUrl);
  if (config.text.providerType) formData.append('providerType', config.text.providerType);
  formData.append('requiresApiKey', config.text.requiresApiKey ? 'true' : 'false');
  if (config.vision.apiKey) formData.append('visionApiKey', config.vision.apiKey);
  if (config.vision.baseUrl) formData.append('visionBaseUrl', config.vision.baseUrl);
  if (config.vision.providerType) formData.append('visionProviderType', config.vision.providerType);
  formData.append('visionRequiresApiKey', config.vision.requiresApiKey ? 'true' : 'false');
  if (config.ocr.apiKey) formData.append('ocrApiKey', config.ocr.apiKey);
  if (config.ocr.baseUrl) formData.append('ocrBaseUrl', config.ocr.baseUrl);
  if (config.ocr.providerType) formData.append('ocrProviderType', config.ocr.providerType);
  formData.append('ocrRequiresApiKey', config.ocr.requiresApiKey ? 'true' : 'false');
}
