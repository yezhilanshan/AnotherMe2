import { describe, expect, it } from 'vitest';
import { ActionEngine } from '@/lib/action/engine';
import { PlaybackEngine } from '@/lib/playback';
import { useCanvasStore } from '@/lib/store/canvas';
import type { Scene } from '@/lib/types/stage';

async function waitForCondition(assertion: () => boolean, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

describe('PlaybackEngine video playback', () => {
  it('pauses and resumes the active play_video action', async () => {
    useCanvasStore.getState().resetCanvasState();

    const scene: Scene = {
      id: 'scene-video',
      stageId: 'stage-video',
      type: 'slide',
      title: 'Video scene',
      order: 0,
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-video',
          viewportSize: 1000,
          viewportRatio: 0.5625,
          elements: [{ id: 'video-1', type: 'video', src: 'https://example.test/video.mp4' }],
        },
      },
      actions: [{ id: 'action-video', type: 'play_video', elementId: 'video-1' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Scene;

    const stageStore = {
      getState: () => ({
        scenes: [scene],
        currentSceneId: scene.id,
      }),
    };
    const actionEngine = new ActionEngine(stageStore as never);
    const audioPlayer = {
      isPlaying: () => false,
      hasPendingPlay: () => false,
      hasActiveAudio: () => false,
      pause: () => undefined,
      resume: () => undefined,
      stop: () => undefined,
      cancelPendingPlay: () => undefined,
      onEnded: () => undefined,
      play: async () => false,
    };
    const engine = new PlaybackEngine([scene], actionEngine, audioPlayer as never);

    engine.start();
    await waitForCondition(() => useCanvasStore.getState().playingVideoElementId === 'video-1');

    engine.pause();
    await waitForCondition(() => useCanvasStore.getState().playingVideoElementId === '');
    expect(engine.getMode()).toBe('paused');

    engine.resume();
    await waitForCondition(() => useCanvasStore.getState().playingVideoElementId === 'video-1');
    expect(engine.getMode()).toBe('playing');
  });
});
