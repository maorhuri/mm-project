import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors';
import { createProduct } from '../src/services/brands';
import { uploadMedia } from '../src/services/media';
import { createCharacter } from '../src/services/characters';
import { assembleArgs, effectiveDurations, planClipFit, sceneFfmpegArgs } from '../src/media/ffmpeg';
import { splitForMotion } from '../src/creative/document';
import { buildDocument, buildReelOverlay, subtitleBand } from '../src/creative/templates';
import {
  buildSrt,
  clipCacheKey,
  createVideoProject,
  formatSrtTime,
  narrationVoice,
  renderConfigHash,
  ttsCacheKey,
  generateVideoScript,
  getVideoProject,
  listVideoProjects,
  requestVideoApproval,
  setVideoRenderDispatcher,
  splitCaption,
  startVideoRender,
  subtitleStyle,
  updateVideoScene,
} from '../src/services/video';
import { ctxFor, pngBuffer, twoBrandFixture } from './helpers';

describe('subtitles (pure)', () => {
  it('formats SRT timestamps', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(61_250)).toBe('00:01:01,250');
    expect(formatSrtTime(3_600_000 + 5)).toBe('01:00:00,005');
  });

  it('splits long narration into short caption chunks on punctuation and spaces', () => {
    const chunks = splitCaption('אחסון אתרים מהיר ומאובטח בישראל. גיבוי יומי, תמיכה בעברית ושרתים קרובים ללקוחות שלכם, כל זה במחיר הוגן.', 40);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    expect(chunks.join(' ')).toContain('גיבוי יומי');
    expect(splitCaption('   ')).toEqual([]);
  });

  it('builds a timed SRT covering every scene in order', () => {
    const srt = buildSrt([
      { narration: 'שלום לכולם', durationMs: 2000 },
      { narration: 'זהו משפט ארוך יותר שייחתך לשני חלקים, כדי שהכתוביות יהיו קריאות על המסך', durationMs: 6000 },
    ]);
    const cues = srt.trim().split('\n\n');
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues[0]).toContain('00:00:00,000 --> 00:00:01,960');
    expect(cues[1]).toMatch(/00:00:02,000 --> /);
    expect(srt).toContain('קריאות');
  });
});

describe('Video Studio services', () => {
  const dispatched: string[] = [];
  beforeEach(() => {
    dispatched.length = 0;
    setVideoRenderDispatcher(async (_ctx, projectId) => {
      dispatched.push(projectId);
    });
  });
  afterEach(() => setVideoRenderDispatcher(null));

  it('script (mock) → scene edits with QA → render queued → approval only when ready', async () => {
    const { owner, editor, brandA, brandB } = await twoBrandFixture();
    const ownerCtx = await ctxFor(owner, brandA.id);
    const ctx = await ctxFor(editor, brandA.id);
    const product = await createProduct(ownerCtx, { name: 'VPS', slug: 'vps', features: ['SSD'], priceFromIls: 99, isActive: true });
    const project = await createVideoProject(ctx, { title: 'סרטון VPS', goal: 'מודעות', productId: product.id, aspect: 'R9X16', voice: 'nova' });
    expect(project.status).toBe('DRAFT');

    await expect(startVideoRender(ctx, project.id)).rejects.toBeInstanceOf(ConflictError);

    const { scenes, run } = await generateVideoScript(ctx, project.id, { sceneCount: 4, targetSeconds: 30 });
    expect(run.isMock).toBe(true);
    expect(scenes).toHaveLength(2);
    const detail = await getVideoProject(ctx, project.id);
    expect(detail.project.status).toBe('SCRIPTED');
    expect((detail.project.qa as { status: string }).status).toBe('PASSED');
    expect(detail.estimate.characters).toBeGreaterThan(0);
    expect(detail.estimate.ttsIls).toBeGreaterThan(0);
    expect(detail.estimate.aiImages).toBe(0);

    // Invented price in narration → BLOCKED → render refused.
    const first = scenes[0]!;
    await updateVideoScene(ctx, first.id, { narration: 'VPS רק ב-19 ₪ לחודש', onScreenText: 'מבצע', visualKind: 'CARD' });
    const blocked = await getVideoProject(ctx, project.id);
    expect((blocked.project.qa as { status: string }).status).toBe('BLOCKED');
    await expect(startVideoRender(ctx, project.id)).rejects.toThrow(/חסמה/);

    // MEDIA scene needs an image from this brand.
    await expect(updateVideoScene(ctx, first.id, { narration: 'VPS מהיר', visualKind: 'MEDIA', mediaId: null })).rejects.toBeInstanceOf(ValidationError);
    const image = await uploadMedia(ownerCtx, { data: await pngBuffer(), originalName: 'a.png', mimeType: 'image/png' });
    await updateVideoScene(ctx, first.id, { narration: 'VPS מהיר החל מ-99 ₪', onScreenText: 'VPS', visualKind: 'MEDIA', mediaId: image.id });
    await updateVideoScene(ctx, scenes[1]!.id, { narration: 'דברו איתנו היום', onScreenText: 'דברו איתנו', visualKind: 'AI_IMAGE', visualPrompt: 'server room' });
    const ready = await getVideoProject(ctx, project.id);
    expect((ready.project.qa as { status: string }).status).toBe('PASSED');
    expect(ready.estimate.aiImages).toBe(1);
    expect(ready.estimate.imagesIls).toBeGreaterThan(0);

    const started = await startVideoRender(ctx, project.id);
    expect(started.status).toBe('RENDERING');
    expect(dispatched).toEqual([project.id]);
    await expect(startVideoRender(ctx, project.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(requestVideoApproval(ctx, project.id)).rejects.toBeInstanceOf(ConflictError);

    const ctxB = await ctxFor(owner, brandB.id);
    expect(await listVideoProjects(ctxB)).toEqual([]);
    expect((await listVideoProjects(ctx)).map((p) => p.sceneCount)).toEqual([2]);
    expect(ready.estimate.videoSeconds).toBe(0);
  });
});

describe('motion composition (pure)', () => {
  it('plans how a clip fills a scene: trim, freeze, slow-motion or loop', () => {
    expect(planClipFit(8000, 6500)).toEqual({ mode: 'trim' });
    expect(planClipFit(8000, 9200)).toEqual({ mode: 'freeze', padSec: 1.2 });
    expect(planClipFit(6000, 9000)).toEqual({ mode: 'slow', factor: 1.5 });
    expect(planClipFit(4000, 12000)).toEqual({ mode: 'loop' });
    expect(planClipFit(0, 5000)).toEqual({ mode: 'loop' });
  });

  it('builds FFmpeg arguments for stills with Ken Burns, clips with overlays and mixed ambience', () => {
    const still = sceneFfmpegArgs({ width: 1080, height: 1920, durationMs: 4000, background: { kind: 'still', file: '/tmp/bg.png', motion: 'zoom-in' }, overlayFile: '/tmp/ov.png', narrationFile: '/tmp/n.mp3', output: '/tmp/o.mp4' });
    const graph = still[still.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('zoompan=');
    expect(graph).toContain('d=100');
    expect(graph).toContain('overlay=0:0:eof_action=repeat');
    expect(still).toContain('-t');
    expect(still[still.indexOf('-t') + 1]).toBe('4.000');

    const clip = sceneFfmpegArgs({ width: 1080, height: 1920, durationMs: 9200, background: { kind: 'clip', file: '/tmp/c.mp4', clipMs: 8000, hasAudio: true, audio: 'mix' }, overlayFile: null, narrationFile: '/tmp/n.mp3', output: '/tmp/o.mp4' });
    const g2 = clip[clip.indexOf('-filter_complex') + 1]!;
    expect(g2).toContain('tpad=stop_mode=clone:stop_duration=1.200');
    expect(g2).toContain('amix=inputs=2');
    expect(g2).not.toContain('overlay');

    const loop = sceneFfmpegArgs({ width: 720, height: 720, durationMs: 15000, background: { kind: 'clip', file: '/tmp/c.mp4', clipMs: 4000, hasAudio: true, audio: 'clip' }, overlayFile: '/tmp/ov.png', narrationFile: '/tmp/n.mp3', output: '/tmp/o.mp4' });
    expect(loop.slice(0, 3)).toEqual(['-stream_loop', '-1', '-i']);
    expect(loop[loop.indexOf('-filter_complex') + 1]).toContain('[0:a]aresample=44100,apad[a]');
  });

  it('assembles scenes with cross-fades, subtitles and ducked music in one pass', () => {
    const { args, totalMs } = assembleArgs({
      scenes: [
        { file: '/tmp/s1.mp4', durationMs: 4000 },
        { file: '/tmp/s2.mp4', durationMs: 5000 },
        { file: '/tmp/s3.mp4', durationMs: 3000 },
      ],
      transitionMs: 350,
      subtitles: { file: "/tmp/it's.srt", fontsDir: '/fonts', style: 'FontName=Heebo,FontSize=15' },
      music: { file: '/tmp/m.mp3', volume: 18 },
      output: '/tmp/out.mp4',
    });
    expect(totalMs).toBe(12000 - 700);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('xfade=transition=fade:duration=0.350:offset=3.650[vx1]');
    expect(graph).toContain('xfade=transition=fade:duration=0.350:offset=8.300[vx2]');
    expect(graph).toContain('acrossfade=d=0.350');
    expect(graph).toContain("subtitles='/tmp/it\\'s.srt'");
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('volume=0.18');
    expect(args.slice(args.indexOf('/tmp/m.mp3') - 3, args.indexOf('/tmp/m.mp3') + 1)).toEqual(['-stream_loop', '-1', '-i', '/tmp/m.mp3']);
    expect(args[args.indexOf('-t') + 1]).toBe('11.300');
    expect(effectiveDurations([4000, 5000, 3000], 350)).toEqual([3650, 4650, 3000]);

    const cuts = assembleArgs({ scenes: [{ file: 'a', durationMs: 2000 }, { file: 'b', durationMs: 2000 }], transitionMs: 0, subtitles: null, music: null, output: 'o' });
    expect(cuts.totalMs).toBe(4000);
    expect(cuts.args[cuts.args.indexOf('-filter_complex') + 1]).toContain('concat=n=2:v=1:a=1');
    const single = assembleArgs({ scenes: [{ file: 'a', durationMs: 2000 }], transitionMs: 350, subtitles: null, music: null, output: 'o' });
    expect(single.totalMs).toBe(2000);
    expect(single.args[single.args.indexOf('-filter_complex') + 1]).not.toContain('xfade');
  });

  it('splits a template into a moving background and a static text/logo overlay', () => {
    const kit = { colors: { primary: '#123456' }, fonts: {}, logoMediaId: '0191f3a2-0000-7000-8000-000000000001' };
    const photo = buildDocument({ aspect: 'R9X16', copy: { headline: 'כותרת' }, kit, template: 'photo', backgroundMediaId: '0191f3a2-0000-7000-8000-000000000002' });
    const { background, foreground } = splitForMotion(photo);
    expect(background.layers.map((l) => l.id)).toEqual(['bg']);
    expect(foreground.layers.map((l) => l.id).sort()).toEqual(['headline', 'logo', 'overlay']);
    const overVideo = buildDocument({ aspect: 'R9X16', copy: { headline: 'כותרת' }, kit, template: 'photo', backgroundIsVideo: true });
    expect(overVideo.template).toBe('photo');
    expect(overVideo.layers.some((l) => l.id === 'bg')).toBe(false);
  });

  it('keeps on-screen text, logo and subtitles in separate bands for every aspect', () => {
    for (const aspect of ['R9X16', 'R4X5', 'R1X1', 'R16X9', 'R191X1'] as const) {
      const doc = buildReelOverlay({ aspect, headline: 'כותרת ארוכה מאוד שצריכה להיכנס במסגרת', kit: { colors: {}, fonts: { heading: 'Rubik' }, logoMediaId: '0191f3a2-0000-7000-8000-000000000003' } });
      const band = subtitleBand(aspect);
      for (const l of doc.layers.filter((x) => x.type !== 'shape')) expect(l.box.y + l.box.h).toBeLessThanOrEqual(band.top);
      expect(doc.fonts.heading).toBe('Rubik');
      const marginV = Number(/MarginV=(\d+)/.exec(subtitleStyle(aspect))![1]);
      // The subtitle baseline sits at the bottom of the band (libass PlayResY = 288).
      expect(Math.abs(288 - marginV - (band.bottom / 100) * 288)).toBeLessThan(1.5);
    }
    expect(buildReelOverlay({ aspect: 'R9X16', headline: null, kit: { colors: {}, fonts: {}, logoMediaId: null } }).layers.map((l) => l.id)).toEqual(['shade-top', 'shade-bottom']);
  });

  it('cache keys change exactly when the inputs that cost money change', () => {
    const project = { aspect: 'R9X16' as const, voice: 'alloy', videoTier: 'balanced', ambientAudio: false, motionStills: true };
    const scene = { narration: 'שלום', visualKind: 'AI_VIDEO' as const, visualPrompt: 'robot', motionPrompt: 'waves', mediaId: null, characterId: null, onScreenText: null };
    const k1 = clipCacheKey(project, scene, null);
    expect(clipCacheKey(project, { ...scene, onScreenText: 'טקסט אחר' }, null)).toBe(k1);
    expect(clipCacheKey(project, { ...scene, motionPrompt: 'jumps' }, null)).not.toBe(k1);
    expect(clipCacheKey({ ...project, videoTier: 'flagship' }, scene, null)).not.toBe(k1);
    expect(clipCacheKey(project, { ...scene, visualKind: 'CARD' }, null)).toBeNull();
    expect(ttsCacheKey('שלום', 'alloy', 'x')).toBe(ttsCacheKey('שלום', 'alloy', 'x'));
    expect(ttsCacheKey('שלום', 'nova', 'x')).not.toBe(ttsCacheKey('שלום', 'alloy', 'x'));
    const character = { id: 'c', brandId: 'b', name: 'רובי', description: 'blue robot', imageMediaId: 'img', voice: 'nova', voiceInstructions: 'cheerful', isActive: true, createdById: null, createdAt: new Date(), updatedAt: new Date() };
    expect(narrationVoice(project, { visualKind: 'AVATAR' }, character)).toEqual({ voice: 'nova', instructions: 'cheerful' });
    expect(narrationVoice(project, { visualKind: 'AI_VIDEO' }, character).voice).toBe('alloy');
    const h1 = renderConfigHash(project, [{ ...scene, id: 's1' }]);
    expect(renderConfigHash(project, [{ ...scene, id: 's1', onScreenText: 'x' }])).toBe(h1);
    expect(renderConfigHash(project, [{ ...scene, id: 's1', narration: 'אחר' }])).not.toBe(h1);
  });
});

describe('scene types: validation and estimates', () => {
  it('validates library video, start images and characters per scene type', async () => {
    const { owner, brandA, brandB } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const project = await createVideoProject(ctx, { title: 'רילס', aspect: 'R9X16', voice: 'alloy' });
    const { scenes } = await generateVideoScript(ctx, project.id, { sceneCount: 2, targetSeconds: 10 });
    const s = scenes[0]!;
    const image = await uploadMedia(ctx, { data: await pngBuffer(), originalName: 'a.png', mimeType: 'image/png' });

    // MEDIA_VIDEO needs a VIDEO asset, not an image.
    await expect(updateVideoScene(ctx, s.id, { narration: 'x', visualKind: 'MEDIA_VIDEO', mediaId: image.id })).rejects.toBeInstanceOf(ValidationError);
    // AVATAR needs a character.
    await expect(updateVideoScene(ctx, s.id, { narration: 'x', visualKind: 'AVATAR', characterId: null })).rejects.toBeInstanceOf(ValidationError);
    // Characters of another brand are invisible.
    const ctxB = await ctxFor(owner, brandB.id);
    const imgB = await uploadMedia(ctxB, { data: await pngBuffer(), originalName: 'b.png', mimeType: 'image/png' });
    const foreign = await createCharacter(ctxB, { name: 'זר', imageMediaId: imgB.id, voice: 'alloy' });
    await expect(updateVideoScene(ctx, s.id, { narration: 'x', visualKind: 'AVATAR', characterId: foreign.id })).rejects.toBeInstanceOf(ValidationError);
    // A character needs an image of this brand.
    await expect(createCharacter(ctx, { name: 'גנב', imageMediaId: imgB.id, voice: 'alloy' })).rejects.toBeInstanceOf(NotFoundError);

    const robot = await createCharacter(ctx, { name: 'רובי', description: 'friendly blue robot', imageMediaId: image.id, voice: 'nova' });
    const avatar = await updateVideoScene(ctx, s.id, { narration: 'שלום, אני רובי', visualKind: 'AVATAR', characterId: robot.id, motionPrompt: 'waves' });
    expect(avatar.characterId).toBe(robot.id);
    const clip = await updateVideoScene(ctx, scenes[1]!.id, { narration: 'מעבירים אתר בקלות', visualKind: 'AI_VIDEO', visualPrompt: 'server room', motionPrompt: 'slow dolly-in', mediaId: image.id });
    expect(clip.mediaId).toBe(image.id);

    // Non-production: mocks serve video/avatar → estimate counts seconds but no money, no approval.
    const detail = await getVideoProject(ctx, project.id);
    expect(detail.estimate.mockClips).toBe(true);
    expect(detail.estimate.videoSeconds).toBeGreaterThan(0);
    expect(detail.estimate.avatarSeconds).toBeGreaterThan(0);
    expect(detail.estimate.videoIls).toBe(0);
    expect(detail.estimate.needsApproval).toBe(false);
    expect(detail.characters.map((c) => c.name)).toEqual(['רובי']);
  });
});

describe('one-click production', () => {
  const started: string[] = [];
  beforeEach(() => {
    started.length = 0;
    setVideoRenderDispatcher(async (_ctx, projectId) => {
      started.push(projectId);
    });
  });
  afterEach(() => setVideoRenderDispatcher(null));

  it('brief → script → motion scenes with the character presenting → render started', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const image = await uploadMedia(ctx, { data: await pngBuffer(), originalName: 'r.png', mimeType: 'image/png' });
    const robot = await createCharacter(ctx, { name: 'רובי', imageMediaId: image.id, voice: 'nova' });
    const { autoProduceVideo } = await import('../src/services/video');
    const res = await autoProduceVideo(ctx, { brief: 'רילס על מעבר אתר בלי השבתה', aspect: 'R9X16', characterId: robot.id, sceneCount: 4, targetSeconds: 30, videoTier: 'flagship' });
    expect(res.approvalRequired).toBe(false);
    expect(started).toEqual([res.project.id]);
    const detail = await getVideoProject(ctx, res.project.id);
    expect(detail.project.videoTier).toBe('flagship');
    expect(detail.project.status).toBe('RENDERING');
    const kinds = detail.scenes.map((s) => s.visualKind);
    // Mock script returns 2 scenes in tests: opening and closing are the talking character.
    expect(kinds.every((k) => k === 'AVATAR')).toBe(true);
    expect(detail.scenes.every((s) => s.characterId === robot.id)).toBe(true);
  });
});

describe('fal-only video routing', () => {
  it('routes motion clips and talking characters to Kling on fal, priced per second', async () => {
    const { owner, org, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const { saveProviderCredentials } = await import('../src/services/provider-credentials');
    const { resolveClipModel, estimateClipCost } = await import('../src/ai/engine');
    await saveProviderCredentials(owner, org.id, 'fal', { apiKey: 'fal-test-key:not-real-123' });
    const flagship = await resolveClipModel(ctx, 'video', 'flagship');
    expect(flagship?.spec.modelId).toBe('fal-ai/kling-video/v3/pro/image-to-video');
    expect(flagship?.isMock).toBe(false);
    expect((await resolveClipModel(ctx, 'video', 'balanced'))?.spec.modelId).toBe('fal-ai/kling-video/v3/standard/image-to-video');
    expect((await resolveClipModel(ctx, 'avatar', 'flagship'))?.spec.modelId).toBe('fal-ai/kling-video/ai-avatar/v2/pro');
    // Kling takes any whole-second length from 3 to 15: a 6.4 s scene is billed as 7 s.
    const cost = await estimateClipCost(ctx, 'video', 6.4, { tier: 'flagship' });
    expect(cost.ils).toBeCloseTo(7 * 0.112 * 3.7, 3);
    const withAudio = await estimateClipCost(ctx, 'video', 6.4, { tier: 'flagship', withAudio: true });
    expect(withAudio.ils).toBeCloseTo(7 * 0.168 * 3.7, 3);
  });
});
