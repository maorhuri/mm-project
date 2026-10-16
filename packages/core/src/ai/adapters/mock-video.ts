/**
 * Clearly-labelled MOCK video / avatar adapters (tests and non-production only).
 * They produce real MP4 files with FFmpeg so the whole pipeline can be exercised
 * without spending money: a slow zoom over the start image (or a test pattern)
 * with a "MOCK" caption, and for avatars the still character with the narration.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fontsDir } from '../../creative/fonts';
import { FPS, escapeFilterPath, ffmpeg } from '../../media/ffmpeg';
import { snapDuration } from '../catalog';
import type { ModelSpec } from '../catalog';
import type { AvatarAdapter, TalkingAvatarRequest, VideoAdapter, VideoAspect, VideoClipRequest, VideoClipResult, VideoJobOptions } from '../types';

function sizeFor(aspect: VideoAspect): { w: number; h: number } {
  return aspect === '9:16' ? { w: 720, h: 1280 } : aspect === '16:9' ? { w: 1280, h: 720 } : { w: 960, h: 960 };
}

function mockLabel(): string {
  const dir = fontsDir();
  const font = dir ? `:fontfile='${escapeFilterPath(path.join(dir, 'Heebo.ttf'))}'` : '';
  return `drawtext=text='MOCK VIDEO'${font}:fontsize=42:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=14:x=(w-text_w)/2:y=h*0.08`;
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mm-mock-video-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class MockVideoAdapter implements VideoAdapter {
  readonly provider = 'google' as const;
  readonly isMock = true;
  async generate(spec: ModelSpec, req: VideoClipRequest, opts?: VideoJobOptions): Promise<VideoClipResult> {
    const started = Date.now();
    const seconds = snapDuration(spec, req.seconds);
    const { w, h } = sizeFor(req.aspect);
    const frames = seconds * FPS;
    opts?.onProgress?.(10, 'mock');
    const video = await withTmp(async (dir) => {
      const out = path.join(dir, 'clip.mp4');
      if (req.image) {
        const img = path.join(dir, `start.${req.image.mimeType.includes('png') ? 'png' : 'jpg'}`);
        await writeFile(img, req.image.data);
        await ffmpeg(['-i', img, '-vf', `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='1+0.1*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS},${mockLabel()},format=yuv420p`, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'ultrafast', '-an', out]);
      } else {
        await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${FPS}:duration=${seconds}`, '-vf', `${mockLabel()},format=yuv420p`, '-c:v', 'libx264', '-preset', 'ultrafast', '-an', out]);
      }
      return readFile(out);
    });
    opts?.onProgress?.(100, 'mock');
    return { video, mimeType: 'video/mp4', seconds, hasAudio: false, modelId: `${spec.modelId} (mock)`, jobId: null, latencyMs: Date.now() - started };
  }
}

export class MockAvatarAdapter implements AvatarAdapter {
  readonly provider = 'google' as const;
  readonly isMock = true;
  async generate(spec: ModelSpec, req: TalkingAvatarRequest, opts?: VideoJobOptions): Promise<VideoClipResult> {
    const started = Date.now();
    const { w, h } = sizeFor(req.aspect);
    const seconds = Math.max(1, req.audio.durationMs / 1000);
    const frames = Math.ceil(seconds * FPS);
    opts?.onProgress?.(10, 'mock');
    const video = await withTmp(async (dir) => {
      const img = path.join(dir, `face.${req.image.mimeType.includes('png') ? 'png' : 'jpg'}`);
      const audio = path.join(dir, `voice.${req.audio.mimeType.includes('wav') ? 'wav' : 'mp3'}`);
      const out = path.join(dir, 'avatar.mp4');
      await writeFile(img, req.image.data);
      await writeFile(audio, req.audio.data);
      await ffmpeg([
        '-i', img, '-i', audio,
        '-filter_complex', `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='1+0.04*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS},${mockLabel()},format=yuv420p[v]`,
        '-map', '[v]', '-map', '1:a', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', out,
      ]);
      return readFile(out);
    });
    opts?.onProgress?.(100, 'mock');
    return { video, mimeType: 'video/mp4', seconds, hasAudio: true, modelId: `${spec.modelId} (mock)`, jobId: null, latencyMs: Date.now() - started };
  }
}
