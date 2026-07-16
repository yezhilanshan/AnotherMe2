/**
 * Audio Player - Audio player interface
 *
 * Handles audio playback, pause, stop, and other operations
 * Loads pre-generated TTS audio files from IndexedDB
 *
 * On mobile WebViews (iOS WKWebView, Android WebView), Audio.play() is
 * blocked by autoplay policies unless preceded by a user gesture. This
 * implementation includes audio context unlocking to handle this.
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');
const MAX_BLOB_URL_CACHE_SIZE = 24;

/**
 * Audio player implementation
 */
export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private onEndedCallback: (() => void) | null = null;
  private muted: boolean = false;
  private volume: number = 1;
  private playbackRate: number = 1;
  private blobUrlCache = new Map<string, string>();
  /** Whether the audio context has been unlocked via a user gesture */
  private audioUnlocked: boolean = false;
  /** Pending play request that was blocked by autoplay policy */
  private pendingPlay: {
    audioId: string;
    audioUrl?: string;
    resolve: (result: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  private rememberBlobUrl(audioId: string, blobUrl: string): void {
    if (this.blobUrlCache.has(audioId)) {
      const existing = this.blobUrlCache.get(audioId);
      if (existing && existing !== blobUrl) URL.revokeObjectURL(existing);
      this.blobUrlCache.delete(audioId);
    }

    this.blobUrlCache.set(audioId, blobUrl);

    while (this.blobUrlCache.size > MAX_BLOB_URL_CACHE_SIZE) {
      const oldestKey = this.blobUrlCache.keys().next().value;
      if (!oldestKey) break;
      const oldestUrl = this.blobUrlCache.get(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
      this.blobUrlCache.delete(oldestKey);
    }
  }

  private async resolveIndexedDbBlobUrl(audioId: string): Promise<string | null> {
    const cached = this.blobUrlCache.get(audioId);
    if (cached) {
      // Refresh insertion order for simple LRU behavior.
      this.blobUrlCache.delete(audioId);
      this.blobUrlCache.set(audioId, cached);
      return cached;
    }

    const audioRecord = await db.audioFiles.get(audioId);
    if (!audioRecord) return null;

    const blobUrl = URL.createObjectURL(audioRecord.blob);
    this.rememberBlobUrl(audioId, blobUrl);
    return blobUrl;
  }

  /**
   * Preload audio blob URL from IndexedDB into in-memory cache.
   */
  public async preload(audioId: string): Promise<boolean> {
    if (!audioId) return false;
    try {
      const blobUrl = await this.resolveIndexedDbBlobUrl(audioId);
      return Boolean(blobUrl);
    } catch (error) {
      log.warn('Audio preload failed:', error);
      return false;
    }
  }

  /**
   * Unlock audio context for mobile WebViews.
   * Must be called from a user gesture event (click/touch).
   * Plays a silent audio to satisfy the browser's autoplay policy,
   * then replays any pending play request that was previously blocked.
   */
  public async unlockAudio(): Promise<void> {
    if (this.audioUnlocked) return;

    try {
      // Create and play a near-silent audio to unlock the HTML5 Audio context.
      // Using a minimal WAV (44 bytes header + silent PCM) via data URI
      // is the most portable approach across iOS/Android WebViews.
      const silentWav = this.createSilentWavDataUri();
      const unlockAudio = new Audio(silentWav);
      unlockAudio.volume = 0.001;
      await unlockAudio.play();
      unlockAudio.pause();
      unlockAudio.currentTime = 0;

      // Also unlock the Web Speech API (speechSynthesis), which is the
      // default TTS provider and has its own autoplay restrictions on mobile.
      // Use a non-empty short utterance and wait briefly before canceling
      // so the browser registers the user-gesture speech context.
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(' ');
        utterance.volume = 0;
        utterance.rate = 2;
        window.speechSynthesis.speak(utterance);
        // Wait 100ms then cancel — the utterance itself may be inaudible
        // but the speak() call establishes the user-gesture context.
        await new Promise((resolve) => setTimeout(resolve, 100));
        window.speechSynthesis.cancel();
      }

      this.audioUnlocked = true;
      log.info('Audio context unlocked');

      // Retry any pending play that was blocked by autoplay policy
      if (this.pendingPlay) {
        const pending = this.pendingPlay;
        this.pendingPlay = null;
        try {
          const result = await this.playInternal(pending.audioId, pending.audioUrl);
          pending.resolve(result);
        } catch (err) {
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } catch (error) {
      log.warn('Audio unlock failed:', error);
      // Don't set audioUnlocked — retry on next user gesture
    }
  }

  /** Returns whether audio context has been unlocked */
  public isAudioUnlocked(): boolean {
    return this.audioUnlocked;
  }

  /**
   * Generate a minimal valid WAV data URI with sub-audible silence.
   * This avoids network requests and works on all platforms.
   */
  private createSilentWavDataUri(): string {
    // Minimal WAV: 44-byte header + 4 samples of silence (8 bytes for 16-bit mono)
    // Sample rate 8000 Hz, 16-bit mono PCM
    const sampleRate = 8000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = 4;
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');

    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // byte rate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // block align
    view.setUint16(34, bitsPerSample, true);

    // data chunk (silence is already zero-filled)
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const bytes = new Uint8Array(buffer);
    const base64 = btoa(String.fromCharCode(...bytes));
    return `data:audio/wav;base64,${base64}`;
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Rewrite an absolute audio URL to use the current page origin.
   * This handles the case where the classroom was generated with a
   * different origin (e.g. localhost) than what the mobile device uses
   * to access the page (e.g. LAN IP).
   */
  private rewriteAudioUrl(audioUrl: string): string {
    if (!audioUrl || audioUrl.startsWith('data:') || audioUrl.startsWith('blob:')) {
      return audioUrl;
    }
    // If the URL is relative (starts with /), resolve against current origin
    if (audioUrl.startsWith('/')) {
      return window.location.origin + audioUrl;
    }
    // If the URL has a different origin, rewrite to use current origin
    try {
      const parsed = new URL(audioUrl);
      if (parsed.origin !== window.location.origin) {
        // Preserve the path and query, replace origin
        return window.location.origin + parsed.pathname + parsed.search;
      }
    } catch {
      // If URL parsing fails, return as-is
    }
    return audioUrl;
  }

  /**
   * Internal play implementation shared by play() and unlockAudio() retry.
   */
  private async playInternal(audioId: string, audioUrl?: string): Promise<boolean> {
    // 1. Try audioUrl first (server-generated TTS), rewriting origin if needed
    if (audioUrl) {
      this.stop();
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.src = this.rewriteAudioUrl(audioUrl);
      if (this.muted) this.audio.volume = 0;
      else this.audio.volume = this.volume;
      this.audio.defaultPlaybackRate = this.playbackRate;
      this.audio.playbackRate = this.playbackRate;
      this.audio.addEventListener('ended', () => {
        this.onEndedCallback?.();
      });
      await this.audio.play();
      this.audio.playbackRate = this.playbackRate;
      return true;
    }

    // 2. Fall back to IndexedDB (client-generated TTS)
    const blobUrl = await this.resolveIndexedDbBlobUrl(audioId);
    if (!blobUrl) {
      // Pre-generated audio does not exist (generation failed), skip silently
      return false;
    }

    // Stop current playback
    this.stop();

    // Create audio element
    this.audio = new Audio();
    this.audio.preload = 'auto';

    // Set audio source
    this.audio.src = blobUrl;
    if (this.muted) this.audio.volume = 0;
    else this.audio.volume = this.volume;

    // Apply playback rate
    this.audio.defaultPlaybackRate = this.playbackRate;
    this.audio.playbackRate = this.playbackRate;

    // Set ended callback
    this.audio.addEventListener('ended', () => {
      this.onEndedCallback?.();
    });

    // Play
    await this.audio.play();
    // Re-apply after play() — some browsers reset during load
    this.audio.playbackRate = this.playbackRate;
    return true;
  }

  /**
   * Play audio (from URL or IndexedDB pre-generated cache)
   * @param audioId Audio ID
   * @param audioUrl Optional server-generated audio URL (takes priority over IndexedDB)
   * @returns true if audio started playing, false if no audio (TTS disabled or not generated)
   */
  public async play(audioId: string, audioUrl?: string): Promise<boolean> {
    try {
      return await this.playInternal(audioId, audioUrl);
    } catch (error) {
      // On mobile WebViews, Audio.play() may be blocked by autoplay policy.
      // Queue the request for retry after user gesture unlocks the audio context.
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        log.warn('Audio autoplay blocked — queuing for unlock');
        // Only queue one pending request at a time
        if (this.pendingPlay) {
          this.pendingPlay.reject(new Error('Superseded by newer play request'));
        }
        return new Promise<boolean>((resolve, reject) => {
          this.pendingPlay = { audioId, audioUrl, resolve, reject };
        });
      }
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Pause playback
   */
  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  /**
   * Stop playback
   */
  public stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    // Cancel any pending play request blocked by autoplay policy
    if (this.pendingPlay) {
      this.pendingPlay.reject(new DOMException('Playback stopped', 'AbortError'));
      this.pendingPlay = null;
    }
    // Note: onEndedCallback intentionally NOT cleared here because play()
    // calls stop() internally — clearing would break the callback chain.
    // Stale callbacks are harmless: engine mode check prevents processNext().
  }

  /**
   * Resume playback
   */
  public resume(): void {
    if (this.audio?.paused) {
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch((error) => {
        log.error('Failed to resume audio:', error);
      });
    }
  }

  /**
   * Get current playback status (actively playing, not paused)
   */
  public isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  /**
   * Whether there is a play request blocked by autoplay policy, awaiting unlock.
   */
  public hasPendingPlay(): boolean {
    return this.pendingPlay !== null;
  }

  /**
   * Cancel any pending autoplay-blocked play request without stopping active audio.
   */
  public cancelPendingPlay(): void {
    if (this.pendingPlay) {
      this.pendingPlay.reject(new DOMException('Playback cancelled', 'AbortError'));
      this.pendingPlay = null;
    }
  }

  /**
   * Whether there is active audio (playing or paused, but not ended)
   * Used to decide whether to resume playback or skip to the next line
   */
  public hasActiveAudio(): boolean {
    return this.audio !== null;
  }

  /**
   * Get current playback time (milliseconds)
   */
  public getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  /**
   * Get audio duration (milliseconds)
   */
  public getDuration(): number {
    return this.audio && !isNaN(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  /**
   * Set playback ended callback
   */
  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  /**
   * Set mute state (takes effect immediately on currently playing audio)
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
  }

  /**
   * Set volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * Set playback speed (takes effect immediately on currently playing audio)
   */
  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.audio) {
      this.audio.playbackRate = this.playbackRate;
    }
  }

  /**
   * Destroy the player
   */
  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
    for (const blobUrl of this.blobUrlCache.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.blobUrlCache.clear();
  }
}

/**
 * Create an audio player instance
 */
export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}
