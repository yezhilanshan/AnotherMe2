import { create } from 'zustand';
import { createSelectors } from '@/lib/utils/create-selectors';
import type { PercentageGeometry } from '@/lib/types/action';

/**
 * Spotlight options
 */
export interface SpotlightOptions {
  radius?: number;
  dimness?: number;
  transition?: number;
}

/**
 * Highlight overlay options
 */
export interface HighlightOverlayOptions {
  color?: string;
  opacity?: number;
  borderWidth?: number;
  animated?: boolean;
}

/**
 * Laser pointer options
 */
export interface LaserOptions {
  color?: string;
  duration?: number;
}

interface TeachingEffectsState {
  // Spotlight
  spotlightElementId: string;
  spotlightOptions: SpotlightOptions | null;
  spotlightMode: 'pixel' | 'percentage';
  spotlightPercentageGeometry: PercentageGeometry | null;

  // Highlight
  highlightedElementIds: string[];
  highlightOptions: HighlightOverlayOptions | null;

  // Laser
  laserElementId: string;
  laserOptions: LaserOptions | null;

  // Zoom
  zoomTarget: { elementId: string; scale: number } | null;

  // Actions
  setSpotlight: (elementId: string, options?: SpotlightOptions) => void;
  setSpotlightPercentage: (
    elementId: string,
    geometry: PercentageGeometry,
    options?: SpotlightOptions,
  ) => void;
  clearSpotlight: () => void;
  setHighlight: (elementIds: string[], options?: HighlightOverlayOptions) => void;
  clearHighlight: () => void;
  setLaser: (elementId: string, options?: LaserOptions) => void;
  clearLaser: () => void;
  setZoom: (elementId: string, scale: number) => void;
  clearZoom: () => void;
  clearAllEffects: () => void;
}

const useTeachingEffectsBase = create<TeachingEffectsState>((set) => ({
  // Spotlight
  spotlightElementId: '',
  spotlightOptions: null,
  spotlightMode: 'pixel',
  spotlightPercentageGeometry: null,

  // Highlight
  highlightedElementIds: [],
  highlightOptions: null,

  // Laser
  laserElementId: '',
  laserOptions: null,

  // Zoom
  zoomTarget: null,

  // Actions
  setSpotlight: (elementId, options = {}) => {
    set({
      spotlightElementId: elementId,
      spotlightMode: 'pixel',
      spotlightOptions: {
        radius: 200,
        dimness: 0.7,
        transition: 300,
        ...options,
      },
      spotlightPercentageGeometry: null,
    });
  },

  setSpotlightPercentage: (elementId, geometry, options = {}) => {
    set({
      spotlightElementId: elementId,
      spotlightMode: 'percentage',
      spotlightPercentageGeometry: geometry,
      spotlightOptions: {
        dimness: 0.7,
        transition: 300,
        ...options,
      },
    });
  },

  clearSpotlight: () => {
    set({
      spotlightElementId: '',
      spotlightOptions: null,
      spotlightMode: 'pixel',
      spotlightPercentageGeometry: null,
    });
  },

  setHighlight: (elementIds, options = {}) => {
    set({
      highlightedElementIds: elementIds,
      highlightOptions: {
        color: '#ff6b6b',
        opacity: 0.3,
        borderWidth: 3,
        animated: true,
        ...options,
      },
    });
  },

  clearHighlight: () => {
    set({
      highlightedElementIds: [],
      highlightOptions: null,
    });
  },

  setLaser: (elementId, options = {}) => {
    set({
      laserElementId: elementId,
      laserOptions: {
        color: '#ff0000',
        duration: 3000,
        ...options,
      },
    });
  },

  clearLaser: () => {
    set({
      laserElementId: '',
      laserOptions: null,
    });
  },

  setZoom: (elementId, scale) => {
    set({
      zoomTarget: { elementId, scale },
    });
  },

  clearZoom: () => {
    set({
      zoomTarget: null,
    });
  },

  clearAllEffects: () => {
    set({
      spotlightElementId: '',
      spotlightOptions: null,
      spotlightMode: 'pixel',
      spotlightPercentageGeometry: null,
      highlightedElementIds: [],
      highlightOptions: null,
      laserElementId: '',
      laserOptions: null,
      zoomTarget: null,
    });
  },
}));

export const useTeachingEffects = createSelectors(useTeachingEffectsBase);
