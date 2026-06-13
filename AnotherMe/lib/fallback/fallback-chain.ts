/**
 * FallbackChain — unified fallback execution framework.
 *
 * Encapsulates the pattern of: try primary → on failure, try strategies in order
 * → return first success or throw last error. Used across media generation,
 * LLM calls, OCR, and other provider-switching scenarios.
 *
 * Usage:
 *   const chain = new FallbackChain<VideoRequest>([
 *     { name: 'soften_prompt', canHandle: isContentSensitive, execute: softenAndRetry },
 *     { name: 'switch_provider', canHandle: always, execute: tryNextProvider },
 *   ]);
 *
 *   const result = await chain.execute(request, primaryFn, { maxAttempts: 3 });
 *
 *   // Listen for fallback events
 *   chain.on('fallback', (event) => log.warn('Fallback triggered:', event));
 */

import {
  type FallbackEvent,
  type FallbackSummary,
  type FallbackEventListener,
  buildFallbackSummary,
  FallbackEventBus,
} from './events';

export { type FallbackEvent, type FallbackSummary } from './events';

/**
 * A single fallback strategy.
 */
export interface FallbackStrategy<T> {
  /** Unique name for logging/tracking */
  name: string;
  /** Return true if this strategy can handle the given error */
  canHandle(error: unknown): boolean;
  /**
   * Execute the fallback.
   * Receives the original request, the error, and the attempt index.
   * Should return a result or throw to pass to the next strategy.
   */
  execute(context: FallbackContext<T>): Promise<T>;
}

/**
 * Context passed to a fallback strategy's execute method.
 */
export interface FallbackContext<T> {
  /** The original request */
  request: T;
  /** The error from the previous attempt */
  error: unknown;
  /** 0-based attempt index (1 = first fallback) */
  attempt: number;
  /** Events from previous attempts in this chain run */
  history: FallbackEvent[];
}

/**
 * Options for chain.execute().
 */
export interface FallbackChainOptions {
  /** Maximum total attempts including the primary call. Default: strategies.length + 1 */
  maxAttempts?: number;
  /** AbortSignal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Unified fallback chain.
 *
 * @template T - The request/result type. Strategies transform or retry with
 *               modified versions of T.
 */
export class FallbackChain<T> {
  private strategies: FallbackStrategy<T>[];
  private eventBus = new FallbackEventBus();

  constructor(strategies: FallbackStrategy<T>[]) {
    this.strategies = strategies;
  }

  /**
   * Subscribe to fallback events (fires in real-time as each fallback triggers).
   * Returns an unsubscribe function.
   */
  on(listener: FallbackEventListener): () => void {
    return this.eventBus.on(listener);
  }

  /**
   * Execute the primary function, falling back to registered strategies on failure.
   *
   * @param request - The original request object
   * @param primaryFn - The primary function to try first
   * @param options - Execution options
   * @returns The first successful result
   * @throws The last error if all attempts fail
   */
  async execute(
    request: T,
    primaryFn: (req: T) => Promise<T>,
    options?: FallbackChainOptions,
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? this.strategies.length + 1;
    const events: FallbackEvent[] = [];
    let lastError: unknown;

    // Attempt 0: primary call
    try {
      if (options?.abortSignal?.aborted) {
        throw new Error('Aborted');
      }
      const result = await primaryFn(request);
      events.push({
        strategyName: 'primary',
        attempt: 0,
        error: null,
        timestamp: new Date().toISOString(),
        description: 'Primary call succeeded',
        success: true,
      });
      return result;
    } catch (error) {
      lastError = error;
      events.push({
        strategyName: 'primary',
        attempt: 0,
        error,
        timestamp: new Date().toISOString(),
        description: error instanceof Error ? error.message : String(error),
        success: false,
      });
    }

    // Attempt 1..N: fallback strategies
    for (let i = 0; i < this.strategies.length && events.length < maxAttempts; i++) {
      const strategy = this.strategies[i];

      if (options?.abortSignal?.aborted) {
        throw new Error('Aborted');
      }

      if (!strategy.canHandle(lastError)) {
        continue;
      }

      const context: FallbackContext<T> = {
        request,
        error: lastError,
        attempt: i + 1,
        history: events,
      };

      try {
        const result = await strategy.execute(context);
        const event: FallbackEvent = {
          strategyName: strategy.name,
          attempt: i + 1,
          error: lastError,
          timestamp: new Date().toISOString(),
          description: `Fallback '${strategy.name}' succeeded`,
          success: true,
        };
        events.push(event);
        this.eventBus.emit(event);
        return result;
      } catch (error) {
        lastError = error;
        const event: FallbackEvent = {
          strategyName: strategy.name,
          attempt: i + 1,
          error,
          timestamp: new Date().toISOString(),
          description: `Fallback '${strategy.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
          success: false,
        };
        events.push(event);
        this.eventBus.emit(event);
      }
    }

    // All attempts exhausted
    throw lastError;
  }

  /**
   * Execute and return both the result and a summary of what happened.
   * Useful when you need to surface degradation info to the user.
   */
  async executeWithSummary(
    request: T,
    primaryFn: (req: T) => Promise<T>,
    options?: FallbackChainOptions,
  ): Promise<{ result: T; summary: FallbackSummary }> {
    const events: FallbackEvent[] = [];
    const originalOn = this.eventBus.on.bind(this.eventBus);
    const unsubscribe = this.eventBus.on((e) => events.push(e));

    try {
      const result = await this.execute(request, primaryFn, options);
      return { result, summary: buildFallbackSummary(events) };
    } finally {
      unsubscribe();
    }
  }
}
