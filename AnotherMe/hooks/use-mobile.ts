import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

/**
 * Detects mobile devices.
 * - Viewport < 768px → always mobile
 * - Touch device with viewport < 1024px → mobile (catches phones in landscape)
 * - Otherwise → desktop
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const detect = () => {
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const w = window.innerWidth;
      setIsMobile(w < MOBILE_BREAKPOINT || (isTouch && w < TABLET_BREAKPOINT));
    };

    const mql = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT - 1}px)`);
    mql.addEventListener('change', detect);
    detect();
    return () => mql.removeEventListener('change', detect);
  }, []);

  return !!isMobile;
}

export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = React.useState<boolean>(false);

  React.useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  return isTouch;
}
