import { create } from 'zustand';
import { createSelectors } from '@/lib/utils/create-selectors';
import type { TextAttrs } from '@/lib/prosemirror/utils';
import { defaultRichTextAttrs } from '@/lib/prosemirror/utils';
import type { TextFormatPainter, ShapeFormatPainter, CreatingElement } from '@/lib/types/edit';

/**
 * Canvas Store - Manages all UI state of the Canvas editor
 *
 * Responsibilities:
 * - Element selection state (selected, handling, editing)
 * - Canvas viewport state (zoom, drag, ruler, grid)
 * - Toolbar and panel state
 * - Element being created
 * - Rich text editing state
 * - Format painter state
 *
 * Note: Does not manage slide data (elements, background, etc.), which is managed by Scene Context
 * Note: Teaching effects (spotlight/highlight/laser/zoom) are in teaching-effects.ts
 */

// Re-export teaching effects types for backward compatibility
export type { SpotlightOptions, HighlightOverlayOptions, LaserOptions } from './teaching-effects';

// ==================== Store Interface ====================

interface CanvasState {
  // ===== Element selection state =====
  activeElementIdList: string[]; // Currently selected element IDs
  handleElementId: string; // Element being operated (drag, resize, etc.)
  activeGroupElementId: string; // Selected child element within a group
  editingElementId: string; // Element being edited (e.g., text editing)
  hiddenElementIdList: string[]; // Hidden element IDs

  // ===== Canvas viewport state =====
  canvasScale: number; // Canvas actual zoom scale
  canvasPercentage: number; // Canvas percentage (used to calculate canvasScale)
  viewportSize: number; // Viewport width base (default 1000px)
  viewportRatio: number; // Viewport aspect ratio (default 0.5625, i.e. 16:9)
  canvasDragged: boolean; // Whether canvas is being dragged

  // ===== Display aids =====
  showRuler: boolean; // Show ruler
  gridLineSize: number; // Grid line size (0 means hidden)

  // ===== Toolbar and panels =====
  toolbarState: 'design' | 'ai' | 'elAnimation'; // Right toolbar state
  showSelectPanel: boolean; // Selection panel
  showSearchPanel: boolean; // Find and replace panel

  // ===== Element creation =====
  creatingElement: CreatingElement | null; // Element being created (needs draw-to-insert)
  creatingCustomShape: boolean; // Drawing custom shape (arbitrary polygon)

  // ===== Editing state =====
  isScaling: boolean; // Element scaling in progress
  clipingImageElementId: string; // Image being cropped
  richTextAttrs: TextAttrs; // Rich text editing state

  // ===== Format painter =====
  textFormatPainter: TextFormatPainter | null; // Text format painter
  shapeFormatPainter: ShapeFormatPainter | null; // Shape format painter

  // ===== Video playback =====
  playingVideoElementId: string; // Video element currently playing

  // ===== Whiteboard =====
  whiteboardOpen: boolean; // Whether whiteboard is open
  whiteboardClearing: boolean; // Whiteboard clear animation in progress

  // ===== Other =====
  thumbnailsFocus: boolean; // Whether left thumbnail area is focused
  editorAreaFocus: boolean; // Whether editor area is focused
  disableHotkeys: boolean; // Whether hotkeys are disabled
  selectedTableCells: string[]; // Selected table cells

  // ===== Actions =====

  // ----- Element selection -----
  setActiveElementIdList: (ids: string[]) => void;
  setHandleElementId: (id: string) => void;
  setActiveGroupElementId: (id: string) => void;
  setEditingElementId: (id: string) => void;
  setHiddenElementIdList: (ids: string[]) => void;
  clearSelection: () => void; // Clear all selections

  // ----- Canvas viewport -----
  setCanvasScale: (scale: number) => void;
  setCanvasPercentage: (percentage: number) => void;
  setViewportSize: (size: number) => void;
  setViewportRatio: (ratio: number) => void;
  setCanvasDragged: (dragged: boolean) => void;

  // ----- Display aids -----
  setRulerState: (show: boolean) => void;
  setGridLineSize: (size: number) => void;

  // ----- Toolbar and panels -----
  setToolbarState: (state: 'design' | 'ai') => void;
  setSelectPanelState: (show: boolean) => void;
  setSearchPanelState: (show: boolean) => void;

  // ----- Element creation -----
  setCreatingElement: (element: CreatingElement | null) => void;
  setCreatingCustomShapeState: (creating: boolean) => void;

  // ----- Editing state -----
  setScalingState: (isScaling: boolean) => void;
  setClipingImageElementId: (id: string) => void;
  setRichtextAttrs: (attrs: TextAttrs) => void;

  // ----- Format painter -----
  setTextFormatPainter: (painter: TextFormatPainter | null) => void;
  setShapeFormatPainter: (painter: ShapeFormatPainter | null) => void;

  // ----- Video playback -----
  playVideo: (elementId: string) => void;
  pauseVideo: () => void;

  // ----- Whiteboard -----
  setWhiteboardOpen: (open: boolean) => void;
  setWhiteboardClearing: (clearing: boolean) => void;

  // ----- Other -----
  setThumbnailsFocus: (focus: boolean) => void;
  setEditorAreaFocus: (focus: boolean) => void;
  setDisableHotkeysState: (disable: boolean) => void;
  setSelectedTableCells: (cells: string[]) => void;

  // ----- Batch operations -----
  resetCanvasState: () => void; // Reset Canvas state (used when switching scenes)
}

// ==================== Initial State ====================

const initialState = {
  // Element selection
  activeElementIdList: [],
  handleElementId: '',
  activeGroupElementId: '',
  editingElementId: '',
  hiddenElementIdList: [],

  // Canvas viewport
  canvasScale: 1,
  canvasPercentage: 90,
  viewportSize: 1000,
  viewportRatio: 0.5625, // 16:9
  canvasDragged: false,

  // Display aids
  showRuler: false,
  gridLineSize: 0,

  // Toolbar and panels
  toolbarState: 'ai' as const,
  showSelectPanel: false,
  showSearchPanel: false,

  // Element creation
  creatingElement: null,
  creatingCustomShape: false,

  // Editing state
  isScaling: false,
  clipingImageElementId: '',
  richTextAttrs: defaultRichTextAttrs,

  // Format painter
  textFormatPainter: null,
  shapeFormatPainter: null,

  // Video playback
  playingVideoElementId: '',

  // Whiteboard
  whiteboardOpen: false,
  whiteboardClearing: false,

  // Other: false,
  editorAreaFocus: false,
  thumbnailsFocus: false,
  disableHotkeys: false,
  selectedTableCells: [],
};

// ==================== Store Implementation ====================

const useCanvasStoreBase = create<CanvasState>((set, get) => ({
  ...initialState,

  // ===== Element Selection Actions =====

  setActiveElementIdList: (ids) => {
    set({ activeElementIdList: ids });
    // Auto-set handleElementId: set to that element for single select, empty for multi-select or none
    if (ids.length === 1) {
      set({ handleElementId: ids[0] });
    } else if (ids.length === 0) {
      set({ handleElementId: '' });
    }
    // Auto-switch to design panel when elements are selected
    if (ids.length > 0) {
      set({ toolbarState: 'design' });
    }
  },

  setHandleElementId: (id) => set({ handleElementId: id }),

  setActiveGroupElementId: (id) => set({ activeGroupElementId: id }),

  setEditingElementId: (id) => set({ editingElementId: id }),

  setHiddenElementIdList: (ids) => set({ hiddenElementIdList: ids }),

  clearSelection: () => {
    set({
      activeElementIdList: [],
      handleElementId: '',
      activeGroupElementId: '',
      editingElementId: '',
    });
  },

  // ===== Canvas Viewport Actions =====

  setCanvasScale: (scale) => set({ canvasScale: scale }),

  setCanvasPercentage: (percentage) => set({ canvasPercentage: percentage }),

  setViewportSize: (size) => set({ viewportSize: size }),

  setViewportRatio: (ratio) => set({ viewportRatio: ratio }),

  setCanvasDragged: (dragged) => set({ canvasDragged: dragged }),

  // ===== Display Aids Actions =====

  setRulerState: (show) => set({ showRuler: show }),

  setGridLineSize: (size) => set({ gridLineSize: size }),

  // ===== Toolbar and Panel Actions =====

  setToolbarState: (toolbarState) => set({ toolbarState }),

  setSelectPanelState: (show) => set({ showSelectPanel: show }),

  setSearchPanelState: (show) => set({ showSearchPanel: show }),

  // ===== Element Creation Actions =====

  setCreatingElement: (element) => set({ creatingElement: element }),

  setCreatingCustomShapeState: (creating) => set({ creatingCustomShape: creating }),

  // ===== Editing State Actions =====

  setScalingState: (isScaling) => set({ isScaling }),

  setClipingImageElementId: (id) => set({ clipingImageElementId: id }),

  setRichtextAttrs: (attrs) => set({ richTextAttrs: attrs }),

  // ===== Format Painter Actions =====

  setTextFormatPainter: (painter) => set({ textFormatPainter: painter }),

  setShapeFormatPainter: (painter) => set({ shapeFormatPainter: painter }),

  // ===== Video Playback Actions =====

  playVideo: (elementId) => set({ playingVideoElementId: elementId }),

  pauseVideo: () => set({ playingVideoElementId: '' }),

  // ===== Whiteboard Actions =====

  setWhiteboardOpen: (open) => set({ whiteboardOpen: open }),
  setWhiteboardClearing: (clearing) => set({ whiteboardClearing: clearing }),

  // ===== Other Actions =====

  setThumbnailsFocus: (focus) => set({ thumbnailsFocus: focus }),

  setEditorAreaFocus: (focus) => set({ editorAreaFocus: focus }),

  setDisableHotkeysState: (disable) => set({ disableHotkeys: disable }),

  setSelectedTableCells: (cells) => set({ selectedTableCells: cells }),

  // ===== Batch Operations =====

  resetCanvasState: () => {
    set({
      ...initialState,
      // Preserve viewport settings
      viewportSize: get().viewportSize,
      viewportRatio: get().viewportRatio,
    });
  },
}));

// Enhance store with selectors, supporting store.use.xxx() syntax
export const useCanvasStore = createSelectors(useCanvasStoreBase);
