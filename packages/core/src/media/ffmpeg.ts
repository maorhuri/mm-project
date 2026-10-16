/**
 * FFmpeg / ffprobe helpers shared by the video pipeline and the mock video
 * adapters. Arguments are always passed as an argv array (never a shell), and
 * filter-graph paths are escaped, so file names cannot inject options.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const FPS = 25;

export async function ffmpeg(args: string[], timeoutMs = 10 * 60_000): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: string };
    if (e.code === 'ENOENT') throw new Error('ffmpeg is not installed on the worker host');
    throw new Error(`ffmpeg failed: ${(e.stderr ?? e.message ?? '').toString().trim().slice(-800)}`);
  }
}

export interface ProbeInfo {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
}

export async function probeMedia(file: string): Promise<ProbeInfo> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }));
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === 'ENOENT') throw new Error('ffprobe is not installed on the worker host');
    throw new Error(`ffprobe failed: ${(e.stderr ?? e.message ?? '').toString().trim().slice(-300)}`);
  }
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
  const streams = j.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const seconds = Number(j.format?.duration);
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
    hasVideo: Boolean(video),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

export async function ffprobeDurationMs(file: string): Promise<number> {
  const info = await probeMedia(file);
  if (info.durationMs <= 0) throw new Error('ffprobe: could not read the media duration');
  return info.durationMs;
}

/** Escape a path for use inside an FFmpeg filter-graph option value. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

// ---------------------------------------------------------------------------
// Scene composition
// ---------------------------------------------------------------------------

export type ClipFit = { mode: 'trim' } | { mode: 'freeze'; padSec: number } | { mode: 'slow'; factor: number } | { mode: 'loop' };

/**
 * How a clip of `clipMs` fills a scene of `targetMs`: trim when long enough,
 * freeze the last frame for short gaps, gentle slow-motion up to 1.6×, loop otherwise.
 */
export function planClipFit(clipMs: number, targetMs: number): ClipFit {
  if (clipMs <= 0) return { mode: 'loop' };
  if (clipMs >= targetMs) return { mode: 'trim' };
  const gap = targetMs - clipMs;
  if (gap <= 2_500) return { mode: 'freeze', padSec: Math.round(gap) / 1000 };
  const factor = targetMs / clipMs;
  if (factor <= 1.6) return { mode: 'slow', factor: Math.round(factor * 1000) / 1000 };
  return { mode: 'loop' };
}

export type StillMotion = 'none' | 'zoom-in' | 'zoom-out';

export type SceneBackground =
  | { kind: 'still'; file: string; motion: StillMotion }
  | { kind: 'clip'; file: string; clipMs: number; hasAudio: boolean; audio: 'narration' | 'mix' | 'clip' };

export interface SceneComposeSpec {
  width: number;
  height: number;
  /** Scene length (narration + tail). */
  durationMs: number;
  background: SceneBackground;
  /** Transparent PNG with text / logo / legibility gradient; null = none. */
  overlayFile: string | null;
  narrationFile: string;
  output: string;
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart'];

/** Pure: the ffmpeg argv that renders one scene (exported for tests). */
export function sceneFfmpegArgs(spec: SceneComposeSpec): string[] {
  const { width: W, height: H } = spec;
  const D = (spec.durationMs / 1000).toFixed(3);
  const frames = Math.max(1, Math.round((spec.durationMs / 1000) * FPS));
  const args: string[] = [];
  const filters: string[] = [];
  const bg = spec.background;

  if (bg.kind === 'still') {
    if (bg.motion === 'none') {
      args.push('-loop', '1', '-framerate', String(FPS), '-t', D, '-i', bg.file);
      filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}[bg]`);
    } else {
      // Ken Burns: zoom on a 2× upscale so sub-pixel motion stays smooth.
      const z = bg.motion === 'zoom-in' ? `1+0.07*on/${frames}` : `1.07-0.07*on/${frames}`;
      args.push('-i', bg.file);
      filters.push(
        `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1[bg]`,
      );
    }
  } else {
    const fit = planClipFit(bg.clipMs, spec.durationMs);
    if (fit.mode === 'loop') args.push('-stream_loop', '-1');
    args.push('-i', bg.file);
    const slow = fit.mode === 'slow' ? `,setpts=${fit.factor}*PTS` : '';
    const freeze = fit.mode === 'freeze' ? `,tpad=stop_mode=clone:stop_duration=${fit.padSec.toFixed(3)}` : '';
    filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1${slow},fps=${FPS}${freeze}[bg]`);
  }

  let videoLabel = 'bg';
  let next = 1;
  if (spec.overlayFile) {
    args.push('-i', spec.overlayFile);
    filters.push(`[bg][${next}:v]overlay=0:0:eof_action=repeat:format=auto[ov]`);
    videoLabel = 'ov';
    next += 1;
  }
  filters.push(`[${videoLabel}]format=yuv420p[v]`);

  args.push('-i', spec.narrationFile);
  const narrationIdx = next;
  if (bg.kind === 'clip' && bg.hasAudio && bg.audio === 'clip') {
    filters.push(`[0:a]aresample=44100,apad[a]`);
  } else if (bg.kind === 'clip' && bg.hasAudio && bg.audio === 'mix') {
    filters.push(`[${narrationIdx}:a]aresample=44100,apad[nar]`, `[0:a]aresample=44100,volume=0.18,apad[amb]`, `[nar][amb]amix=inputs=2:duration=first:normalize=0[a]`);
  } else {
    filters.push(`[${narrationIdx}:a]aresample=44100,apad[a]`);
  }

  return [...args, '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-t', D, ...ENCODE, spec.output];
}

export async function composeScene(spec: SceneComposeSpec): Promise<void> {
  await ffmpeg(sceneFfmpegArgs(spec));
}

/** Grab one JPEG frame (for scene thumbnails). */
export async function extractFrame(input: string, atSec: number, output: string): Promise<void> {
  await ffmpeg(['-ss', atSec.toFixed(2), '-i', input, '-frames:v', '1', '-q:v', '3', output], 60_000);
}
