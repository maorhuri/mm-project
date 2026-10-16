/**
 * Real motion-clip and talking-avatar adapters. Every call is an async job:
 * submit → poll (reporting progress) → download the MP4 bytes. Model ids and
 * capabilities come from the verified catalog (ModelSpec), never from literals here.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI, VideoGenerationReferenceType } from '@google/genai';
import sharp from 'sharp';
import { snapDuration } from '../catalog';
import type { AiProviderId, ModelSpec } from '../catalog';
import { AiProviderError } from '../types';
import type { AvatarAdapter, TalkingAvatarRequest, VideoAdapter, VideoClipRequest, VideoClipResult, VideoJobOptions } from '../types';

const POLL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });
}

function googleError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = status === 429 || status === 503 || (typeof status === 'number' && status >= 500);
  return new AiProviderError('google', `Google Veo: ${message.slice(0, 400)}`, { status: status === 429 ? 429 : 502, retryable });
}

/** Veo renders 16:9 or 9:16 only; square / 4:5 projects use 9:16 and are centre-cropped downstream. */
function veoAspect(aspect: VideoClipRequest['aspect']): '16:9' | '9:16' {
  return aspect === '16:9' ? '16:9' : '9:16';
}

/** Centre-crop a start image to the exact output aspect so the model never pads it with bars. */
async function cropToAspect(image: { data: Buffer; mimeType: string }, aspect: '16:9' | '9:16'): Promise<{ data: Buffer; mimeType: string }> {
  const target = aspect === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const data = await sharp(image.data, { failOn: 'error' }).resize({ ...target, fit: 'cover', position: 'attention' }).png().toBuffer();
  return { data, mimeType: 'image/png' };
}

export class GoogleVeoAdapter implements VideoAdapter {
  readonly provider = 'google' as const;
  readonly isMock = false;
  private readonly client: GoogleGenAI;
  constructor(private readonly apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(spec: ModelSpec, req: VideoClipRequest, opts: VideoJobOptions = {}): Promise<VideoClipResult> {
    const started = Date.now();
    const seconds = snapDuration(spec, req.seconds);
    const useRefs = !req.image && (req.referenceImages?.length ?? 0) > 0 && (spec.capabilities.referenceImages ?? 0) > 0;
    try {
      const start = req.image ? await cropToAspect(req.image, veoAspect(req.aspect)) : null;
      let op = await this.client.models.generateVideos({
        model: spec.modelId,
        prompt: req.prompt,
        ...(start ? { image: { imageBytes: start.data.toString('base64'), mimeType: start.mimeType } } : {}),
        config: {
          numberOfVideos: 1,
          aspectRatio: veoAspect(req.aspect),
          durationSeconds: seconds,
          ...(req.resolution && (spec.capabilities.resolutions ?? []).includes(req.resolution) ? { resolution: req.resolution } : {}),
          ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
          ...(useRefs
            ? {
                referenceImages: req.referenceImages!.slice(0, spec.capabilities.referenceImages).map((img) => ({
                  image: { imageBytes: img.data.toString('base64'), mimeType: img.mimeType },
                  referenceType: VideoGenerationReferenceType.ASSET,
                })),
              }
            : {}),
        },
      });
      const deadline = started + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      let polls = 0;
      while (!op.done) {
        if (Date.now() > deadline) throw new AiProviderError('google', 'Google Veo: generation timed out', { retryable: false });
        await sleep(POLL_MS, opts.signal);
        polls += 1;
        op = await this.client.operations.getVideosOperation({ operation: op });
        // Veo reports no percentage; show time-based progress that never reaches 100 before completion.
        opts.onProgress?.(Math.min(90, Math.round((polls * POLL_MS) / 1800)), 'generating');
      }
      if (op.error) {
        const msg = typeof op.error.message === 'string' ? op.error.message : JSON.stringify(op.error).slice(0, 300);
        throw new AiProviderError('google', `Google Veo: ${msg}`, { retryable: false });
      }
      const generated = op.response?.generatedVideos?.[0]?.video;
      if (!generated) {
        const reasons = op.response?.raiMediaFilteredReasons?.join('; ');
        throw new AiProviderError('google', `Google Veo: no video returned${reasons ? ` — blocked by safety filters: ${reasons}` : ''}`, { retryable: false });
      }
      let video: Buffer;
      if (generated.videoBytes) {
        video = Buffer.from(generated.videoBytes, 'base64');
      } else {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'mm-veo-'));
        try {
          const file = path.join(dir, 'clip.mp4');
          await this.client.files.download({ file: generated, downloadPath: file });
          video = await readFile(file);
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      if (video.length < 1000) throw new AiProviderError('google', 'Google Veo: downloaded video is empty', { retryable: true });
      opts.onProgress?.(100, 'done');
      return {
        video,
        mimeType: generated.mimeType ?? 'video/mp4',
        seconds,
        hasAudio: Boolean(spec.capabilities.nativeAudio),
        modelId: spec.modelId,
        jobId: op.name ?? null,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw googleError(err);
    }
  }
}

export function realVideoAdapter(provider: AiProviderId, apiKey: string): VideoAdapter {
  switch (provider) {
    case 'google':
      return new GoogleVeoAdapter(apiKey);
    default:
      throw new AiProviderError(provider, `${provider}: video generation is not supported by this provider`, { status: 400 });
  }
}

export function realAvatarAdapter(provider: AiProviderId, apiKey: string): AvatarAdapter {
  void apiKey;
  throw new AiProviderError(provider, `${provider}: talking avatars are not supported by this provider`, { status: 400 });
}

export type { TalkingAvatarRequest };
