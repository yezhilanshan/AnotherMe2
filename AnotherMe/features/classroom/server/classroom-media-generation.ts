/**
 * Server-side media and TTS generation for classrooms.
 *
 * Generates image/video files and TTS audio for a classroom,
 * writes them to disk, and returns serving URL mappings.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { generateImage } from '@/lib/media/image-providers';
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_VOICES, DEFAULT_TTS_MODELS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { isMediaPlaceholder } from '@/lib/store/media-generation';
import {
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
  resolveImageApiKey,
  resolveImageBaseUrl,
  resolveVideoApiKey,
  resolveVideoBaseUrl,
  resolveTTSApiKey,
  resolveTTSBaseUrl,
} from '@/lib/server/provider-config';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { ImageProviderId } from '@/lib/media/types';
import type { VideoProviderId } from '@/lib/media/types';
import type { TTSProviderId } from '@/lib/audio/types';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';

const log = createLogger('ClassroomMedia');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const DOWNLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB
const PROGRESS_HEARTBEAT_MS = 60_000;

interface MediaProgress {
  completed: number;
  total: number;
  message: string;
}

interface TTSCandidate {
  providerId: TTSProviderId;
  apiKey: string;
  baseUrl?: string;
  voice: string;
  modelId: string;
  format: string;
}

async function withProgressHeartbeat<T>(
  task: () => Promise<T>,
  onHeartbeat?: () => Promise<void> | void,
): Promise<T> {
  if (!onHeartbeat) return task();

  let heartbeatInFlight = false;
  const timer = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void Promise.resolve(onHeartbeat()).finally(() => {
      heartbeatInFlight = false;
    });
  }, PROGRESS_HEARTBEAT_MS);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const validSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (validSignals.length === 0) return undefined;
  if (validSignals.length === 1) return validSignals[0];
  return AbortSignal.any(validSignals);
}

async function downloadToBuffer(url: string, abortSignal?: AbortSignal): Promise<Buffer> {
  const resp = await fetch(url, {
    signal: combineAbortSignals(abortSignal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)),
  });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > DOWNLOAD_MAX_SIZE) {
    throw new Error(`File too large: ${contentLength} bytes (max ${DOWNLOAD_MAX_SIZE})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

function mediaServingUrl(baseUrl: string, classroomId: string, subPath: string): string {
  return `${baseUrl}/api/classroom-media/${classroomId}/${subPath}`;
}

function getUsableServerTTSCandidates(): TTSCandidate[] {
  return Object.keys(getServerTTSProviders())
    .filter((id) => id !== 'browser-native-tts')
    .map((id): TTSCandidate | null => {
      const providerId = id as TTSProviderId;
      const provider = TTS_PROVIDERS[providerId];
      if (!provider) return null;

      const apiKey = resolveTTSApiKey(providerId);
      if (provider.requiresApiKey && !apiKey) return null;

      return {
        providerId,
        apiKey,
        baseUrl: resolveTTSBaseUrl(providerId) || provider.defaultBaseUrl,
        voice: DEFAULT_TTS_VOICES[providerId] || 'default',
        modelId: DEFAULT_TTS_MODELS[providerId] || provider.defaultModelId || '',
        format: provider.supportedFormats?.[0] || 'mp3',
      };
    })
    .filter((candidate): candidate is TTSCandidate => Boolean(candidate));
}

// ---------------------------------------------------------------------------
// Image / Video generation
// ---------------------------------------------------------------------------

export async function generateMediaForClassroom(
  outlines: SceneOutline[],
  classroomId: string,
  baseUrl: string,
  options?: {
    enableImageGeneration?: boolean;
    enableVideoGeneration?: boolean;
    abortSignal?: AbortSignal;
    onProgress?: (progress: MediaProgress) => Promise<void> | void;
  },
): Promise<Record<string, string>> {
  const mediaDir = path.join(CLASSROOMS_DIR, classroomId, 'media');
  await ensureDir(mediaDir);

  // Collect all media generation requests from outlines
  const requests = outlines.flatMap((o) => o.mediaGenerations ?? []);
  if (requests.length === 0) return {};

  // Resolve providers
  const imageProviderIds = Object.keys(getServerImageProviders());
  const videoProviderIds = Object.keys(getServerVideoProviders());

  const mediaMap: Record<string, string> = {};

  // Separate image and video requests, generate each type sequentially
  // but run the two types in parallel (providers often have limited concurrency).
  const imageEnabled = options?.enableImageGeneration ?? true;
  const videoEnabled = options?.enableVideoGeneration ?? true;
  const imageRequests = requests.filter(
    (r) => imageEnabled && r.type === 'image' && imageProviderIds.length > 0,
  );
  const videoRequests = requests.filter(
    (r) => videoEnabled && r.type === 'video' && videoProviderIds.length > 0,
  );
  const totalRequests = imageRequests.length + videoRequests.length;
  let completedRequests = 0;

  const reportProgress = async (message: string) => {
    await options?.onProgress?.({
      completed: completedRequests,
      total: totalRequests,
      message,
    });
  };

  const generateImages = async () => {
    for (const req of imageRequests) {
      options?.abortSignal?.throwIfAborted();
      try {
        await reportProgress(`Generating image for ${req.elementId}`);
        const providerId = imageProviderIds[0] as ImageProviderId;
        const apiKey = resolveImageApiKey(providerId);
        if (!apiKey) {
          log.warn(`No API key for image provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        const providerConfig = IMAGE_PROVIDERS[providerId];
        const model = providerConfig?.models?.[0]?.id;

        const result = await withProgressHeartbeat(
          () =>
            generateImage(
              { providerId, apiKey, baseUrl: resolveImageBaseUrl(providerId), model },
              { prompt: req.prompt, aspectRatio: req.aspectRatio || '16:9' },
            ),
          () => reportProgress(`Still generating image for ${req.elementId}`),
        );

        let buf: Buffer;
        let ext: string;
        if (result.base64) {
          buf = Buffer.from(result.base64, 'base64');
          ext = 'png';
        } else if (result.url) {
          buf = await downloadToBuffer(result.url, options?.abortSignal);
          const urlExt = path.extname(new URL(result.url).pathname).replace('.', '');
          ext = ['png', 'jpg', 'jpeg', 'webp'].includes(urlExt) ? urlExt : 'png';
        } else {
          log.warn(`Image generation returned no data for ${req.elementId}`);
          continue;
        }

        const filename = `${req.elementId}.${ext}`;
        await fs.writeFile(path.join(mediaDir, filename), buf);
        mediaMap[req.elementId] = mediaServingUrl(baseUrl, classroomId, `media/${filename}`);
        log.info(`Generated image: ${filename}`);
      } catch (err) {
        log.warn(`Image generation failed for ${req.elementId}:`, err);
      } finally {
        completedRequests += 1;
        await reportProgress(`Generated ${completedRequests}/${totalRequests} media files`);
      }
    }
  };

  const generateVideos = async () => {
    for (const req of videoRequests) {
      options?.abortSignal?.throwIfAborted();
      try {
        await reportProgress(`Generating video for ${req.elementId}`);
        const providerId = videoProviderIds[0] as VideoProviderId;
        const apiKey = resolveVideoApiKey(providerId);
        if (!apiKey) {
          log.warn(`No API key for video provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        const providerConfig = VIDEO_PROVIDERS[providerId];
        const model = providerConfig?.models?.[0]?.id;

        const normalized = normalizeVideoOptions(providerId, {
          prompt: req.prompt,
          aspectRatio: (req.aspectRatio as '16:9' | '4:3' | '1:1' | '9:16') || '16:9',
        });

        const result = await withProgressHeartbeat(
          () =>
            generateVideo(
              { providerId, apiKey, baseUrl: resolveVideoBaseUrl(providerId), model },
              normalized,
            ),
          () => reportProgress(`Still generating video for ${req.elementId}`),
        );

        const buf = await downloadToBuffer(result.url, options?.abortSignal);
        const filename = `${req.elementId}.mp4`;
        await fs.writeFile(path.join(mediaDir, filename), buf);
        mediaMap[req.elementId] = mediaServingUrl(baseUrl, classroomId, `media/${filename}`);
        log.info(`Generated video: ${filename}`);
      } catch (err) {
        log.warn(`Video generation failed for ${req.elementId}:`, err);
      } finally {
        completedRequests += 1;
        await reportProgress(`Generated ${completedRequests}/${totalRequests} media files`);
      }
    }
  };

  await Promise.all([generateImages(), generateVideos()]);

  return mediaMap;
}

// ---------------------------------------------------------------------------
// Placeholder replacement in scene content
// ---------------------------------------------------------------------------

export function replaceMediaPlaceholders(scenes: Scene[], mediaMap: Record<string, string>): void {
  if (Object.keys(mediaMap).length === 0) return;

  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
      scene.content as {
        canvas?: { elements?: Array<{ id: string; src?: string; type?: string }> };
      }
    )?.canvas;
    if (!canvas?.elements) continue;

    for (const el of canvas.elements) {
      if (
        (el.type === 'image' || el.type === 'video') &&
        typeof el.src === 'string' &&
        isMediaPlaceholder(el.src) &&
        mediaMap[el.src]
      ) {
        el.src = mediaMap[el.src];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TTS generation
// ---------------------------------------------------------------------------

export async function generateTTSForClassroom(
  scenes: Scene[],
  classroomId: string,
  baseUrl: string,
  options?: {
    abortSignal?: AbortSignal;
    onProgress?: (progress: MediaProgress) => Promise<void> | void;
  },
): Promise<void> {
  const audioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
  await ensureDir(audioDir);

  const ttsCandidates = getUsableServerTTSCandidates();
  if (ttsCandidates.length === 0) {
    log.warn('No usable server TTS provider configured, skipping TTS generation');
    return;
  }
  let activeProviderIndex = 0;

  for (const scene of scenes) {
    if (!scene.actions) continue;

    // Split long speech actions into multiple shorter ones before TTS generation,
    // mirroring the client-side approach. Each sub-action gets its own audio file.
    scene.actions = splitLongSpeechActions(
      scene.actions,
      ttsCandidates[activeProviderIndex].providerId,
    );
  }

  const speechActions = scenes.flatMap((scene) =>
    (scene.actions || []).filter(
      (action): action is SpeechAction =>
        action.type === 'speech' && Boolean((action as SpeechAction).text),
    ),
  );
  const totalRequests = speechActions.length;
  let completedRequests = 0;

  const reportProgress = async (message: string) => {
    await options?.onProgress?.({
      completed: completedRequests,
      total: totalRequests,
      message,
    });
  };

  for (const action of speechActions) {
    options?.abortSignal?.throwIfAborted();
    const speechAction = action as SpeechAction;
    const audioId = `tts_${action.id}`;

    try {
      await reportProgress(`Generating TTS ${completedRequests + 1}/${totalRequests}`);
      const orderedCandidates = [
        ttsCandidates[activeProviderIndex],
        ...ttsCandidates.filter((_, index) => index !== activeProviderIndex),
      ];
      let result: Awaited<ReturnType<typeof generateTTS>> | null = null;
      let usedCandidate: TTSCandidate | null = null;

      for (const candidate of orderedCandidates) {
        try {
          result = await withProgressHeartbeat(
            () =>
              generateTTS(
                {
                  providerId: candidate.providerId,
                  modelId: candidate.modelId,
                  apiKey: candidate.apiKey,
                  baseUrl: candidate.baseUrl,
                  voice: candidate.voice,
                  speed: speechAction.speed,
                  abortSignal: options?.abortSignal,
                },
                speechAction.text,
              ),
            () =>
              reportProgress(
                `Still generating TTS ${completedRequests + 1}/${totalRequests} with ${candidate.providerId}`,
              ),
          );
          usedCandidate = candidate;
          activeProviderIndex = ttsCandidates.indexOf(candidate);
          break;
        } catch (providerError) {
          log.warn(
            `TTS provider "${candidate.providerId}" failed for action ${action.id}:`,
            providerError,
          );
        }
      }

      if (!result || !usedCandidate) {
        throw new Error('All configured TTS providers failed');
      }

      const filename = `${audioId}.${usedCandidate.format}`;
      await fs.writeFile(path.join(audioDir, filename), result.audio);

      speechAction.audioId = audioId;
      speechAction.audioUrl = mediaServingUrl(baseUrl, classroomId, `audio/${filename}`);
      log.info(
        `Generated TTS: ${filename} (${result.audio.length} bytes, provider=${usedCandidate.providerId})`,
      );
    } catch (err) {
      log.warn(`TTS generation failed for action ${action.id}:`, err);
    } finally {
      completedRequests += 1;
      await reportProgress(`Generated ${completedRequests}/${totalRequests} TTS audio files`);
    }
  }
}
