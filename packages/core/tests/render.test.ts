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
