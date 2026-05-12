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

export function createFetchServerProvidersAction(set: StoreSet, log: SettingsLogger) {
  return async () => {
    try {
      const res = await fetch('/api/server-providers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        providers: Record<string, { models?: string[]; baseUrl?: string }>;
        tts: Record<string, { baseUrl?: string }>;
        asr: Record<string, { baseUrl?: string }>;
        pdf: Record<string, { baseUrl?: string }>;
        image: Record<string, { baseUrl?: string }>;
        video: Record<string, { baseUrl?: string }>;
        webSearch: Record<string, { baseUrl?: string }>;
      };

      set((state) => {
        // Merge LLM providers
        const newProvidersConfig = { ...state.providersConfig };
        // First reset all server flags
        for (const pid of Object.keys(newProvidersConfig)) {
          const key = pid as ProviderId;
          if (newProvidersConfig[key]) {
            newProvidersConfig[key] = {
              ...newProvidersConfig[key],
              isServerConfigured: false,
              serverModels: undefined,
              serverBaseUrl: undefined,
            };
          }
        }
        // Set flags for server-configured providers
        for (const [pid, info] of Object.entries(data.providers)) {
          const key = pid as ProviderId;
          if (newProvidersConfig[key]) {
            const currentModels = newProvidersConfig[key].models;
            // When server specifies allowed models, filter the list.
            // Keep unknown server model IDs as placeholders so recovery
            // can still select them even if the built-in registry lags.
            const filteredModels = info.models?.length
              ? [
                  ...currentModels.filter((m) => info.models!.includes(m.id)),
                  ...info.models
                    .filter((modelId) => !currentModels.some((m) => m.id === modelId))
                    .map((modelId) => ({
                      id: modelId,
                      name: modelId,
                    })),
                ]
              : currentModels;
            newProvidersConfig[key] = {
              ...newProvidersConfig[key],
              isServerConfigured: true,
              serverModels: info.models,
              serverBaseUrl: info.baseUrl,
              models: filteredModels,
            };
          }
        }

        // Merge TTS providers
        const newTTSConfig = { ...state.ttsProvidersConfig };
        for (const pid of Object.keys(newTTSConfig)) {
          const key = pid as TTSProviderId;
          if (newTTSConfig[key]) {
            newTTSConfig[key] = {
              ...newTTSConfig[key],
              isServerConfigured: false,
              serverBaseUrl: undefined,
            };
          }
        }
        for (const [pid, info] of Object.entries(data.tts)) {
          const key = pid as TTSProviderId;
          if (newTTSConfig[key]) {
            newTTSConfig[key] = {
              ...newTTSConfig[key],
              isServerConfigured: true,
              serverBaseUrl: info.baseUrl,
            };
          }
        }

        // Merge ASR providers
        const newASRConfig = { ...state.asrProvidersConfig };
        for (const pid of Object.keys(newASRConfig)) {
          const key = pid as ASRProviderId;
          if (newASRConfig[key]) {
            newASRConfig[key] = {
              ...newASRConfig[key],
              isServerConfigured: false,
              serverBaseUrl: undefined,
            };
          }
        }
        for (const [pid, info] of Object.entries(data.asr)) {
          const key = pid as ASRProviderId;
          if (newASRConfig[key]) {
            newASRConfig[key] = {
              ...newASRConfig[key],
              isServerConfigured: true,
              serverBaseUrl: info.baseUrl,
            };
          }
        }

        // Merge PDF providers
        const newPDFConfig = { ...state.pdfProvidersConfig };
        for (const pid of Object.keys(newPDFConfig)) {
          const key = pid as PDFProviderId;
          if (newPDFConfig[key]) {
            newPDFConfig[key] = {
              ...newPDFConfig[key],
              isServerConfigured: false,
              serverBaseUrl: undefined,
            };
          }
        }
        for (const [pid, info] of Object.entries(data.pdf)) {
          const key = pid as PDFProviderId;
          if (newPDFConfig[key]) {
            newPDFConfig[key] = {
              ...newPDFConfig[key],
              isServerConfigured: true,
              serverBaseUrl: info.baseUrl,
            };
          }
        }

        // Merge Image providers
        const newImageConfig = { ...state.imageProvidersConfig };
        for (const pid of Object.keys(newImageConfig)) {
          const key = pid as ImageProviderId;
          if (newImageConfig[key]) {
            newImageConfig[key] = {
              ...newImageConfig[key],
              isServerConfigured: false,
              serverBaseUrl: undefined,
            };
          }
        }
        for (const [pid, info] of Object.entries(data.image)) {
          const key = pid as ImageProviderId;
          if (newImageConfig[key]) {
            newImageConfig[key] = {
              ...newImageConfig[key],
              isServerConfigured: true,
              serverBaseUrl: info.baseUrl,
            };
          }
        }

        // Merge Video providers
        const newVideoConfig = { ...state.videoProvidersConfig };
        for (const pid of Object.keys(newVideoConfig)) {
          const key = pid as VideoProviderId;
          if (newVideoConfig[key]) {
            newVideoConfig[key] = {
              ...newVideoConfig[key],
              isServerConfigured: false,
              serverBaseUrl: undefined,
            };
          }
        }
        if (data.video) {
          for (const [pid, info] of Object.entries(data.video)) {
            const key = pid as VideoProviderId;
            if (newVideoConfig[key]) {
              newVideoConfig[key] = {
                ...newVideoConfig[key],
                isServerConfigured: true,
                serverBaseUrl: info.baseUrl,
              };
            }
          }
        }

        // Merge Web Search config — reset all first, then mark server-configured
        const newWebSearchConfig = { ...state.webSearchProvidersConfig };
        for (const key of Object.keys(newWebSearchConfig) as WebSearchProviderId[]) {
          newWebSearchConfig[key] = {
            ...newWebSearchConfig[key],
            isServerConfigured: false,
            serverBaseUrl: undefined,
          };
        }
        if (data.webSearch) {
          for (const [pid, info] of Object.entries(data.webSearch)) {
            const key = pid as WebSearchProviderId;
            if (newWebSearchConfig[key]) {
              newWebSearchConfig[key] = {
                ...newWebSearchConfig[key],
                isServerConfigured: true,
                serverBaseUrl: info.baseUrl,
              };
            }
          }
        }

        // === Validate current selections against updated configs ===
        // Build fallback: server-configured first, then client-key-only
        const buildFallback = <T extends string>(
          config: Record<string, { isServerConfigured?: boolean; apiKey?: string }>,
        ): T[] => [
          ...Object.entries(config)
            .filter(([, c]) => c.isServerConfigured)
            .map(([id]) => id as T),
          ...Object.entries(config)
            .filter(([, c]) => !c.isServerConfigured && !!c.apiKey)
            .map(([id]) => id as T),
        ];

        const llmFallback = buildFallback<ProviderId>(newProvidersConfig);
        const ttsFallback = buildFallback<TTSProviderId>(newTTSConfig);
        const asrFallback = buildFallback<ASRProviderId>(newASRConfig);
        const pdfFallback = buildFallback<PDFProviderId>(newPDFConfig);
        const imageFallback = buildFallback<ImageProviderId>(newImageConfig);
        const videoFallback = buildFallback<VideoProviderId>(newVideoConfig);

        const validLLMProvider = validateProvider(
          state.providerId,
          newProvidersConfig,
          llmFallback,
        );
        const validTTSProvider = validateProvider(
          state.ttsProviderId,
          newTTSConfig,
          ttsFallback,
          'browser-native-tts' as TTSProviderId,
        );
        const validASRProvider = validateProvider(
          state.asrProviderId,
          newASRConfig,
          asrFallback,
          'browser-native' as ASRProviderId,
        );
        const validPDFProvider = validateProvider(
          state.pdfProviderId,
          newPDFConfig,
          pdfFallback,
          'unpdf' as PDFProviderId,
        );
        let validImageProvider = validateProvider(
          state.imageProviderId,
          newImageConfig,
          imageFallback,
        );
        let validVideoProvider = validateProvider(
          state.videoProviderId,
          newVideoConfig,
          videoFallback,
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
            // validateModel('', ...) returns '' — fallback to first model when modelId is empty
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
          // First-run auto-select overrides validation (autoConfigApplied guard).
          // On first sync, auto-select picks the best provider. On subsequent syncs,
          // auto* variables stay undefined so only validation spreads take effect.
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
