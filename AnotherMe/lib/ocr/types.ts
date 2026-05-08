/**
 * OCR Provider Type Definitions
 *
 * Currently Supported OCR Providers:
 * - PaddleOCR (local, GPU-accelerated)
 * - LLM-based OCR (using vision models from various providers)
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * Step 1: Add provider ID to the OCRProviderId union type
 *
 * Step 2: Add provider configuration to constants.ts
 *   - Define provider metadata (name, icon, models, etc.)
 *   - Add to OCR_PROVIDERS registry
 *
 * Step 3: Implement provider logic in ocr-providers.ts
 *   - Add case to performOCR() switch statement
 *   - Implement OCR logic for the new provider
 *
 * Step 4: Add i18n translations
 *   - Add provider name translations in lib/i18n.ts
 *   - Format: `provider{ProviderName}OCR`
 */

export type OCRProviderId = 'paddleocr' | 'llm';

export interface OCRProviderConfig {
  id: OCRProviderId;
  name: string;
  requiresApiKey: boolean;
  icon?: string;
  models: Array<{ id: string; name: string }>;
  defaultModelId: string;
  supportedLanguages?: string[];
}

export interface OCRModelConfig {
  providerId: OCRProviderId;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  language?: string;
  providerOptions?: Record<string, unknown>;
}