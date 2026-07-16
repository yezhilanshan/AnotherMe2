/**
 * Unified Fallback Framework
 *
 * Provides a consistent pattern for handling failures across all provider
 * modules (video, image, LLM, OCR, TTS, PDF). Instead of each module
 * implementing its own retry/switch/degrade logic, they compose strategies
 * into a FallbackChain.
 *
 * Quick start:
 *   import { FallbackChain, createProviderSwitchStrategy } from '@/lib/fallback';
 *
 *   const chain = new FallbackChain([
 *     createProviderSwitchStrategy(mySwitchFn),
 *   ]);
 *   const result = await chain.execute(request, primaryFn);
 */

export { FallbackChain } from './fallback-chain';
export type {
  FallbackStrategy,
  FallbackContext,
  FallbackChainOptions,
} from './fallback-chain';

export type {
  FallbackEvent,
  FallbackSummary,
  FallbackEventListener,
} from './events';
export { buildFallbackSummary, FallbackEventBus } from './events';

export {
  isContentSensitiveError,
  isTransientError,
  isRateLimitError,
  isAuthError,
  createPromptSofteningStrategy,
  createPromptSofteningWithCallStrategy,
  createProviderSwitchStrategy,
  createDelayedRetryStrategy,
  createQualityDegradationStrategy,
} from './strategies';
