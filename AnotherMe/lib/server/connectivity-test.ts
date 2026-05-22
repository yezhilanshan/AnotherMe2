/**
 * Unified connectivity test utilities for AI providers.
 *
 * Uses GET /models endpoint to validate API keys without consuming tokens.
 * Falls back to minimal text requests for providers that don't support /models.
 */

import { createLogger } from '@/lib/logger';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('ConnectivityTest');

export interface ConnectivityResult {
  ok: boolean;
  message: string;
}

/**
 * Build the /models URL for a given provider.
 * Returns null if the provider doesn't support a models endpoint.
 */
function buildModelsUrl(
  providerType: string,
  providerId: string,
  baseUrl: string,
): string | null {
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  switch (providerType) {
    case 'openai':
      // OpenAI-compatible: {baseUrl}/models
      return `${normalizedBase}/models`;

    case 'anthropic':
      // Anthropic: {baseUrl}/models (requires x-api-key header)
      return `${normalizedBase}/models`;

    case 'google':
      // Google: {baseUrl}/models?key={apiKey} (key added in caller)
      return `${normalizedBase}/models`;

    default:
      return null;
  }
}

/**
 * Build auth headers for a provider type.
 */
function buildAuthHeaders(
  providerType: string,
  apiKey: string,
): Record<string, string> {
  switch (providerType) {
    case 'openai':
      return {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

    case 'anthropic':
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      };

    case 'google':
      // Google uses query param for API key, no auth header needed
      return { 'Content-Type': 'application/json' };

    default:
      return {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
  }
}

/**
 * Test provider connectivity using the /models endpoint.
 *
 * This is the lightweight, recommended approach for most providers:
 * - Validates API key without consuming tokens
 * - No image uploads needed for vision models
 * - Fast response time
 *
 * @returns ConnectivityResult with success/failure and message
 */
export async function testProviderConnectivity(config: {
  providerType: string;
  providerId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<ConnectivityResult> {
  const { providerType, providerId, apiKey, baseUrl } = config;

  const modelsUrl = buildModelsUrl(providerType, providerId, baseUrl);
  if (!modelsUrl) {
    return { ok: false, message: 'Provider does not support models endpoint' };
  }

  // SSRF guard: validate URL before fetching
  const ssrfError = validateUrlForSSRF(modelsUrl);
  if (ssrfError) {
    return { ok: false, message: ssrfError };
  }

  // For Google, append API key as query parameter
  const url = providerType === 'google' ? `${modelsUrl}?key=${apiKey}` : modelsUrl;
  const headers = buildAuthHeaders(providerType, apiKey);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      return { ok: true, message: 'Connection successful' };
    }

    // Parse error response for user-friendly messages
    const status = response.status;
    const errorText = await response.text().catch(() => '');

    if (status === 401 || status === 403) {
      return { ok: false, message: 'API key is invalid or expired' };
    }
    if (status === 404) {
      // 404 on /models might mean the endpoint path is different
      // Return a generic connection success but note the models endpoint issue
      log.warn(`[${providerId}] /models returned 404, endpoint may not be supported`);
      return { ok: false, message: `API endpoint not found (${status}), please check Base URL` };
    }
    if (status === 429) {
      return { ok: false, message: 'API rate limit exceeded, please try again later' };
    }

    return {
      ok: false,
      message: `Connection failed (${status}): ${errorText.slice(0, 200)}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
      return { ok: false, message: 'Cannot connect to API server, please check the Base URL' };
    }
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('Timeout')) {
      return { ok: false, message: 'Connection timed out, please check your network' };
    }
    if (msg.includes('ECONNRESET')) {
      return { ok: false, message: 'Connection was reset, please check your network or proxy' };
    }

    return { ok: false, message: `Connection failed: ${msg}` };
  }
}

/**
 * Parse error messages from generateText failures into user-friendly Chinese messages.
 * Used as fallback when /models endpoint is not available.
 */
export function parseGenerationError(error: unknown): { message: string; statusCode: number } {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('AUTH')) {
    return { message: 'API key is invalid or expired', statusCode: 401 };
  }
  if (msg.includes('404') || msg.includes('not found') || msg.includes('Not Found')) {
    return { message: 'Model not found or API endpoint error', statusCode: 404 };
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
    return { message: 'API rate limit exceeded, please try again later', statusCode: 429 };
  }
  if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
    return { message: 'Cannot connect to API server, please check the Base URL', statusCode: 502 };
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return { message: 'Connection timed out, please check your network', statusCode: 504 };
  }

  log.error('Unhandled generation error:', error);
  return { message: 'Connection failed', statusCode: 500 };
}
