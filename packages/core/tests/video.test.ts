import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../src/errors';
import { createProduct } from '../src/services/brands';
import { uploadMedia } from '../src/services/media';
import {
  buildSrt,
  createVideoProject,
  estimateVideoCost,
  formatSrtTime,
  generateVideoScript,
  getVideoProject,
  listVideoProjects,
  requestVideoApproval,
  setVideoRenderDispatcher,
  splitCaption,
  startVideoRender,
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
    expect(estimateVideoCost([]).totalIls).toBe(0);
  });
});
