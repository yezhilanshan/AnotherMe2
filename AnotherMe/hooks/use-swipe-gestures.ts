'use client';

import { useEffect, useRef } from 'react';

export type SwipeDirection = 'left' | 'right';

export interface SwipeGesturesOptions {
  /** Minimum horizontal distance (px) required to count as a swipe. */
  readonly threshold?: number;
  /** Maximum vertical travel (px) tolerated; anything more is not a swipe. */
  readonly maxVertical?: number;
  /** Max elapsed time (ms) between touchstart and touchend. */
  readonly maxDuration?: number;
  /** Called when a left swipe is detected. */
  readonly onSwipeLeft?: () => void;
  /** Called when a right swipe is detected. */
  readonly onSwipeRight?: () => void;
  /**
   * Predicate that returns false to skip gesture detection for the current
   * touch sequence (e.g. when the touch started inside an interactive element
   * like a button, input, textarea, or a [data-no-swipe] ancestor).
   */
  readonly shouldHandle?: (target: EventTarget | null) => boolean;
}

const DEFAULT_THRESHOLD = 50;
const DEFAULT_MAX_VERTICAL = 80;
const DEFAULT_MAX_DURATION = 600;

const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, [role="button"], [data-no-swipe]';

function defaultShouldHandle(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  // Walk up the DOM — if we find an interactive ancestor, skip the swipe so
  // that buttons, inputs, and labeled no-swipe regions still work normally.
  if (target.closest(INTERACTIVE_SELECTOR)) return false;
  return true;
}

/**
 * useSwipeGestures — attach horizontal swipe listeners to a ref.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useSwipeGestures(ref, { onSwipeLeft: handleNext, onSwipeRight: handlePrev });
 *
 * The hook is a no-op when `onSwipeLeft` and `onSwipeRight` are both undefined.
 */
export function useSwipeGestures<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  options: SwipeGesturesOptions = {},
): void {
  const {
    threshold = DEFAULT_THRESHOLD,
    maxVertical = DEFAULT_MAX_VERTICAL,
    maxDuration = DEFAULT_MAX_DURATION,
    onSwipeLeft,
    onSwipeRight,
    shouldHandle = defaultShouldHandle,
  } = options;

  // Keep handlers in refs so the touch listeners are attached once.
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  const shouldHandleRef = useRef(shouldHandle);

  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
    shouldHandleRef.current = shouldHandle;
  }, [onSwipeLeft, onSwipeRight, shouldHandle]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!onSwipeLeft && !onSwipeRight) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }
      if (!shouldHandleRef.current(event.target)) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      // If the user is clearly scrolling vertically, abandon tracking.
      if (Math.abs(dy) > maxVertical) {
        tracking = false;
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const elapsed = Date.now() - startTime;
      if (elapsed > maxDuration) return;
      if (Math.abs(dy) > maxVertical) return;
      if (Math.abs(dx) < threshold) return;
      // Prevent the gesture from also being treated as a tap or scroll.
      event.preventDefault();
      if (dx < 0) {
        onSwipeLeftRef.current?.();
      } else {
        onSwipeRightRef.current?.();
      }
    };

    const handleTouchCancel = () => {
      tracking = false;
    };

    node.addEventListener('touchstart', handleTouchStart, { passive: true });
    node.addEventListener('touchmove', handleTouchMove, { passive: true });
    node.addEventListener('touchend', handleTouchEnd, { passive: false });
    node.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('touchend', handleTouchEnd);
      node.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [ref, threshold, maxVertical, maxDuration, onSwipeLeft, onSwipeRight]);
}
