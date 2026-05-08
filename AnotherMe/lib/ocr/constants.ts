/**
 * OCR Provider Registry
 *
 * Central registry for all OCR providers.
 * Keep in sync with OCRProviderId type definition.
 */

import type { OCRProviderConfig } from './types';

export const OCR_PROVIDERS: Record<string, OCRProviderConfig> = {
  'paddleocr': {
    id: 'paddleocr',
    name: 'PaddleOCR (本地)',
    requiresApiKey: false,
    icon: '/logos/paddle.svg',
    models: [
      { id: 'chinese_cht_v2.0', name: 'Chinese Traditional V2.0' },
      { id: 'chinese_v2.0', name: 'Chinese Simplified V2.0' },
      { id: 'en_v3.0', name: 'English V3.0' },
      { id: 'japan_v2.0', name: 'Japanese V2.0' },
      { id: 'korean_v2.0', name: 'Korean V2.0' },
      { id: 'french_v2.0', name: 'French V2.0' },
      { id: 'german_v2.0', name: 'German V2.0' },
      { id: 'spanish_v2.0', name: 'Spanish V2.0' },
      { id: 'portuguese_v2.0', name: 'Portuguese V2.0' },
      { id: 'russian_v2.0', name: 'Russian V2.0' },
    ],
    defaultModelId: 'chinese_v2.0',
    supportedLanguages: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru'],
  },

  'llm': {
    id: 'llm',
    name: 'LLM OCR (云端)',
    requiresApiKey: true,
    icon: '/logos/llm.svg',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'qwen-vl-ocr-latest', name: 'Qwen VL OCR' },
    ],
    defaultModelId: 'gpt-4o-mini',
    supportedLanguages: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar'],
  },
};

export function getOCRProviders(): OCRProviderConfig[] {
  return Object.values(OCR_PROVIDERS);
}

export function getOCRProvider(providerId: string): OCRProviderConfig | undefined {
  return OCR_PROVIDERS[providerId];
}