/**
 * Stage API - Canvas Operations
 *
 * Factory function that creates the canvas namespace of the Stage API.
 * Handles background, theme, highlight, spotlight, laser, and zoom effects.
 * Uses useTeachingEffects for visual overlay effects.
 */

import type { SlideContent } from '@/lib/types/stage';
import type { SlideTheme, SlideBackground } from '@/lib/types/slides';
import { useTeachingEffects } from '@/lib/store/teaching-effects';
import type { StageStore, APIResult, HighlightOptions, SpotlightOptions } from './stage-api-types';
import { getScene } from './stage-api-defaults';

/**
 * Create the canvas operations API
 *
 * @param store - Zustand store instance
 * @returns Canvas namespace API
 */
export function createCanvasAPI(store: StageStore) {
  return {
    /**
     * Set background
     *
     * @param sceneId - Scene ID
     * @param background - Background settings
     * @returns Whether successful
     */
    setBackground(sceneId: string, background: SlideBackground): APIResult<boolean> {
      try {
        const state = store.getState();
        const scene = getScene(state.scenes, sceneId);

        if (!scene || scene.type !== 'slide') {
          return { success: false, error: 'Invalid scene' };
        }

        const content = scene.content as SlideContent;

        const newScenes = state.scenes.map((s) => {
          if (s.id === sceneId) {
            return {
              ...s,
              content: {
                ...content,
                canvas: {
                  ...content.canvas,
                  background,
                },
              },
              updatedAt: Date.now(),
            };
          }
          return s;
        });

        store.setState({ scenes: newScenes });

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Set theme
     *
     * @param sceneId - Scene ID
     * @param theme - Theme settings
     * @returns Whether successful
     */
    setTheme(sceneId: string, theme: Partial<SlideTheme>): APIResult<boolean> {
      try {
        const state = store.getState();
        const scene = getScene(state.scenes, sceneId);

        if (!scene || scene.type !== 'slide') {
          return { success: false, error: 'Invalid scene' };
        }

        const content = scene.content as SlideContent;

        const newScenes = state.scenes.map((s) => {
          if (s.id === sceneId) {
            return {
              ...s,
              content: {
                ...content,
                canvas: {
                  ...content.canvas,
                  theme: {
                    ...content.canvas.theme,
                    ...theme,
                  },
                },
              },
              updatedAt: Date.now(),
            };
          }
          return s;
        });

        store.setState({ scenes: newScenes });

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Highlight an element (teaching feature)
     *
     * Emphasize an element by adding a highlight border or shadow
     *
     * @param sceneId - Scene ID
     * @param elementId - Element ID
     * @param options - Highlight options
     * @returns Whether successful
     */
    highlight(
      sceneId: string,
      elementId: string,
      options: HighlightOptions = {},
    ): APIResult<boolean> {
      const { duration, color = '#ff6b6b', style = 'outline' } = options;

      try {
        // Use the new Teaching Effects store highlight overlay API
        // Advantage: does not modify the element itself, purely visual effect
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.setHighlight([elementId], {
          color,
          opacity: style === 'fill' ? 0.3 : 0.5,
          borderWidth: 3,
          animated: true,
        });

        // If duration is set, automatically clear the highlight
        if (duration) {
          setTimeout(() => {
            teachingEffects.clearHighlight();
          }, duration);
        }

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Spotlight effect (teaching feature)
     *
     * Highlight a specific element while dimming everything else
     * Note: this requires a mask layer in the frontend rendering layer
     *
     * @param sceneId - Scene ID
     * @param elementId - Element ID
     * @param options - Spotlight options
     * @returns Whether successful
     */
    spotlight(
      sceneId: string,
      elementId: string,
      options: SpotlightOptions = {},
    ): APIResult<boolean> {
      try {
        // Use Teaching Effects store's spotlight API
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.setSpotlight(elementId, options);

        // If duration is set, automatically clear the spotlight
        if (options.duration) {
          setTimeout(() => {
            teachingEffects.clearSpotlight();
          }, options.duration);
        }

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Clear all highlight and spotlight effects
     *
     * @param sceneId - Scene ID
     * @returns Whether successful
     */
    clearHighlights(_sceneId: string): APIResult<boolean> {
      try {
        // Use Teaching Effects store to clear all teaching effects
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.clearHighlight();
        teachingEffects.clearSpotlight();

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Clear spotlight effect
     *
     * @returns Whether successful
     */
    clearSpotlight(_sceneId?: string): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.clearSpotlight();
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Set percentage-mode spotlight
     *
     * @param sceneId - Scene ID
     * @param elementId - Element ID
     * @param geometry - Percentage geometry info
     * @param options - Spotlight options
     * @returns Whether successful
     */
    setSpotlightPercentage(
      sceneId: string,
      elementId: string,
      geometry: import('@/lib/types/action').PercentageGeometry,
      options: SpotlightOptions = {},
    ): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.setSpotlightPercentage(elementId, geometry, options);

        if (options.duration) {
          setTimeout(() => {
            teachingEffects.clearSpotlight();
          }, options.duration);
        }

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Set laser pointer effect
     *
     * @param sceneId - Scene ID
     * @param elementId - Element ID
     * @param geometry - Percentage geometry info
     * @param options - Laser pointer options
     * @returns Whether successful
     */
    setLaser(
      sceneId: string,
      elementId: string,
      geometry: import('@/lib/types/action').PercentageGeometry,
      options: import('@/lib/store/teaching-effects').LaserOptions = {},
    ): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.setLaser(elementId, options);

        if (options.duration) {
          setTimeout(() => {
            teachingEffects.clearLaser();
          }, options.duration);
        }

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Clear laser pointer effect
     *
     * @param sceneId - Scene ID
     * @returns Whether successful
     */
    clearLaser(_sceneId: string): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.clearLaser();
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Set zoom effect
     *
     * @param sceneId - Scene ID
     * @param elementId - Element ID
     * @param geometry - Percentage geometry info
     * @param scale - Zoom scale
     * @returns Whether successful
     */
    setZoom(
      sceneId: string,
      elementId: string,
      geometry: import('@/lib/types/action').PercentageGeometry,
      scale: number,
    ): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.setZoom(elementId, scale);
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Clear zoom effect
     *
     * @param sceneId - Scene ID
     * @returns Whether successful
     */
    clearZoom(_sceneId: string): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.clearZoom();
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Clear all visual effects (spotlight, laser, zoom, etc.)
     *
     * @param sceneId - Scene ID
     * @returns Whether successful
     */
    clearAllEffects(_sceneId: string): APIResult<boolean> {
      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.clearAllEffects();
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    /**
     * Highlight multiple elements in batch
     *
     * @param sceneId - Scene ID
     * @param elementIds - Element ID list
     * @param options - Highlight options
     * @returns Whether successful
     */
    highlightMultiple(
      sceneId: string,
      elementIds: string[],
      options: HighlightOptions = {},
    ): APIResult<boolean> {
      const { duration, color = '#ff6b6b' } = options;

      try {
        const teachingEffects = useTeachingEffects.getState();
        teachingEffects.setHighlight(elementIds, {
          color,
          opacity: 0.3,
          borderWidth: 3,
          animated: true,
        });

        if (duration) {
          setTimeout(() => {
            teachingEffects.clearHighlight();
          }, duration);
        }

        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  };
}
