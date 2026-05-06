import { useSettingsStore } from '@/lib/store/settings';
import { PROVIDERS } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/types/provider';

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, providersConfig } = useSettingsStore.getState();
  const safeProviderId = (providerId || 'openai') as ProviderId;
  const providerConfig = providersConfig[safeProviderId] || PROVIDERS[safeProviderId];
  const safeModelId =
    modelId ||
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
