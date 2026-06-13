/**
 * Pre-defined fallback strategies for common scenarios.
 *
 * These strategies can be composed into FallbackChain instances
 * across different modules (media generation, LLM calls, OCR, etc.).
 */

import type { FallbackStrategy, FallbackContext } from './fallback-chain';

// ==================== Error Classification Helpers ====================

/** Check if an error indicates content safety / moderation blocking */
export function isContentSensitiveError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('sensitivecontent') ||
    msg.includes('sensitive information') ||
    msg.includes('content safety') ||
    msg.includes('moderation') ||
    msg.includes('content_sensitive')
  );
}

/** Check if an error is a transient network/timeout issue */
export function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
}

/** Check if an error is a rate limit */
export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
}

/** Check if an error is auth-related (non-retryable) */
export function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid api key')
  );
}

// ==================== Generic Strategies ====================

/**
 * Prompt softening strategy — appends safety qualifiers to the prompt.
 * Returns a softened request that the FallbackChain treats as a successful
 * fallback result. The caller can then retry with the softened prompt.
 */
export function createPromptSofteningStrategy<T extends { prompt: string }>(
  softener: (prompt: string) => string,
): FallbackStrategy<T> {
  return {
    name: 'prompt_softening',
    canHandle: isContentSensitiveError,
    execute: async (context: FallbackContext<T>) => {
      return { ...context.request, prompt: softener(context.request.prompt) } as T;
    },
  };
}

/**
 * Create a prompt softening strategy that calls the provided function.
 * Use this when the strategy needs to make the API call itself.
 */
export function createPromptSofteningWithCallStrategy<T extends { prompt: string }>(
  softener: (prompt: string) => string,
  callFn: (req: T) => Promise<T>,
): FallbackStrategy<T> {
  return {
    name: 'prompt_softening',
    canHandle: isContentSensitiveError,
    execute: async (context: FallbackContext<T>) => {
      const softenedRequest = { ...context.request, prompt: softener(context.request.prompt) };
      return callFn(softenedRequest);
    },
  };
}

/**
 * Provider switching strategy — tries an alternate provider.
 * The caller provides a function that picks the next provider and makes the call.
 */
export function createProviderSwitchStrategy<T>(
  switchFn: (req: T, context: FallbackContext<T>) => Promise<T>,
  canHandleFn?: (error: unknown) => boolean,
): FallbackStrategy<T> {
  return {
    name: 'provider_switch',
    canHandle: canHandleFn ?? (() => true), // Default: handle any error
    execute: async (context: FallbackContext<T>) => {
      return switchFn(context.request, context);
    },
  };
}

/**
 * Delayed retry strategy — waits before retrying the same request.
 * Useful for rate limits and transient errors.
 */
export function createDelayedRetryStrategy<T>(
  callFn: (req: T) => Promise<T>,
  delayMs: number,
): FallbackStrategy<T> {
  return {
    name: 'delayed_retry',
    canHandle: (error) => isTransientError(error) || isRateLimitError(error),
    execute: async (context: FallbackContext<T>) => {
      const backoff = delayMs * Math.pow(2, context.attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(backoff, 30_000)));
      return callFn(context.request);
    },
  };
}

/**
 * Quality degradation strategy — accepts a lower quality result.
 * The caller provides a function that generates with reduced quality settings.
 */
export function createQualityDegradationStrategy<T>(
  degradeFn: (req: T, context: FallbackContext<T>) => Promise<T>,
): FallbackStrategy<T> {
  return {
    name: 'quality_degradation',
    canHandle: () => true, // Can always try lower quality
    execute: async (context: FallbackContext<T>) => {
      return degradeFn(context.request, context);
    },
  };
}
