// Core stores
import { useCanvasStore } from './canvas';
import { useSnapshotStore } from './snapshot';
import { useStageStore } from './stage';
import { useSettingsStore } from './settings';
import { useDiagnosticStore } from './diagnostic';

export {
  // New architecture
  useCanvasStore,
  useStageStore,
  useSnapshotStore,
  useSettingsStore,
  useDiagnosticStore,
};

// Scene Context API (for extensible scene types)
export { SceneProvider, useSceneData, useSceneSelector } from '@/lib/contexts/scene-context';

// Keyboard Context API (replaces useKeyboardStore)
export { KeyboardProvider, useKeyboard } from '@/lib/contexts/keyboard-context';

// Teaching effects store (extracted from canvas store)
export { useTeachingEffects } from './teaching-effects';
export type { SpotlightOptions, HighlightOverlayOptions, LaserOptions } from './teaching-effects';
