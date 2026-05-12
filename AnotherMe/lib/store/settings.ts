/**
 * Settings Store
 * Global settings state synchronized with localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ASR_PROVIDERS, DEFAULT_TTS_VOICES } from '@/lib/audio/constants';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { createLogger } from '@/lib/logger';
import { createFetchServerProvidersAction } from '@/lib/store/settings/server-sync';
import {
  DEFAULT_SELECTED_AGENT_IDS,
  getDefaultAudioConfig,
  getDefaultImageConfig,
  getDefaultPDFConfig,
  getDefaultProvidersConfig,
  getDefaultVideoConfig,
  getDefaultWebSearchConfig,
} from '@/lib/store/settings/defaults';
import { migrateFromOldStorage } from '@/lib/store/settings/legacy-migration';
import {
  ensureBuiltInImageProviders,
  ensureBuiltInProviders,
  ensureBuiltInVideoProviders,
  ensureValidProviderSelections,
} from '@/lib/store/settings/rehydration';
import type { SettingsState } from '@/lib/store/settings/types';

export { PLAYBACK_SPEEDS } from '@/lib/store/settings/types';
export type { PlaybackSpeed, SettingsState } from '@/lib/store/settings/types';

const log = createLogger('Settings');

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => {
      // Try to migrate from old storage
      const migratedData = migrateFromOldStorage();
      const defaultAudioConfig = getDefaultAudioConfig();
      const defaultPDFConfig = getDefaultPDFConfig();
      const defaultImageConfig = getDefaultImageConfig();
      const defaultVideoConfig = getDefaultVideoConfig();
      const defaultWebSearchConfig = getDefaultWebSearchConfig();

      return {
        // Initial state (use migrated data if available)
        providerId: migratedData?.providerId || 'openai',
        modelId: migratedData?.modelId || '',
        visionProviderId: migratedData?.providerId || 'openai',
        visionModelId: '',
        ocrProviderId: migratedData?.providerId || 'openai',
        ocrModelId: '',
        ocrEngine: 'llm',
        providersConfig: migratedData?.providersConfig || getDefaultProvidersConfig(),
        ttsModel: migratedData?.ttsModel || 'openai-tts',
        selectedAgentIds: migratedData?.selectedAgentIds || [...DEFAULT_SELECTED_AGENT_IDS],
        maxTurns: migratedData?.maxTurns?.toString() || '10',
        agentMode: 'auto' as const,
        autoAgentCount: 3,

        // Playback controls
        ttsMuted: false,
        ttsVolume: 1,
        autoPlayLecture: false,
        playbackSpeed: 1,

        // Layout preferences
        sidebarCollapsed: true,
        chatAreaCollapsed: true,
        chatAreaWidth: 320,

        // Audio settings (use defaults)
        ...defaultAudioConfig,

        // PDF settings (use defaults)
        ...defaultPDFConfig,

        // Image settings (use defaults)
        ...defaultImageConfig,

        // Video settings (use defaults)
        ...defaultVideoConfig,

        // Media generation toggles (off by default)
        imageGenerationEnabled: false,
        videoGenerationEnabled: false,

        // Audio feature toggles (on by default)
        ttsEnabled: true,
        asrEnabled: true,

        autoConfigApplied: false,

        // Web Search settings (use defaults)
        ...defaultWebSearchConfig,

        // Actions
        setProvider: (providerId) => set({ providerId }),
        setModel: (providerId, modelId) => set({ providerId, modelId }),
        setVisionProvider: (providerId) => set({ visionProviderId: providerId }),
        setVisionModel: (providerId, modelId) =>
          set({ visionProviderId: providerId, visionModelId: modelId }),
        setVisionModelId: (modelId) => set({ visionModelId: modelId }),
        setOcrProvider: (providerId) => set({ ocrProviderId: providerId }),
        setOcrModel: (providerId, modelId) =>
          set({ ocrProviderId: providerId, ocrModelId: modelId }),
        setOcrModelId: (modelId) => set({ ocrModelId: modelId }),
        setOcrEngine: (engine) => set({ ocrEngine: engine }),

        setProviderConfig: (providerId, config) =>
          set((state) => ({
            providersConfig: {
              ...state.providersConfig,
              [providerId]: {
                ...state.providersConfig[providerId],
                ...config,
              },
            },
          })),

        setProvidersConfig: (config) => set({ providersConfig: config }),

        setTtsModel: (model) => set({ ttsModel: model }),

        setTTSMuted: (muted) => set({ ttsMuted: muted }),

        setTTSVolume: (volume) => set({ ttsVolume: Math.max(0, Math.min(1, volume)) }),

        setAutoPlayLecture: (autoPlay) => set({ autoPlayLecture: autoPlay }),

        setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

        setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),

        setMaxTurns: (turns) => set({ maxTurns: turns }),
        setAgentMode: (mode) => set({ agentMode: mode }),
        setAutoAgentCount: (count) => set({ autoAgentCount: count }),

        // Layout actions
        setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
        setChatAreaCollapsed: (collapsed) => set({ chatAreaCollapsed: collapsed }),
        setChatAreaWidth: (width) => set({ chatAreaWidth: width }),

        // Audio actions
        setTTSProvider: (providerId) =>
          set((state) => {
            // If switching provider, set default voice for that provider
            const shouldUpdateVoice = state.ttsProviderId !== providerId;
            return {
              ttsProviderId: providerId,
              ...(shouldUpdateVoice && { ttsVoice: DEFAULT_TTS_VOICES[providerId] }),
            };
          }),

        setTTSVoice: (voice) => set({ ttsVoice: voice }),

        setTTSSpeed: (speed) => set({ ttsSpeed: speed }),

        // Reset language when switching providers, since language code formats differ
        // (e.g. browser-native uses BCP-47 "en-US", OpenAI Whisper uses ISO 639-1 "en")
        setASRProvider: (providerId) =>
          set((state) => {
            const supportedLanguages = ASR_PROVIDERS[providerId]?.supportedLanguages || [];
            const isLanguageValid = supportedLanguages.includes(state.asrLanguage);
            return {
              asrProviderId: providerId,
              ...(isLanguageValid ? {} : { asrLanguage: supportedLanguages[0] || 'auto' }),
            };
          }),

        setASRLanguage: (language) => set({ asrLanguage: language }),

        setTTSProviderConfig: (providerId, config) =>
          set((state) => ({
            ttsProvidersConfig: {
              ...state.ttsProvidersConfig,
              [providerId]: {
                ...state.ttsProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        setASRProviderConfig: (providerId, config) =>
          set((state) => ({
            asrProvidersConfig: {
              ...state.asrProvidersConfig,
              [providerId]: {
                ...state.asrProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        // PDF actions
        setPDFProvider: (providerId) => set({ pdfProviderId: providerId }),

        setPDFProviderConfig: (providerId, config) =>
          set((state) => ({
            pdfProvidersConfig: {
              ...state.pdfProvidersConfig,
              [providerId]: {
                ...state.pdfProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        // Image Generation actions
        setImageProvider: (providerId) => set({ imageProviderId: providerId }),
        setImageModelId: (modelId) => set({ imageModelId: modelId }),

        setImageProviderConfig: (providerId, config) =>
          set((state) => ({
            imageProvidersConfig: {
              ...state.imageProvidersConfig,
              [providerId]: {
                ...state.imageProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        // Video Generation actions
        setVideoProvider: (providerId) => set({ videoProviderId: providerId }),
        setVideoModelId: (modelId) => set({ videoModelId: modelId }),

        setVideoProviderConfig: (providerId, config) =>
          set((state) => ({
            videoProvidersConfig: {
              ...state.videoProvidersConfig,
              [providerId]: {
                ...state.videoProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        // Media generation toggle actions
        setImageGenerationEnabled: (enabled) => {
          if (enabled) {
            const cfg = get().imageProvidersConfig;
            const hasUsable = Object.values(cfg).some((c) => c.isServerConfigured || c.apiKey);
            if (!hasUsable) return;
          }
          set({ imageGenerationEnabled: enabled });
        },
        setVideoGenerationEnabled: (enabled) => {
          if (enabled) {
            const cfg = get().videoProvidersConfig;
            const hasUsable = Object.values(cfg).some((c) => c.isServerConfigured || c.apiKey);
            if (!hasUsable) return;
          }
          set({ videoGenerationEnabled: enabled });
        },
        setTTSEnabled: (enabled) => set({ ttsEnabled: enabled }),
        setASREnabled: (enabled) => set({ asrEnabled: enabled }),

        // Web Search actions
        setWebSearchProvider: (providerId) => set({ webSearchProviderId: providerId }),
        setWebSearchProviderConfig: (providerId, config) =>
          set((state) => ({
            webSearchProvidersConfig: {
              ...state.webSearchProvidersConfig,
              [providerId]: {
                ...state.webSearchProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        fetchServerProviders: createFetchServerProvidersAction(set, log),
      };
    },
    {
      name: 'settings-storage',
      version: 2,
      // Migrate persisted state
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Partial<SettingsState>;

        // v0 → v1: clear hardcoded default model so user must actively select
        if (version === 0) {
          if (state.providerId === 'openai' && state.modelId === 'gpt-4o-mini') {
            state.modelId = '';
          }
        }

        // Ensure providersConfig has all built-in providers (also in merge below)
        ensureBuiltInProviders(state);

        // Ensure image/video configs have all built-in providers
        ensureBuiltInImageProviders(state);
        ensureBuiltInVideoProviders(state);

        // Migrate from old ttsModel to new ttsProviderId
        if (state.ttsModel && !state.ttsProviderId) {
          // Map old ttsModel values to new ttsProviderId
          if (state.ttsModel === 'openai-tts') {
            state.ttsProviderId = 'openai-tts';
          } else if (state.ttsModel === 'azure-tts') {
            state.ttsProviderId = 'azure-tts';
          } else {
            // Default to OpenAI
            state.ttsProviderId = 'openai-tts';
          }
        }

        // Add default audio config if missing
        if (!state.ttsProvidersConfig || !state.asrProvidersConfig) {
          const defaultAudioConfig = getDefaultAudioConfig();
          Object.assign(state, defaultAudioConfig);
        }

        // Migrate global ttsModelId to per-provider
        if ((state as Record<string, unknown>).ttsModelId) {
          const pid = state.ttsProviderId;
          if (pid && state.ttsProvidersConfig?.[pid]) {
            state.ttsProvidersConfig[pid].modelId = (state as Record<string, unknown>)
              .ttsModelId as string;
          }
          delete (state as Record<string, unknown>).ttsModelId;
        }
        // Same for asrModelId
        if ((state as Record<string, unknown>).asrModelId) {
          const pid = state.asrProviderId;
          if (pid && state.asrProvidersConfig?.[pid]) {
            state.asrProvidersConfig[pid].modelId = (state as Record<string, unknown>)
              .asrModelId as string;
          }
          delete (state as Record<string, unknown>).asrModelId;
        }
        // Migrate MiniMax's model field to modelId
        for (const [, cfg] of Object.entries(
          (state.ttsProvidersConfig as Record<string, Record<string, unknown>>) || {},
        )) {
          if (cfg.model && !cfg.modelId) {
            cfg.modelId = cfg.model;
            delete cfg.model;
          }
        }

        // Add default PDF config if missing
        if (!state.pdfProvidersConfig) {
          const defaultPDFConfig = getDefaultPDFConfig();
          Object.assign(state, defaultPDFConfig);
        }

        // Add default Image config if missing
        if (!state.imageProvidersConfig) {
          const defaultImageConfig = getDefaultImageConfig();
          Object.assign(state, defaultImageConfig);
        }

        // Add default Video config if missing
        if (!state.videoProvidersConfig) {
          const defaultVideoConfig = getDefaultVideoConfig();
          Object.assign(state, defaultVideoConfig);
        }

        // v1 → v2: Replace deep research with web search
        if (version < 2) {
          delete (state as Record<string, unknown>).deepResearchProviderId;
          delete (state as Record<string, unknown>).deepResearchProvidersConfig;
        }

        // Add default media generation toggles if missing
        if (state.imageGenerationEnabled === undefined) {
          state.imageGenerationEnabled = false;
        }
        if (state.videoGenerationEnabled === undefined) {
          state.videoGenerationEnabled = false;
        }

        // Add default audio toggles if missing
        if ((state as Record<string, unknown>).ttsEnabled === undefined) {
          (state as Record<string, unknown>).ttsEnabled = true;
        }
        if ((state as Record<string, unknown>).asrEnabled === undefined) {
          (state as Record<string, unknown>).asrEnabled = true;
        }

        // Existing users already have their config set up — mark auto-config as done
        if ((state as Record<string, unknown>).autoConfigApplied === undefined) {
          (state as Record<string, unknown>).autoConfigApplied = true;
        }

        if ((state as Record<string, unknown>).agentMode === undefined) {
          (state as Record<string, unknown>).agentMode = 'preset';
        }
        if ((state as Record<string, unknown>).autoAgentCount === undefined) {
          (state as Record<string, unknown>).autoAgentCount = 3;
        }

        if ((state as Record<string, unknown>).visionProviderId === undefined) {
          (state as Record<string, unknown>).visionProviderId = state.providerId || 'openai';
        }
        if ((state as Record<string, unknown>).ocrProviderId === undefined) {
          (state as Record<string, unknown>).ocrProviderId =
            (state as Record<string, unknown>).visionProviderId || state.providerId || 'openai';
        }
        if ((state as Record<string, unknown>).visionModelId === undefined) {
          (state as Record<string, unknown>).visionModelId = '';
        }
        if ((state as Record<string, unknown>).ocrModelId === undefined) {
          (state as Record<string, unknown>).ocrModelId = '';
        }
        if ((state as Record<string, unknown>).ocrEngine === undefined) {
          (state as Record<string, unknown>).ocrEngine = 'llm';
        }

        // Migrate Web Search: old flat fields → new provider-based config
        if (!state.webSearchProvidersConfig) {
          const stateRecord = state as Record<string, unknown>;
          const oldApiKey = (stateRecord.webSearchApiKey as string) || '';
          const oldIsServerConfigured =
            (stateRecord.webSearchIsServerConfigured as boolean) || false;
          state.webSearchProviderId = 'tavily' as WebSearchProviderId;
          state.webSearchProvidersConfig = {
            tavily: {
              apiKey: oldApiKey,
              baseUrl: '',
              enabled: true,
              isServerConfigured: oldIsServerConfigured,
            },
          } as SettingsState['webSearchProvidersConfig'];
          delete stateRecord.webSearchApiKey;
          delete stateRecord.webSearchIsServerConfigured;
        }

        ensureValidProviderSelections(state);

        return state;
      },
      // Custom merge: always sync built-in providers on every rehydrate,
      // so newly added providers/models appear without clearing cache.
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as object) };
        ensureBuiltInProviders(merged as Partial<SettingsState>);
        ensureBuiltInImageProviders(merged as Partial<SettingsState>);
        ensureBuiltInVideoProviders(merged as Partial<SettingsState>);
        ensureValidProviderSelections(merged as Partial<SettingsState>);
        return merged as SettingsState;
      },
    },
  ),
);
