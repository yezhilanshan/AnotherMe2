import { useSettingsStore } from '@/lib/store/settings';
import { PROVIDERS } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/types/provider';

function hasUserConfig(providerConfig: { apiKey?: string; baseUrl?: string } | undefined) {
  return Boolean(providerConfig?.apiKey?.trim() || providerConfig?.baseUrl?.trim());
}

function resolveProviderFromClientConfig(
  providerId: ProviderId,
  providersConfig: ReturnType<typeof useSettingsStore.getState>['providersConfig'],
): ProviderId {
  const currentProvider = providersConfig[providerId];
  if (hasUserConfig(currentProvider)) {
    return providerId;
  }

  const configuredProvider = (Object.keys(providersConfig) as ProviderId[]).find((id) =>
    hasUserConfig(providersConfig[id]),
  );

  return configuredProvider || providerId;
}

function stripProviderPrefix(modelId: string) {
  const value = modelId.trim();
  if (!value.includes(':')) return value;
  const [, model] = value.split(':', 2);
  return model?.trim() || value;
}

function isQwenLike(providerId: ProviderId, baseUrl?: string) {
  return providerId === 'qwen' || /dashscope|aliyun|aliyuncs/i.test(baseUrl || '');
}

function resolveTaskModel(params: {
  configuredModelId?: string;
  providerId: ProviderId;
  baseUrl?: string;
  models: Array<{ id: string; capabilities?: { vision?: boolean } }>;
  fallbackModelId: string;
  kind: 'vision' | 'ocr';
}) {
  const configuredModelId = stripProviderPrefix(params.configuredModelId || '');
  if (configuredModelId) return configuredModelId;

  if (isQwenLike(params.providerId, params.baseUrl)) {
    return params.kind === 'ocr' ? 'qwen-vl-ocr-latest' : 'qwen3-vl-plus';
  }

  const visionModel = params.models.find((model) => model.capabilities?.vision)?.id;
  return visionModel || params.fallbackModelId;
}

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, visionModelId, ocrModelId, providersConfig } = useSettingsStore.getState();
  const safeProviderId = resolveProviderFromClientConfig((providerId || 'openai') as ProviderId, providersConfig);
  const providerConfig = providersConfig[safeProviderId] || PROVIDERS[safeProviderId];
  const providerModelIds = new Set([
    ...(providerConfig?.models?.map((model) => model.id) || []),
    ...(providerConfig?.serverModels || []),
  ]);
  const selectedModelId =
    providerId === safeProviderId && modelId && providerModelIds.has(modelId)
      ? modelId
      : '';
  const safeModelId =
    selectedModelId ||
    providerConfig?.models?.[0]?.id ||
    providerConfig?.serverModels?.[0] ||
    PROVIDERS[safeProviderId]?.models?.[0]?.id ||
    '';
  const models = providerConfig?.models || PROVIDERS[safeProviderId]?.models || [];
  const safeVisionModelId = resolveTaskModel({
    configuredModelId: visionModelId,
    providerId: safeProviderId,
    baseUrl: providerConfig?.baseUrl || providerConfig?.defaultBaseUrl,
    models,
    fallbackModelId: safeModelId,
    kind: 'vision',
  });
  const safeOcrModelId = resolveTaskModel({
    configuredModelId: ocrModelId,
    providerId: safeProviderId,
    baseUrl: providerConfig?.baseUrl || providerConfig?.defaultBaseUrl,
    models,
    fallbackModelId: safeVisionModelId || safeModelId,
    kind: 'ocr',
  });
  const modelString = safeModelId ? `${safeProviderId}:${safeModelId}` : '';
  const visionModelString = safeVisionModelId ? `${safeProviderId}:${safeVisionModelId}` : '';
  const ocrModelString = safeOcrModelId ? `${safeProviderId}:${safeOcrModelId}` : '';

  return {
    providerId: safeProviderId,
    modelId: safeModelId,
    visionModelId: safeVisionModelId,
    ocrModelId: safeOcrModelId,
    modelString,
    visionModelString,
    ocrModelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
  };
}
