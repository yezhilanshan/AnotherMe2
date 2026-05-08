import { useSettingsStore } from '@/lib/store/settings';
import { PROVIDERS } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/types/provider';

function hasUserConfig(
  providerConfig: { apiKey?: string; baseUrl?: string; isServerConfigured?: boolean } | undefined,
) {
  return Boolean(providerConfig?.apiKey?.trim() || providerConfig?.baseUrl?.trim() || providerConfig?.isServerConfigured);
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

function resolveProviderForRole(
  providerId: ProviderId | undefined,
  fallbackProviderId: ProviderId,
  providersConfig: ReturnType<typeof useSettingsStore.getState>['providersConfig'],
): ProviderId {
  const requestedProviderId = (providerId || fallbackProviderId) as ProviderId;
  const requestedConfig = providersConfig[requestedProviderId] || PROVIDERS[requestedProviderId];
  if (requestedConfig && hasUserConfig(requestedConfig)) {
    return requestedProviderId;
  }
  return fallbackProviderId;
}

function stripProviderPrefix(modelId: string) {
  const value = modelId.trim();
  if (!value.includes(':')) return value;
  const [, model] = value.split(':', 2);
  return model?.trim() || value;
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

  const visionModel = params.models.find((model) => model.capabilities?.vision)?.id;
  return visionModel || params.fallbackModelId;
}

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const {
    providerId,
    modelId,
    visionProviderId,
    visionModelId,
    ocrProviderId,
    ocrModelId,
    providersConfig,
  } = useSettingsStore.getState();
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
  const safeVisionProviderId = resolveProviderForRole(visionProviderId, safeProviderId, providersConfig);
  const visionProviderConfig = providersConfig[safeVisionProviderId] || PROVIDERS[safeVisionProviderId];
  const safeOcrProviderId = resolveProviderForRole(ocrProviderId, safeVisionProviderId, providersConfig);
  const ocrProviderConfig = providersConfig[safeOcrProviderId] || PROVIDERS[safeOcrProviderId];

  const visionModels = visionProviderConfig?.models || PROVIDERS[safeVisionProviderId]?.models || [];
  const ocrModels = ocrProviderConfig?.models || PROVIDERS[safeOcrProviderId]?.models || [];
  const safeVisionModelId = resolveTaskModel({
    configuredModelId: visionModelId,
    providerId: safeVisionProviderId,
    baseUrl: visionProviderConfig?.baseUrl || visionProviderConfig?.defaultBaseUrl,
    models: visionModels,
    fallbackModelId: safeModelId,
    kind: 'vision',
  });
  const safeOcrModelId = resolveTaskModel({
    configuredModelId: ocrModelId,
    providerId: safeOcrProviderId,
    baseUrl: ocrProviderConfig?.baseUrl || ocrProviderConfig?.defaultBaseUrl,
    models: ocrModels,
    fallbackModelId: safeVisionModelId || safeModelId,
    kind: 'ocr',
  });
  const modelString = safeModelId ? `${safeProviderId}:${safeModelId}` : '';
  const visionModelString = safeVisionModelId ? `${safeVisionProviderId}:${safeVisionModelId}` : '';
  const ocrModelString = safeOcrModelId ? `${safeOcrProviderId}:${safeOcrModelId}` : '';

  return {
    providerId: safeProviderId,
    modelId: safeModelId,
    visionProviderId: safeVisionProviderId,
    visionModelId: safeVisionModelId,
    ocrProviderId: safeOcrProviderId,
    ocrModelId: safeOcrModelId,
    modelString,
    visionModelString,
    ocrModelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
    visionApiKey: visionProviderConfig?.apiKey || '',
    visionBaseUrl: visionProviderConfig?.baseUrl || '',
    visionProviderType: visionProviderConfig?.type,
    visionRequiresApiKey: visionProviderConfig?.requiresApiKey,
    visionIsServerConfigured: visionProviderConfig?.isServerConfigured,
    ocrApiKey: ocrProviderConfig?.apiKey || '',
    ocrBaseUrl: ocrProviderConfig?.baseUrl || '',
    ocrProviderType: ocrProviderConfig?.type,
    ocrRequiresApiKey: ocrProviderConfig?.requiresApiKey,
    ocrIsServerConfigured: ocrProviderConfig?.isServerConfigured,
  };
}
