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

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, providersConfig } = useSettingsStore.getState();
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
  const modelString = safeModelId ? `${safeProviderId}:${safeModelId}` : '';

  return {
    providerId: safeProviderId,
    modelId: safeModelId,
    modelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
  };
}
