import { useCallback, useRef, useState } from 'react';
import { useCanvasStore } from '@/lib/store/canvas';

interface TouchGestureState {
  tap: boolean;
  doubleTap: boolean;
  longPress: boolean;
  dragging: boolean;
  pinching: boolean;
}

interface TouchPoint {
  x: number;
  y: number;
}

/**
 * Touch gesture recognition hook for mobile canvas interaction.
 *
 * Recognizes:
 * - Single tap: select element
 * - Double tap: enter edit mode
 * - Long press (500ms): context menu
 * - Single finger drag: move element
 * - Pinch: zoom
 */
export function useTouchGestures() {
  const setActiveElementIdList = useCanvasStore.use.setActiveElementIdList();

  const [gestureState, setGestureState] = useState<TouchGestureState>({
    tap: false,
    doubleTap: false,
    longPress: false,
    dragging: false,
    pinching: false,
  });

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const touchStartRef = useRef<TouchPoint | null>(null);
  const pinchStartDistanceRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const longPressTriggeredRef = useRef(false);

  const LONG_PRESS_DELAY = 500;
  const DOUBLE_TAP_DELAY = 300;
  const TAP_MOVEMENT_THRESHOLD = 10;
  const PINCH_THRESHOLD = 20;

  const getTouchDistance = (
    touch1: { clientX: number; clientY: number },
    touch2: { clientX: number; clientY: number },
  ): number => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent, onLongPress?: () => void, onDoubleTap?: () => void) => {
      const touch = e.touches[0];
      if (!touch) return;

      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      isDraggingRef.current = false;
      longPressTriggeredRef.current = false;

      // Handle two-finger pinch
      if (e.touches.length === 2) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        pinchStartDistanceRef.current = getTouchDistance(e.touches[0], e.touches[1]);
        setGestureState((prev) => ({ ...prev, pinching: true }));
        return;
      }

      // Single finger: start long press timer
      if (e.touches.length === 1) {
        longPressTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          setGestureState((prev) => ({ ...prev, longPress: true }));
          onLongPress?.();

          // Haptic feedback if available
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }, LONG_PRESS_DELAY);
      }
    },
    [],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent, onPinch?: (scale: number) => void) => {
      if (!touchStartRef.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      // Handle pinch
      if (e.touches.length === 2 && pinchStartDistanceRef.current > 0) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
        const scale = currentDistance / pinchStartDistanceRef.current;
        onPinch?.(scale);
        return;
      }

      // Single finger: check if moved beyond tap threshold (cancel long press)
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > TAP_MOVEMENT_THRESHOLD) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        if (!longPressTriggeredRef.current) {
          isDraggingRef.current = true;
          setGestureState((prev) => ({ ...prev, dragging: true, longPress: false }));
        }
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent, onSingleTap?: (point: TouchPoint) => void) => {
      // Clean up long press timer
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      // Pinch end
      if (e.touches.length < 2) {
        pinchStartDistanceRef.current = 0;
        setGestureState((prev) => ({ ...prev, pinching: false }));
      }

      // If long press was triggered or dragging, skip tap detection
      if (longPressTriggeredRef.current || isDraggingRef.current) {
        setGestureState((prev) => ({ ...prev, dragging: false, longPress: false }));
        touchStartRef.current = null;
        return;
      }

      // No remaining touches = full gesture end
      if (e.touches.length === 0 && touchStartRef.current) {
        const now = Date.now();
        const timeSinceLastTap = now - lastTapTimeRef.current;

        // Double tap detection
        if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
          setGestureState((prev) => ({ ...prev, doubleTap: true }));
          const onDoubleTap = (e.target as HTMLElement)?.closest('[data-element-id]');
          if (onDoubleTap) {
            // Double tap on element - handled by caller
          }
          lastTapTimeRef.current = 0;
        }
        // Single tap
        else {
          lastTapTimeRef.current = now;
          setGestureState((prev) => ({ ...prev, tap: true }));
          onSingleTap?.(touchStartRef.current);
        }
      }

      touchStartRef.current = null;

      // Reset gesture states after a tick
      setTimeout(() => {
        setGestureState({
          tap: false,
          doubleTap: false,
          longPress: false,
          dragging: false,
          pinching: false,
        });
      }, 0);
    },
    [],
  );

  return {
    gestureState,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
