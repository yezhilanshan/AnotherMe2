/**
 * Shared model configuration for the Live-Book subsystem.
 *
 * Allows the client's model selection to flow through the API routes
 * into the engine modules that call resolveModel().
 */

import type { NextRequest } from 'next/server';
import { resolveModel, type ResolvedModel } from '@/lib/server/resolve-model';

export interface LiveBookModelConfig {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}

/**
 * Extract model config from request headers sent by the client.
 *
 * Reads: x-model, x-api-key, x-base-url, x-provider-type, x-requires-api-key
 */
export function resolveLiveBookModelFromHeaders(req: NextRequest): LiveBookModelConfig {
  return {
    modelString: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
  };
}

/**
 * Resolve a language model using the Live-Book model config.
 * Falls back to the default resolveModel() behavior if config is empty.
 */
export function resolveLiveBookModel(config?: LiveBookModelConfig): ResolvedModel {
  return resolveModel({
    modelString: config?.modelString,
    apiKey: config?.apiKey,
    baseUrl: config?.baseUrl,
    providerType: config?.providerType,
    requiresApiKey: config?.requiresApiKey,
  });
}
