'use client';

import { useState, useEffect } from 'react';
import { useIsMobile } from './use-mobile';

/**
 * Detect whether the device is in landscape orientation.
 * Returns true when viewport width > viewport height.
 */
function getIsLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  // Use matchMedia for reliable detection (works with on-screen keyboard)
  return window.matchMedia('(orientation: landscape)').matches;
}

/**
 * Hook that returns true when the device is in landscape orientation.
 * Listens for orientation changes via both matchMedia and resize.
 */
export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => getIsLandscape());

  useEffect(() => {
    const mql = window.matchMedia('(orientation: landscape)');

    const handleChange = () => setIsLandscape(mql.matches);

    // Modern browsers
    mql.addEventListener('change', handleChange);
    // Fallback for older browsers
    window.addEventListener('resize', handleChange);

    // Sync in case of SSR hydration mismatch
    setIsLandscape(mql.matches);

    return () => {
      mql.removeEventListener('change', handleChange);
      window.removeEventListener('resize', handleChange);
    };
  }, []);

  return isLandscape;
}

/**
 * Convenience hook: true only when on a mobile device AND in landscape.
 * Use this to trigger mobile-landscape-specific layouts.
 */
export function useIsMobileLandscape(): boolean {
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  return isMobile && isLandscape;
}
