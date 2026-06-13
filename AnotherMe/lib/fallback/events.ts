/**
 * Fallback Events — unified event types for tracking fallback chain execution.
 *
 * All fallback strategies emit these events so callers can observe, log,
 * and surface degradation information to users.
 */

/** The strategy that handled the fallback */
export interface FallbackEvent {
  /** Unique name of the strategy that fired */
  strategyName: string;
  /** 0-based attempt index (0 = primary call, 1 = first fallback, etc.) */
  attempt: number;
  /** The error that triggered this fallback */
  error: unknown;
  /** ISO timestamp */
  timestamp: string;
  /** Human-readable description of what happened */
  description: string;
  /** Whether this fallback produced a usable (if degraded) result */
  success: boolean;
  /** Quality level of the result, if applicable */
  qualityLevel?: 'exact' | 'recovered' | 'degraded' | 'schematic';
}

/** Aggregate summary after the chain completes */
export interface FallbackSummary {
  /** Total attempts made (including the primary) */
  totalAttempts: number;
  /** Number of fallback strategies that fired */
  fallbacksTriggered: number;
  /** Events in chronological order */
  events: FallbackEvent[];
  /** The quality level of the final result */
  finalQualityLevel?: FallbackEvent['qualityLevel'];
  /** Whether the result came from a degraded path */
  isDegraded: boolean;
}

/**
 * Build a summary from a list of events.
 */
export function buildFallbackSummary(events: FallbackEvent[]): FallbackSummary {
  const fallbacks = events.filter((e) => e.attempt > 0);
  const lastEvent = events[events.length - 1];
  return {
    totalAttempts: events.length,
    fallbacksTriggered: fallbacks.length,
    events,
    finalQualityLevel: lastEvent?.qualityLevel,
    isDegraded: fallbacks.length > 0,
  };
}

/**
 * Simple event emitter for fallback chains.
 * Callers can subscribe to 'fallback' events to react in real-time.
 */
export type FallbackEventListener = (event: FallbackEvent) => void;

export class FallbackEventBus {
  private listeners: FallbackEventListener[] = [];

  on(listener: FallbackEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: FallbackEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors to avoid breaking the chain
      }
    }
  }

  clear(): void {
    this.listeners = [];
  }
}
