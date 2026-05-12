import type { ProviderId } from '@/lib/ai/providers';
import { PROVIDERS } from '@/lib/ai/providers';
import { ASR_PROVIDERS, TTS_PROVIDERS } from '@/lib/audio/constants';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import {
  getDefaultAudioConfig,
  getDefaultImageConfig,
  getDefaultPDFConfig,
  getDefaultProvidersConfig,
  getDefaultVideoConfig,
  getDefaultWebSearchConfig,
} from '@/lib/store/settings/defaults';
import type { SettingsState } from '@/lib/store/settings/types';

/**
 * Check whether a provider ID exists in the given provider registry.
 */
function hasProviderId(providerMap: Record<string, unknown>, providerId?: string): boolean {
  return typeof providerId === 'string' && providerId in providerMap;
}

/**
 * Validate all persisted provider IDs against their registries.
 * Reset any stale / removed ID back to its default value.
 * Called during both migrate and merge to cover all rehydration paths.
 */
export function ensureValidProviderSelections(state: Partial<SettingsState>): void {
  const defaultAudioConfig = getDefaultAudioConfig();
  const defaultPdfConfig = getDefaultPDFConfig();
  const defaultImageConfig = getDefaultImageConfig();
  const defaultVideoConfig = getDefaultVideoConfig();
  const defaultWebSearchConfig = getDefaultWebSearchConfig();

  if (!hasProviderId(PDF_PROVIDERS, state.pdfProviderId)) {
    state.pdfProviderId = defaultPdfConfig.pdfProviderId;
  }

  if (!hasProviderId(WEB_SEARCH_PROVIDERS, state.webSearchProviderId)) {
    state.webSearchProviderId = defaultWebSearchConfig.webSearchProviderId;
  }

  if (!hasProviderId(IMAGE_PROVIDERS, state.imageProviderId)) {
    state.imageProviderId = defaultImageConfig.imageProviderId;
  }

  if (!hasProviderId(VIDEO_PROVIDERS, state.videoProviderId)) {
    state.videoProviderId = defaultVideoConfig.videoProviderId;
  }

  if (!hasProviderId(TTS_PROVIDERS, state.ttsProviderId)) {
    state.ttsProviderId = defaultAudioConfig.ttsProviderId;
  }

  if (!hasProviderId(ASR_PROVIDERS, state.asrProviderId)) {
    state.asrProviderId = defaultAudioConfig.asrProviderId;
  }

  if (!hasProviderId(PROVIDERS, state.providerId)) {
    state.providerId = 'openai' as ProviderId;
  }

  if (!hasProviderId(PROVIDERS, state.visionProviderId)) {
    state.visionProviderId = state.providerId || ('openai' as ProviderId);
  }

  if (!hasProviderId(PROVIDERS, state.ocrProviderId)) {
    state.ocrProviderId = state.visionProviderId || state.providerId || ('openai' as ProviderId);
  }
}

/**
 * Ensure providersConfig includes all built-in providers and their latest models.
 * Called on every rehydrate (not just version migrations) so new providers
 * added in code are always picked up without clearing cache.
 */
export function ensureBuiltInProviders(state: Partial<SettingsState>): void {
  if (!state.providersConfig) return;
  const defaultConfig = getDefaultProvidersConfig();
  Object.keys(PROVIDERS).forEach((pid) => {
    const providerId = pid as ProviderId;
    if (!state.providersConfig![providerId]) {
      // New provider: add with defaults
      state.providersConfig![providerId] = defaultConfig[providerId];
    } else {
      // Existing provider: merge new models & metadata
      const provider = PROVIDERS[providerId];
      const existing = state.providersConfig![providerId];

      const existingModelIds = new Set(existing.models?.map((m) => m.id) || []);
      const newModels = provider.models.filter((m) => !existingModelIds.has(m.id));
      const mergedModels =
        newModels.length > 0 ? [...newModels, ...(existing.models || [])] : existing.models;

      state.providersConfig![providerId] = {
        ...existing,
        models: mergedModels,
        name: existing.name || provider.name,
        type: existing.type || provider.type,
        defaultBaseUrl: existing.defaultBaseUrl || provider.defaultBaseUrl,
        icon: provider.icon || existing.icon,
        requiresApiKey: existing.requiresApiKey ?? provider.requiresApiKey,
        isBuiltIn: existing.isBuiltIn ?? true,
      };
    }
  });
}

/**
 * Ensure imageProvidersConfig includes all built-in image providers.
 * Called on every rehydrate so newly added image providers appear automatically.
 */
export function ensureBuiltInImageProviders(state: Partial<SettingsState>): void {
  if (!state.imageProvidersConfig) return;
  const defaultConfig = getDefaultImageConfig().imageProvidersConfig;
  Object.keys(IMAGE_PROVIDERS).forEach((pid) => {
    const providerId = pid as ImageProviderId;
    if (!state.imageProvidersConfig![providerId]) {
      state.imageProvidersConfig![providerId] = defaultConfig[providerId];
    }
  });
}

/**
 * Ensure videoProvidersConfig includes all built-in video providers.
 * Called on every rehydrate so newly added video providers appear automatically.
 */
export function ensureBuiltInVideoProviders(state: Partial<SettingsState>): void {
  if (!state.videoProvidersConfig) return;
  const defaultConfig = getDefaultVideoConfig().videoProvidersConfig;
  Object.keys(VIDEO_PROVIDERS).forEach((pid) => {
    const providerId = pid as VideoProviderId;
    if (!state.videoProvidersConfig![providerId]) {
      state.videoProvidersConfig![providerId] = defaultConfig[providerId];
    }
  });
}
