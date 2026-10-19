/**
 * Real Chromium + FFmpeg pipeline. Runs only when RENDER_TESTS=1 (the server
 * has both installed; CI does not download browsers).
 */
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildDocument } from '../src/creative/templates';
import { renderFontSources } from '../src/creative/fonts';
import { documentToHtml } from '../src/creative/html';
import { closeBrowser, encodeVariants, renderHtml } from '../src/render';
import { createVideoProject, generateVideoScript, renderVideoProject, setVideoRenderDispatcher, updateVideoScene } from '../src/services/video';
import { ctxFor, twoBrandFixture } from './helpers';

const enabled = process.env.RENDER_TESTS === '1';

describe.skipIf(!enabled)('Chromium rendering', () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it('renders Hebrew typography to a PNG of the requested size and reports overflow', async () => {
    const kit = { colors: { primary: '#0f172a' }, fonts: { heading: 'Heebo', body: 'Assistant' }, logoMediaId: null };
    const doc = buildDocument({ aspect: 'R1X1', copy: { headline: 'אחסון אתרים מהיר ומאובטח בישראל', subheadline: 'גיבוי יומי ותמיכה בעברית', cta: 'דברו איתנו' }, kit, template: 'bold' });
    const html = documentToHtml(doc, { mode: 'render', images: {}, fontSrc: renderFontSources() });
    const result = await renderHtml(html, { width: doc.width, height: doc.height });
    const meta = await sharp(result.png).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
    expect(result.warnings.filter((w) => w.kind === 'font_missing')).toEqual([]);
    expect(result.fitted.headline).toBeGreaterThan(30);
    const { jpg, webp } = await encodeVariants(result.png);
    expect(jpg.length).toBeGreaterThan(1000);
    expect(webp.length).toBeGreaterThan(1000);

    // A headline that cannot fit even at the minimum size is reported, never silently clipped.
    const overflow = { ...doc, layers: doc.layers.map((l) => (l.type === 'text' && l.role === 'headline' ? { ...l, text: 'מילה '.repeat(120), box: { ...l.box, h: 6 } } : l)) };
    const r2 = await renderHtml(documentToHtml(overflow, { mode: 'render', images: {}, fontSrc: renderFontSources() }), { width: doc.width, height: doc.height });
    expect(r2.warnings.some((w) => w.kind === 'overflow' && w.layer === 'headline')).toBe(true);
  }, 120_000);

  it('assembles a short MP4 with narration (mock TTS) and burnt-in subtitles', async () => {
    setVideoRenderDispatcher(async () => undefined);
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const project = await createVideoProject(ctx, { title: 'בדיקה', aspect: 'R1X1', voice: 'alloy' });
    const { scenes } = await generateVideoScript(ctx, project.id, { sceneCount: 2, targetSeconds: 10 });
    await updateVideoScene(ctx, scenes[0]!.id, { narration: 'שלום, זו בדיקה קצרה', onScreenText: 'בדיקה', visualKind: 'CARD' });
    const rendered = await renderVideoProject(ctx, project.id, { renderHtml, encodeVariants });
    expect(rendered.status).toBe('READY');
    expect(rendered.outputMediaId).toBeTruthy();
    expect(rendered.durationMs).toBeGreaterThan(1500);
    expect(rendered.subtitlesSrt).toContain('-->');
    const output = await ctx.db.mediaAsset.findUnique({ where: { id: rendered.outputMediaId! } });
    expect(output?.mimeType).toBe('video/mp4');
    expect(output?.sizeBytes).toBeGreaterThan(10_000);
    setVideoRenderDispatcher(null);
  }, 300_000);
});

describe.skipIf(!enabled)('motion video pipeline (Chromium + FFmpeg, mock clip providers)', () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it('renders stills with motion, a library video, an AI clip and a talking character — and re-uses caches on re-render', async () => {
    setVideoRenderDispatcher(async () => undefined);
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { ffmpeg, probeMedia } = await import('../src/media/ffmpeg');
    const { uploadMedia } = await import('../src/services/media');
    const { createCharacter } = await import('../src/services/characters');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mm-test-'));
    try {
      // A 3-second library clip with its own audio.
      const clipFile = path.join(dir, 'lib.mp4');
      await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipFile]);
      const libVideo = await uploadMedia(ctx, { data: await readFile(clipFile), originalName: 'lib.mp4', mimeType: 'video/mp4' });
      const face = await sharp({ create: { width: 512, height: 768, channels: 3, background: '#3b82f6' } }).png().toBuffer();
      const faceAsset = await uploadMedia(ctx, { data: face, originalName: 'robot.png', mimeType: 'image/png' });
      const robot = await createCharacter(ctx, { name: 'רובי', description: 'blue robot', imageMediaId: faceAsset.id, voice: 'nova' });

      const musicFile = path.join(dir, 'music.mp3');
      await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-c:a', 'libmp3lame', '-q:a', '6', musicFile]);
      const musicAsset = await uploadMedia(ctx, { data: await readFile(musicFile), originalName: 'music.mp3', mimeType: 'audio/mpeg' });
      const project = await createVideoProject(ctx, { title: 'רילס תנועה', aspect: 'R9X16', voice: 'alloy' });
      const { updateVideoSettings } = await import('../src/services/video');
      await updateVideoSettings(ctx, project.id, { voice: 'alloy', motionStills: true, videoTier: 'balanced', ambientAudio: true, transitions: true, musicMediaId: musicAsset.id, musicVolume: 18 });
      const { scenes } = await generateVideoScript(ctx, project.id, { sceneCount: 2, targetSeconds: 10 });
      await updateVideoScene(ctx, scenes[0]!.id, { narration: 'מעבירים אתר? בקלות ובמהירות', onScreenText: 'מעבירים אתר?', visualKind: 'MEDIA_VIDEO', mediaId: libVideo.id });
      await updateVideoScene(ctx, scenes[1]!.id, { narration: 'שלום, אני רובי מהצוות', onScreenText: 'רובי', visualKind: 'AVATAR', characterId: robot.id });
      const { db } = await import('@mm/db');
      const third = await db.videoScene.create({ data: { brandId: brandA.id, projectId: project.id, order: 3, narration: 'שרתים מהירים בענן', onScreenText: 'ענן', visualKind: 'AI_VIDEO', visualPrompt: 'futuristic data center', motionPrompt: 'slow dolly-in' } });
      await db.videoScene.create({ data: { brandId: brandA.id, projectId: project.id, order: 4, narration: 'דברו איתנו היום', onScreenText: 'דברו איתנו', visualKind: 'CARD' } });

      const rendered = await renderVideoProject(ctx, project.id, { renderHtml, encodeVariants });
      expect(rendered.status).toBe('READY');
      const out = await db.mediaAsset.findUnique({ where: { id: rendered.outputMediaId! } });
      const outFile = path.join(dir, 'out.mp4');
      const { openMediaObject } = await import('../src/services/media');
      const { createWriteStream } = await import('node:fs');
      const { pipeline } = await import('node:stream/promises');
      await pipeline((await openMediaObject(ctx, out!.id)).object.body, createWriteStream(outFile));
      const info = await probeMedia(outFile);
      if (process.env.KEEP_RENDER_OUTPUT) await (await import('node:fs/promises')).copyFile(outFile, process.env.KEEP_RENDER_OUTPUT);
      expect(info.hasVideo && info.hasAudio).toBe(true);
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1920);
      const after = await db.videoScene.findMany({ where: { projectId: project.id }, orderBy: { order: 'asc' } });
      // Scenes overlap by the 350 ms cross-fade.
      const total = after.reduce((n, s) => n + (s.durationMs ?? 0), 0) - (after.length - 1) * 350;
      expect(Math.abs(info.durationMs - total)).toBeLessThan(300);
      expect(after[1]!.clipMediaId).toBeTruthy(); // avatar clip stored
      expect(after.find((s) => s.id === third.id)!.clipMediaId).toBeTruthy(); // AI clip stored
      expect(after.every((s) => s.renderedImageId)).toBe(true);

      // Re-render without changes: narration, images and clips all come from the caches.
      const runsBefore = await db.aiRun.count({ where: { brandId: brandA.id } });
      const again = await renderVideoProject(ctx, project.id, { renderHtml, encodeVariants });
      expect(again.status).toBe('READY');
      expect(await db.aiRun.count({ where: { brandId: brandA.id } })).toBe(runsBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
      setVideoRenderDispatcher(null);
    }
  }, 600_000);
});
