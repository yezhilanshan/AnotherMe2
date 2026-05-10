import { useSettingsStore } from '@/lib/store/settings';
import { PROVIDERS } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/types/provider';

/**
 * Resolve effective credentials for a specific role (text / vision / OCR).
 *
 * Strict rule: a provider is only used when the user has configured BOTH
 * apiKey AND baseUrl.  If either is missing, the role is NOT configured.
 * No auto-detection, no env guessing, no fallback — the user must provide
 * complete configuration for each role they want to use.
 */
function resolveRoleCredentials(params: {
  roleProviderId: ProviderId;
  providersConfig: ReturnType<typeof useSettingsStore.getState>['providersConfig'];
}): { apiKey: string; baseUrl: string; configured: boolean } {
  const { roleProviderId, providersConfig } = params;
  const providerCfg = providersConfig[roleProviderId] || PROVIDERS[roleProviderId];

  const roleApiKey = providerCfg?.apiKey?.trim() || '';
  const roleBaseUrl =
    providerCfg?.baseUrl?.trim() || providerCfg?.defaultBaseUrl || '';

  // Both must be present to use this provider for this role
  if (roleApiKey && roleBaseUrl) {
    return { apiKey: roleApiKey, baseUrl: roleBaseUrl, configured: true };
  }

  // Incomplete config → NOT configured (no fallback)
  return { apiKey: '', baseUrl: '', configured: false };
}

function stripProviderPrefix(modelId: string) {
  const value = modelId.trim();
  if (!value.includes(':')) return value;
  const [, model] = value.split(':', 2);
  return model?.trim() || value;
}

function resolveTaskModel(params: {
  configuredModelId?: string;
  models: Array<{ id: string; capabilities?: { vision?: boolean } }>;
  fallbackModelId: string;
}) {
  const configuredModelId = stripProviderPrefix(params.configuredModelId || '');
  if (configuredModelId) return configuredModelId;

  const visionModel = params.models.find((model) => model.capabilities?.vision)?.id;
  return visionModel || params.fallbackModelId;
}

/**
 * Get current model configuration from settings store.
 *
 * Strict requirement: every provider MUST have both apiKey and baseUrl
 * configured independently.  No fallback between roles — each role
 * (text / vision / OCR) must be explicitly configured.
 *
 * Returns `configured` flags so callers can prevent generation when
 * required roles are not fully configured.
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

  // --- Text provider (must have both apiKey + baseUrl) ---
  const textProviderId = (providerId || 'openai') as ProviderId;
  const textProviderCfg = providersConfig[textProviderId] || PROVIDERS[textProviderId];
  const textApiKey = textProviderCfg?.apiKey?.trim() || '';
  const textBaseUrl =
    textProviderCfg?.baseUrl?.trim() || textProviderCfg?.defaultBaseUrl || '';
  const textConfigured = !!(textApiKey && textBaseUrl);

  // Text model
  const textModelIds = new Set([
    ...(textProviderCfg?.models?.map((m) => m.id) || []),
    ...(textProviderCfg?.serverModels || []),
  ]);
  const safeTextModelId =
    (providerId === textProviderId && modelId && textModelIds.has(modelId) ? modelId : '') ||
    textProviderCfg?.models?.[0]?.id ||
    textProviderCfg?.serverModels?.[0] ||
    PROVIDERS[textProviderId]?.models?.[0]?.id ||
    '';

  // --- Vision provider (must have both apiKey + baseUrl, no fallback) ---
  const visionProviderIdRaw = (visionProviderId || textProviderId) as ProviderId;
  const { apiKey: visionApiKey, baseUrl: visionBaseUrl, configured: visionConfigured } =
    resolveRoleCredentials({
      roleProviderId: visionProviderIdRaw,
      providersConfig,
    });
  const visionProviderCfg =
    providersConfig[visionProviderIdRaw] || PROVIDERS[visionProviderIdRaw];
  const visionModels = visionProviderCfg?.models || [];
  const safeVisionModelId = resolveTaskModel({
    configuredModelId: visionConfigured ? visionModelId : undefined,
    models: visionModels,
    fallbackModelId: '',
  });

  // --- OCR provider (must have both apiKey + baseUrl, no fallback) ---
  const ocrProviderIdRaw = (ocrProviderId || visionProviderIdRaw || textProviderId) as ProviderId;
  const { apiKey: ocrApiKey, baseUrl: ocrBaseUrl, configured: ocrConfigured } =
    resolveRoleCredentials({
      roleProviderId: ocrProviderIdRaw,
      providersConfig,
    });
  const ocrProviderCfg = providersConfig[ocrProviderIdRaw] || PROVIDERS[ocrProviderIdRaw];
  const ocrModels = ocrProviderCfg?.models || [];
  const safeOcrModelId = resolveTaskModel({
    configuredModelId: ocrConfigured ? ocrModelId : undefined,
    models: ocrModels,
    fallbackModelId: '',
  });

  // --- Compose strings for the backend ---
  const modelString = textConfigured && safeTextModelId ? `${textProviderId}:${safeTextModelId}` : '';
  const visionModelString = visionConfigured && safeVisionModelId ? `${visionProviderIdRaw}:${safeVisionModelId}` : '';
  const ocrModelString = ocrConfigured && safeOcrModelId ? `${ocrProviderIdRaw}:${safeOcrModelId}` : '';

  return {
    // Text
    providerId: textProviderId,
    modelId: safeTextModelId,
    modelString,
    apiKey: textApiKey,
    baseUrl: textBaseUrl,
    providerType: textProviderCfg?.type,
    requiresApiKey: textProviderCfg?.requiresApiKey,
    isServerConfigured: textProviderCfg?.isServerConfigured,
    configured: textConfigured,
    // Vision
    visionProviderId: visionProviderIdRaw,
    visionModelId: safeVisionModelId,
    visionModelString,
    visionApiKey,
    visionBaseUrl: visionBaseUrl || undefined,
    visionProviderType: visionProviderCfg?.type,
    visionRequiresApiKey: visionProviderCfg?.requiresApiKey,
    visionIsServerConfigured: visionProviderCfg?.isServerConfigured,
    visionConfigured,
    // OCR
    ocrProviderId: ocrProviderIdRaw,
    ocrModelId: safeOcrModelId,
    ocrModelString,
    ocrApiKey,
    ocrBaseUrl: ocrBaseUrl || undefined,
    ocrProviderType: ocrProviderCfg?.type,
    ocrRequiresApiKey: ocrProviderCfg?.requiresApiKey,
    ocrIsServerConfigured: ocrProviderCfg?.isServerConfigured,
    ocrConfigured,
  };
}

/**
 * Validate that required model configurations are present for a given feature.
 *
 * Feature requirements:
 * - 'chat': Text/LLM only (for AI tutor, live-book, classroom generation)
 * - 'problem_video': Text + Vision + OCR (for photo-to-video generation)
 * - 'vision': Text + Vision (for vision-related tasks)
 *
 * Image/Video/TTS providers are optional and not validated here.
 *
 * @param feature - The feature requiring model configs
 * @returns Object with `valid` flag and optional `missingRoles` list
 */
export function validateModelConfigForFeature(
  feature: 'problem_video' | 'chat' | 'vision',
): { valid: boolean; missingRoles: string[] } {
  const config = getCurrentModelConfig();
  const missingRoles: string[] = [];

  // Text/LLM is required for all features
  if (!config.configured) {
    missingRoles.push('文本模型');
  }

  // Vision and OCR are only required for problem_video
  if (feature === 'problem_video') {
    if (!config.visionConfigured) {
      missingRoles.push('视觉模型');
    }
    if (!config.ocrConfigured) {
      missingRoles.push('OCR模型');
    }
  }

  return {
    valid: missingRoles.length === 0,
    missingRoles,
  };
}
