/**
 * Circuit Breaker — prevents cascading failures on unstable mobile networks.
 *
 * State machine:
 *   closed  → normal operation; failures counted
 *   open    → requests blocked; auto-recovers after recoveryTimeout
 *   half-open → allows one probe request; closes on success, re-opens on failure
 *
 * Usage:
 *   import { streamingCircuitBreaker } from './circuit-breaker';
 *
 *   if (!streamingCircuitBreaker.canRequest()) {
 *     throw new CircuitBreakerOpenError();
 *   }
 *   try {
 *     await doRequest();
 *     streamingCircuitBreaker.recordSuccess();
 *   } catch (err) {
 *     streamingCircuitBreaker.recordFailure();
 *     throw err;
 *   }
 */

export type CircuitBreakerStateName = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerStatus {
  state: CircuitBreakerStateName;
  failureCount: number;
  nextRetryTime: number;
}

export class CircuitBreakerOpenError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super('Circuit breaker is open — requests temporarily blocked');
    this.name = 'CircuitBreakerOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private failureThreshold: number;
  private recoveryTimeoutMs: number;
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: CircuitBreakerStateName = 'closed';

  constructor(options?: { failureThreshold?: number; recoveryTimeout?: number }) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.recoveryTimeoutMs = (options?.recoveryTimeout ?? 30) * 1000;
  }

  /**
   * Check whether a request is allowed to proceed.
   * Transitions open → half-open when recovery timeout has elapsed.
   */
  canRequest(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.recoveryTimeoutMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }

    // half-open: allow one probe
    return true;
  }

  /**
   * Time in ms until the next retry is allowed (0 if canRequest is true).
   */
  get retryAfterMs(): number {
    if (this.state !== 'open') return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.recoveryTimeoutMs - elapsed);
  }

  /**
   * Record a successful call. Closes the circuit if half-open.
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failureCount = 0;
    } else if (this.state === 'closed') {
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed call. Opens the circuit when threshold is reached.
   */
  recordFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  /**
   * Get current breaker status (for diagnostics / UI).
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextRetryTime: this.state === 'open'
        ? this.lastFailureTime + this.recoveryTimeoutMs
        : 0,
    };
  }

  /**
   * Reset to initial closed state.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Global circuit breaker for streaming chat requests.
 * Threshold: 3 failures → open for 30 seconds.
 */
export const streamingCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  recoveryTimeout: 30,
});
