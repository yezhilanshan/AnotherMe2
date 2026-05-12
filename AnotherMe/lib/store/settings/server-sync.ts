import type { ProviderId } from '@/lib/ai/providers';
import { PROVIDERS } from '@/lib/ai/providers';
import type { ASRProviderId, TTSProviderId } from '@/lib/audio/types';
import { DEFAULT_TTS_VOICES } from '@/lib/audio/constants';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import type { PDFProviderId } from '@/lib/pdf/types';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { validateModel, validateProvider } from '@/lib/store/settings-validation';
import type { SettingsState } from '@/lib/store/settings/types';

type StoreSet = (
  partial: Partial<SettingsState> | ((state: SettingsState) => Partial<SettingsState>),
) => void;
type SettingsLogger = { warn: (...args: unknown[]) => void };

/** Server response shape per provider category */
type ServerProviderInfo = Record<string, { models?: string[]; baseUrl?: string }>;

/**
 * Merge server provider info into a provider config map.
 * Resets all entries' server flags, then marks entries present in `serverInfo`.
 *
 * For LLM providers, pass `filterModels` to handle model-list filtering
 * (the only category with model-level server constraints).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeProviderConfigs(
  config: Record<string, any>,
  serverInfo: ServerProviderInfo | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filterModels?: (current: any, info: { models?: string[]; baseUrl?: string }) => Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const result = { ...config };

  // Reset all server flags
  for (const pid of Object.keys(result)) {
    if (result[pid]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reset: any = {
        ...result[pid],
        isServerConfigured: false,
        serverBaseUrl: undefined,
      };
      if (filterModels) reset.serverModels = undefined;
      result[pid] = reset;
    }
  }

  // Mark server-configured entries
  if (serverInfo) {
    for (const [pid, info] of Object.entries(serverInfo)) {
      if (result[pid]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const update: any = {
          ...result[pid],
          isServerConfigured: true,
          serverBaseUrl: info.baseUrl,
        };
        if (filterModels) {
          Object.assign(update, filterModels(result[pid], info));
        }
        result[pid] = update;
      }
    }
  }

  return result;
}

/** Build a fallback list: server-configured first, then client-key-only */
function buildFallback<T extends string>(
  config: Record<string, { isServerConfigured?: boolean; apiKey?: string }>,
): T[] {
  return [
    ...Object.entries(config)
      .filter(([, c]) => c.isServerConfigured)
      .map(([id]) => id as T),
    ...Object.entries(config)
      .filter(([, c]) => !c.isServerConfigured && !!c.apiKey)
      .map(([id]) => id as T),
  ];
}

export function createFetchServerProvidersAction(set: StoreSet, log: SettingsLogger) {
  return async () => {
    try {
      const res = await fetch('/api/server-providers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        providers: ServerProviderInfo;
        tts: ServerProviderInfo;
        asr: ServerProviderInfo;
        pdf: ServerProviderInfo;
        image: ServerProviderInfo;
        video: ServerProviderInfo;
        webSearch: ServerProviderInfo;
      };

      set((state) => {
        // === Merge server info into each provider config ===

        // LLM: extra model filtering logic
        const newProvidersConfig = mergeProviderConfigs(
          state.providersConfig,
          data.providers,
          (current: { models?: Array<{ id: string; name: string }> }, info) => {
            const currentModels = current?.models ?? [];
            const filteredModels = info.models?.length
              ? [
                  ...currentModels.filter((m) => info.models!.includes(m.id)),
                  ...info.models
                    .filter((modelId) => !currentModels.some((m) => m.id === modelId))
                    .map((modelId) => ({ id: modelId, name: modelId })),
                ]
              : currentModels;
            return { models: filteredModels, serverModels: info.models };
          },
        ) as SettingsState['providersConfig'];

        // TTS, ASR, PDF, Image, Video, WebSearch: simple reset+set
        const newTTSConfig = mergeProviderConfigs(
          state.ttsProvidersConfig, data.tts,
        ) as SettingsState['ttsProvidersConfig'];
        const newASRConfig = mergeProviderConfigs(
          state.asrProvidersConfig, data.asr,
        ) as SettingsState['asrProvidersConfig'];
        const newPDFConfig = mergeProviderConfigs(
          state.pdfProvidersConfig, data.pdf,
        ) as SettingsState['pdfProvidersConfig'];
        const newImageConfig = mergeProviderConfigs(
          state.imageProvidersConfig, data.image,
        ) as SettingsState['imageProvidersConfig'];
        const newVideoConfig = mergeProviderConfigs(
          state.videoProvidersConfig, data.video,
        ) as SettingsState['videoProvidersConfig'];
        const newWebSearchConfig = mergeProviderConfigs(
          state.webSearchProvidersConfig, data.webSearch,
        ) as SettingsState['webSearchProvidersConfig'];

        // === Validate current selections against updated configs ===

        const llmFallback = buildFallback<ProviderId>(newProvidersConfig);
        const ttsFallback = buildFallback<TTSProviderId>(newTTSConfig);
        const asrFallback = buildFallback<ASRProviderId>(newASRConfig);
        const pdfFallback = buildFallback<PDFProviderId>(newPDFConfig);
        const imageFallback = buildFallback<ImageProviderId>(newImageConfig);
        const videoFallback = buildFallback<VideoProviderId>(newVideoConfig);

        const validLLMProvider = validateProvider(
          state.providerId, newProvidersConfig, llmFallback,
        );
        const validTTSProvider = validateProvider(
          state.ttsProviderId, newTTSConfig, ttsFallback,
          'browser-native-tts' as TTSProviderId,
        );
        const validASRProvider = validateProvider(
          state.asrProviderId, newASRConfig, asrFallback,
          'browser-native' as ASRProviderId,
        );
        const validPDFProvider = validateProvider(
          state.pdfProviderId, newPDFConfig, pdfFallback,
          'unpdf' as PDFProviderId,
        );
        let validImageProvider = validateProvider(
          state.imageProviderId, newImageConfig, imageFallback,
        );
        let validVideoProvider = validateProvider(
          state.videoProviderId, newVideoConfig, videoFallback,
        );

        // Auto-recover: when provider is empty but server has available ones
        let recoveredImageModel = '';
        if (!validImageProvider && imageFallback.length > 0) {
          validImageProvider = imageFallback[0];
          const models = IMAGE_PROVIDERS[validImageProvider as ImageProviderId]?.models;
          if (models?.length) recoveredImageModel = models[0].id;
        }
        let recoveredVideoModel = '';
        if (!validVideoProvider && videoFallback.length > 0) {
          validVideoProvider = videoFallback[0];
          const models = VIDEO_PROVIDERS[validVideoProvider as VideoProviderId]?.models;
          if (models?.length) recoveredVideoModel = models[0].id;
        }

        const llmModels = validLLMProvider
          ? (newProvidersConfig[validLLMProvider as ProviderId]?.models ?? [])
          : [];
        const validLLMModel = validLLMProvider
          ? validateModel(state.modelId, llmModels) ||
            llmModels[0]?.id ||
            newProvidersConfig[validLLMProvider as ProviderId]?.serverModels?.[0] ||
            ''
          : '';
        const imageModels = IMAGE_PROVIDERS[validImageProvider as ImageProviderId]?.models ?? [];
        const validImageModel = validImageProvider
          ? recoveredImageModel ||
            validateModel(state.imageModelId, imageModels) ||
            imageModels[0]?.id ||
            ''
          : '';
        const videoModels = VIDEO_PROVIDERS[validVideoProvider as VideoProviderId]?.models ?? [];
        const validVideoModel = validVideoProvider
          ? recoveredVideoModel ||
            validateModel(state.videoModelId, videoModels) ||
            videoModels[0]?.id ||
            ''
          : '';

        const validTTSVoice =
          validTTSProvider !== state.ttsProviderId
            ? DEFAULT_TTS_VOICES[validTTSProvider as TTSProviderId] || 'default'
            : state.ttsVoice;

        // Auto-disable image/video generation when no provider is usable
        const shouldDisableImage = !validImageProvider && state.imageGenerationEnabled;
        const shouldDisableVideo = !validVideoProvider && state.videoGenerationEnabled;

        // === Auto-select / auto-enable (only on first run) ===
        let autoTtsProvider: TTSProviderId | undefined;
        let autoTtsVoice: string | undefined;
        let autoAsrProvider: ASRProviderId | undefined;
        let autoPdfProvider: PDFProviderId | undefined;
        let autoImageProvider: ImageProviderId | undefined;
        let autoImageModel: string | undefined;
        let autoVideoProvider: VideoProviderId | undefined;
        let autoVideoModel: string | undefined;
        let autoImageEnabled: boolean | undefined;
        let autoVideoEnabled: boolean | undefined;

        if (!state.autoConfigApplied) {
          // PDF: unpdf → mineru if server has it
          if (newPDFConfig.mineru?.isServerConfigured && state.pdfProviderId === 'unpdf') {
            autoPdfProvider = 'mineru' as PDFProviderId;
          }

          // TTS: select first server provider if current is not server-configured
          const serverTtsIds = Object.keys(data.tts) as TTSProviderId[];
          if (serverTtsIds.length > 0 && !newTTSConfig[state.ttsProviderId]?.isServerConfigured) {
            autoTtsProvider = serverTtsIds[0];
            autoTtsVoice = DEFAULT_TTS_VOICES[autoTtsProvider] || 'default';
          }

          // ASR: select first server provider if current is not server-configured
          const serverAsrIds = Object.keys(data.asr) as ASRProviderId[];
          if (serverAsrIds.length > 0 && !newASRConfig[state.asrProviderId]?.isServerConfigured) {
            autoAsrProvider = serverAsrIds[0];
          }

          // Image: first server provider
          const serverImageIds = Object.keys(data.image) as ImageProviderId[];
          if (
            serverImageIds.length > 0 &&
            !newImageConfig[state.imageProviderId]?.isServerConfigured
          ) {
            autoImageProvider = serverImageIds[0];
            const models = IMAGE_PROVIDERS[autoImageProvider]?.models;
            if (models?.length) autoImageModel = models[0].id;
          }
          if (serverImageIds.length > 0 && !state.imageGenerationEnabled) {
            autoImageEnabled = true;
          }

          // Video: first server provider
          const serverVideoIds = Object.keys(data.video || {}) as VideoProviderId[];
          if (
            serverVideoIds.length > 0 &&
            !newVideoConfig[state.videoProviderId]?.isServerConfigured
          ) {
            autoVideoProvider = serverVideoIds[0];
            const models = VIDEO_PROVIDERS[autoVideoProvider]?.models;
            if (models?.length) autoVideoModel = models[0].id;
          }
          if (serverVideoIds.length > 0 && !state.videoGenerationEnabled) {
            autoVideoEnabled = true;
          }
        }

        // LLM auto-select: only on true first load (no provider selected yet)
        let autoProviderId: ProviderId | undefined;
        let autoModelId: string | undefined;
        if (!state.providerId && !state.modelId) {
          for (const [pid, cfg] of Object.entries(newProvidersConfig)) {
            if (cfg.isServerConfigured) {
              const modelId =
                cfg.models[0]?.id ||
                cfg.serverModels?.[0] ||
                PROVIDERS[pid as ProviderId]?.models[0]?.id;
              if (modelId) {
                autoProviderId = pid as ProviderId;
                autoModelId = modelId;
                break;
              }
            }
          }
        }

        return {
          providersConfig: newProvidersConfig,
          ttsProvidersConfig: newTTSConfig,
          asrProvidersConfig: newASRConfig,
          pdfProvidersConfig: newPDFConfig,
          imageProvidersConfig: newImageConfig,
          videoProvidersConfig: newVideoConfig,
          webSearchProvidersConfig: newWebSearchConfig,
          autoConfigApplied: true,
          // Validated selections
          ...(validLLMProvider !== state.providerId && {
            providerId: validLLMProvider as ProviderId,
          }),
          ...(validLLMModel !== state.modelId && { modelId: validLLMModel }),
          ...(validTTSProvider !== state.ttsProviderId && {
            ttsProviderId: validTTSProvider as TTSProviderId,
            ttsVoice: validTTSVoice,
          }),
          ...(validASRProvider !== state.asrProviderId && {
            asrProviderId: validASRProvider as ASRProviderId,
          }),
          ...(validPDFProvider !== state.pdfProviderId && {
            pdfProviderId: validPDFProvider as PDFProviderId,
          }),
          ...(validImageProvider !== state.imageProviderId && {
            imageProviderId: validImageProvider as ImageProviderId,
          }),
          ...(validImageModel !== state.imageModelId && {
            imageModelId: validImageModel,
          }),
          ...(validVideoProvider !== state.videoProviderId && {
            videoProviderId: validVideoProvider as VideoProviderId,
          }),
          ...(validVideoModel !== state.videoModelId && {
            videoModelId: validVideoModel,
          }),
          ...(shouldDisableImage && { imageGenerationEnabled: false }),
          ...(shouldDisableVideo && { videoGenerationEnabled: false }),
          // First-run auto-select overrides validation (autoConfigApplied guard)
          ...(autoPdfProvider && { pdfProviderId: autoPdfProvider }),
          ...(autoTtsProvider && {
            ttsProviderId: autoTtsProvider,
            ttsVoice: autoTtsVoice,
          }),
          ...(autoAsrProvider && { asrProviderId: autoAsrProvider }),
          ...(autoImageProvider && {
            imageProviderId: autoImageProvider,
          }),
          ...(autoImageModel && { imageModelId: autoImageModel }),
          ...(autoVideoProvider && {
            videoProviderId: autoVideoProvider,
          }),
          ...(autoVideoModel && { videoModelId: autoVideoModel }),
          ...(autoImageEnabled !== undefined && {
            imageGenerationEnabled: autoImageEnabled,
          }),
          ...(autoVideoEnabled !== undefined && {
            videoGenerationEnabled: autoVideoEnabled,
          }),
          ...(autoProviderId && { providerId: autoProviderId }),
          ...(autoModelId && { modelId: autoModelId }),
        };
      });
    } catch (e) {
      // Silently fail — server providers are optional
      log.warn('Failed to fetch server providers:', e);
    }
  };
}
