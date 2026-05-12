import type { ProviderId } from '@/lib/ai/providers';
import { PROVIDERS } from '@/lib/ai/providers';
import type { ASRProviderId, TTSProviderId } from '@/lib/audio/types';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import type { PDFProviderId } from '@/lib/pdf/types';
import type { ProvidersConfig } from '@/lib/types/settings';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { REQUIRED_CLASSROOM_AGENT_IDS } from '@/lib/orchestration/registry/classroom-presets';

export const DEFAULT_SELECTED_AGENT_IDS: string[] = [...REQUIRED_CLASSROOM_AGENT_IDS];

// Initialize default providers config
export const getDefaultProvidersConfig = (): ProvidersConfig => {
  const config: ProvidersConfig = {} as ProvidersConfig;
  Object.keys(PROVIDERS).forEach((pid) => {
    const provider = PROVIDERS[pid as ProviderId];
    config[pid as ProviderId] = {
      apiKey: '',
      baseUrl: '',
      models: provider.models,
      name: provider.name,
      type: provider.type,
      defaultBaseUrl: provider.defaultBaseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      isBuiltIn: true,
    };
  });
  return config;
};

// Initialize default audio config
export const getDefaultAudioConfig = () => ({
  ttsProviderId: 'browser-native-tts' as TTSProviderId,
  ttsVoice: 'default',
  ttsSpeed: 1.0,
  asrProviderId: 'browser-native' as ASRProviderId,
  asrLanguage: 'zh',
  ttsProvidersConfig: {
    'openai-tts': { apiKey: '', baseUrl: '', enabled: true },
    'azure-tts': { apiKey: '', baseUrl: '', enabled: false },
    'glm-tts': { apiKey: '', baseUrl: '', enabled: false },
    'qwen-tts': { apiKey: '', baseUrl: '', enabled: false },
    'doubao-tts': { apiKey: '', baseUrl: '', enabled: false },
    'elevenlabs-tts': { apiKey: '', baseUrl: '', enabled: false },
    'minimax-tts': { apiKey: '', baseUrl: '', modelId: 'speech-2.8-hd', enabled: false },
    'browser-native-tts': { apiKey: '', baseUrl: '', enabled: true },
  } as Record<
    TTSProviderId,
    { apiKey: string; baseUrl: string; modelId?: string; enabled: boolean }
  >,
  asrProvidersConfig: {
    'openai-whisper': { apiKey: '', baseUrl: '', enabled: true },
    'browser-native': { apiKey: '', baseUrl: '', enabled: true },
    'qwen-asr': { apiKey: '', baseUrl: '', enabled: false },
  } as Record<ASRProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

// Initialize default PDF config
export const getDefaultPDFConfig = () => ({
  pdfProviderId: 'unpdf' as PDFProviderId,
  pdfProvidersConfig: {
    unpdf: { apiKey: '', baseUrl: '', enabled: true },
    mineru: { apiKey: '', baseUrl: '', enabled: false },
  } as Record<PDFProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

// Initialize default Image config
export const getDefaultImageConfig = () => ({
  imageProviderId: 'seedream' as ImageProviderId,
  imageModelId: 'doubao-seedream-5-0-260128',
  imageProvidersConfig: {
    seedream: { apiKey: '', baseUrl: '', enabled: false },
    'qwen-image': { apiKey: '', baseUrl: '', enabled: false },
    'nano-banana': { apiKey: '', baseUrl: '', enabled: false },
    'minimax-image': { apiKey: '', baseUrl: '', enabled: false },
    'grok-image': { apiKey: '', baseUrl: '', enabled: false },
    'liblib-image': { apiKey: '', baseUrl: '', enabled: false },
  } as Record<ImageProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

// Initialize default Video config
export const getDefaultVideoConfig = () => ({
  videoProviderId: 'seedance' as VideoProviderId,
  videoModelId: 'doubao-seedance-1-5-pro-251215',
  videoProvidersConfig: {
    seedance: { apiKey: '', baseUrl: '', enabled: false },
    kling: { apiKey: '', baseUrl: '', enabled: false },
    veo: { apiKey: '', baseUrl: '', enabled: false },
    sora: { apiKey: '', baseUrl: '', enabled: false },
    'minimax-video': { apiKey: '', baseUrl: '', enabled: false },
    'grok-video': { apiKey: '', baseUrl: '', enabled: false },
  } as Record<VideoProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

// Initialize default Web Search config
export const getDefaultWebSearchConfig = () => ({
  webSearchProviderId: 'tavily' as WebSearchProviderId,
  webSearchProvidersConfig: {
    tavily: { apiKey: '', baseUrl: '', enabled: true },
  } as Record<WebSearchProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});
