import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ASPECTS, documentCopy, documentMediaIds, parseDocument } from '../src/creative/document';
import { documentToHtml } from '../src/creative/html';
import { fontDataUrl, fontsDir, renderFontSources, resolveFontFamily } from '../src/creative/fonts';
import { buildDocument, textOn } from '../src/creative/templates';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors';
import { decideApproval, listApprovals } from '../src/services/approvals';
import {
  composeCreativeVersion,
  createCreativeProject,
  generateCreativeBackground,
  generateIdeas,
  getCreativeProject,
  listCreativeProjects,
  loadComposeKit,
  previewHtml,
  qaIdea,
  renderCreativeVersion,
  requestCreativeApproval,
  saveCreativeVersion,
  setCreativeRenderDispatcher,
} from '../src/services/creative';
import type { RenderBackend } from '../src/services/creative';
import { buildFactsPacket } from '../src/ai/facts';
import { createProduct, updateBrandSettings } from '../src/services/brands';
import { uploadMedia } from '../src/services/media';
import { ctxFor, pngBuffer, twoBrandFixture } from './helpers';

const kit = { colors: { primary: '#1d4ed8', background: '#ffffff', foreground: '#111827' }, fonts: { heading: 'Rubik', body: 'Assistant' }, logoMediaId: null };

describe('creative document & templates (pure)', () => {
  it('builds an editable document from copy + brand kit for every aspect and template', () => {
    for (const aspect of Object.keys(ASPECTS) as (keyof typeof ASPECTS)[]) {
      for (const template of ['bold', 'photo', 'clean'] as const) {
        const doc = buildDocument({ aspect, copy: { headline: 'אחסון מהיר', subheadline: 'שרתים בישראל', cta: 'דברו איתנו', price: 'החל מ-49 ₪', badge: 'חדש' }, kit, template, backgroundMediaId: template === 'photo' ? '0191f3a2-0000-7000-8000-000000000000' : null });
        expect(doc.width).toBe(ASPECTS[aspect].width);
        expect(parseDocument(doc)).toBeTruthy();
        const copy = documentCopy(doc);
        expect(copy.headline).toBe('אחסון מהיר');
        expect(copy.cta).toBe('דברו איתנו');
        expect(doc.fonts).toEqual({ heading: 'Rubik', body: 'Assistant' });
        const ids = doc.layers.map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('falls back to the bold template when "photo" has no image, and picks readable text colours', () => {
    const doc = buildDocument({ aspect: 'R1X1', copy: { headline: 'x' }, kit, template: 'photo' });
    expect(doc.template).toBe('bold');
    expect(doc.background).toBe('#1d4ed8');
    expect(textOn('#1d4ed8')).toBe('#ffffff');
    expect(textOn('#ffffff')).toBe('#111111');
    expect(resolveFontFamily('Noto Sans Hebrew, sans-serif', 'Heebo')).toBe('Noto Sans Hebrew');
    expect(resolveFontFamily('Comic Sans', 'Heebo')).toBe('Heebo');
  });

  it('rejects malformed documents', () => {
    const doc = buildDocument({ aspect: 'R1X1', copy: { headline: 'x', cta: 'y' }, kit, template: 'bold' });
    expect(() => parseDocument({ ...doc, layers: [...doc.layers, { ...doc.layers[0]! }] })).toThrow(/כפול/);
    const bad = structuredClone(doc) as { layers: { color?: string }[] };
    bad.layers.find((l) => l.color)!.color = 'red';
    expect(() => parseDocument(bad)).toThrow();
  });

  it('renders self-contained HTML: RTL, escaped text, embedded fonts for render mode, app URLs for preview', () => {
    const doc = buildDocument({ aspect: 'R4X5', copy: { headline: '<script>alert(1)</script> & "quotes"', cta: 'לחצו' }, kit, template: 'clean' });
    const preview = documentToHtml(doc, { mode: 'preview', images: {} });
    expect(preview).toContain('dir="rtl"');
    expect(preview).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(preview).not.toContain('<script>alert');
    expect(preview).toContain("url(\"/fonts/Rubik.ttf\")");
    expect(fontsDir()).not.toBeNull();
    const render = documentToHtml(doc, { mode: 'render', images: {}, fontSrc: renderFontSources() });
    expect(render).toContain('data:font/ttf;base64,');
    expect(fontDataUrl('Heebo')!.length).toBeGreaterThan(10_000);
    expect(documentMediaIds(doc)).toEqual([]);
  });
});

describe('Creative Studio services', () => {
  const dispatched: string[] = [];
  beforeEach(() => {
    dispatched.length = 0;
    setCreativeRenderDispatcher(async (_ctx, versionId) => {
      dispatched.push(versionId);
    });
  });
  afterEach(() => setCreativeRenderDispatcher(null));

  const fakeBackend: RenderBackend = {
    async renderHtml(html, opts) {
      expect(html).toContain('id="canvas"');
      const png = await sharp({ create: { width: opts.width, height: opts.height, channels: 4, background: '#123456' } }).png().toBuffer();
      return { png, warnings: [{ kind: 'overflow', layer: 'headline', message: 'test' }], fitted: { headline: 70 }, durationMs: 5 };
    },
    async encodeVariants(png) {
      return { jpg: await sharp(png).jpeg().toBuffer(), webp: await sharp(png).webp().toBuffer() };
    },
  };

  it('ideas → compose → render → approval, with QA grounded in approved facts', async () => {
    const { owner, editor, brandA, brandB } = await twoBrandFixture();
    const ctx = await ctxFor(editor, brandA.id);
    const ownerCtx = await ctxFor(owner, brandA.id);
    await updateBrandSettings(ownerCtx, { colors: { primary: '#d946a0' }, fonts: { heading: 'Heebo' }, ctaPresets: ['לפרטים'], forbiddenClaims: ['הכי זול בישראל'] });
    const product = await createProduct(ownerCtx, { name: 'אחסון WordPress', slug: 'wp', features: ['גיבוי יומי'], priceFromIls: 49, isActive: true });
    const logo = await uploadMedia(ownerCtx, { data: await pngBuffer(120, 60), originalName: 'logo.png', mimeType: 'image/png' });
    await ownerCtx.db.brandAsset.create({ data: { brandId: brandA.id, type: 'LOGO_PRIMARY', mediaAssetId: logo.id } });

    const project = await createCreativeProject(ctx, { title: 'מבצע אחסון', channel: 'INSTAGRAM', format: 'POST', aspect: 'R4X5', productId: product.id, goal: 'לידים' });
    expect(project.status).toBe('DRAFT');

    // Ideas (mock provider → one labelled mock idea with a QA report).
    const { ideas, run } = await generateIdeas(ctx, { projectId: project.id, count: 3 });
    expect(run.isMock).toBe(true);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.title).toContain('[MOCK]');
    expect(ideas[0]?.source).toBe('mock');
    expect((ideas[0]?.qa as { status: string }).status).toBe('PASSED');

    const kit = await loadComposeKit(ctx);
    expect(kit.logoMediaId).toBe(logo.id);
    expect(kit.colors.primary).toBe('#d946a0');

    // Compose v1 from the idea; the render is queued (dispatcher captured).
    const v1 = await composeCreativeVersion(ctx, project.id, { ideaId: ideas[0]!.id, template: 'bold', copy: { headline: 'אחסון WordPress בישראל', subheadline: 'גיבוי יומי כלול', cta: 'לפרטים', price: 'החל מ-49 ₪' } });
    expect(v1.version).toBe(1);
    expect(v1.renderStatus).toBe('PENDING');
    expect((v1.qa as { status: string }).status).toBe('PASSED');
    expect(dispatched).toEqual([v1.id]);
    const detail = await getCreativeProject(ctx, project.id);
    expect(detail.project.currentVersionId).toBe(v1.id);
    expect(detail.ideas[0]?.status).toBe('USED');
    expect(previewHtml(ctx, parseDocument(v1.document))).toContain(`/media/${logo.id}/file`);

    // Cannot request approval before the render exists.
    await expect(requestCreativeApproval(ctx, v1.id)).rejects.toBeInstanceOf(ConflictError);

    // Render (worker path) stores PNG/JPG/WebP media and keeps the warnings.
    const rendered = await renderCreativeVersion(ctx, v1.id, fakeBackend);
    expect(rendered.renderStatus).toBe('READY');
    expect(rendered.status).toBe('READY');
    expect(rendered.renderedPngId && rendered.renderedJpgId && rendered.renderedWebpId).toBeTruthy();
    const media = await ctx.db.mediaAsset.findMany({ where: { source: 'RENDERED' } });
    expect(media.map((m) => m.mimeType).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(media.find((m) => m.mimeType === 'image/png')?.width).toBe(1080);
    expect((rendered.renderWarnings as { warnings: unknown[] }).warnings).toHaveLength(1);

    // Edit: an invented price is BLOCKED by QA and cannot be sent for approval.
    const doc = parseDocument(v1.document);
    const priced = { ...doc, layers: doc.layers.map((l) => (l.type === 'text' && l.role === 'price' ? { ...l, text: 'רק 19 ₪' } : l)) };
    const v2 = await saveCreativeVersion(ctx, project.id, { document: priced, note: 'מחיר מומצא' });
    expect(v2.version).toBe(2);
    expect((v2.qa as { status: string }).status).toBe('BLOCKED');
    expect((await ctx.db.creativeVersion.findUnique({ where: { id: v1.id } }))?.status).toBe('SUPERSEDED');
    await renderCreativeVersion(ctx, v2.id, fakeBackend);
    await expect(requestCreativeApproval(ctx, v2.id)).rejects.toThrow(/חסמה/);

    // A forbidden claim is BLOCKED too; a clean edit passes and goes through approval.
    const forbidden = { ...doc, layers: doc.layers.map((l) => (l.type === 'text' && l.role === 'headline' ? { ...l, text: 'הכי זול בישראל!' } : l)) };
    const v3 = await saveCreativeVersion(ctx, project.id, { document: forbidden });
    expect((v3.qa as { status: string; findings: { rule: string }[] }).findings.map((f) => f.rule)).toContain('forbidden_claim');

    const v4 = await saveCreativeVersion(ctx, project.id, { document: { ...doc, layers: doc.layers.map((l) => (l.type === 'text' && l.role === 'headline' ? { ...l, text: 'אחסון עם גיבוי יומי' } : l)) } });
    await renderCreativeVersion(ctx, v4.id, fakeBackend);
    const sent = await requestCreativeApproval(ctx, v4.id);
    expect(sent.approvalId).toBeTruthy();
    expect((await ctx.db.creativeProject.findUnique({ where: { id: project.id } }))?.status).toBe('IN_REVIEW');
    const pending = await listApprovals(ownerCtx, { status: 'PENDING', page: 1, pageSize: 10 });
    expect(pending.items.some((a) => a.id === sent.approvalId && a.subjectType === 'creative_version')).toBe(true);
    await decideApproval(ownerCtx, sent.approvalId!, { decision: 'APPROVED' });
    expect((await ctx.db.creativeVersion.findUnique({ where: { id: v4.id } }))?.status).toBe('APPROVED');
    expect((await ctx.db.creativeProject.findUnique({ where: { id: project.id } }))?.status).toBe('APPROVED');

    // Isolation: brand B sees nothing of brand A.
    const ctxB = await ctxFor(owner, brandB.id);
    await expect(getCreativeProject(ctxB, project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listCreativeProjects(ctxB)).toEqual([]);
    expect((await listCreativeProjects(ctx)).map((p) => p.versionCount)).toEqual([4]);
  });

  it('refuses documents that reference media of another brand or a different canvas', async () => {
    const { owner, brandA, brandB } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const ctxB = await ctxFor(owner, brandB.id);
    const foreign = await uploadMedia(ctxB, { data: await pngBuffer(), originalName: 'b.png', mimeType: 'image/png' });
    const project = await createCreativeProject(ctx, { title: 'p', channel: 'GENERIC', format: 'POST', aspect: 'R1X1' });
    const doc = buildDocument({ aspect: 'R1X1', copy: { headline: 'x' }, kit, template: 'photo', backgroundMediaId: foreign.id });
    expect(doc.template).toBe('photo');
    await expect(saveCreativeVersion(ctx, project.id, { document: doc })).rejects.toBeInstanceOf(NotFoundError);
    await expect(composeCreativeVersion(ctx, project.id, { template: 'photo', backgroundMediaId: foreign.id, copy: { headline: 'x' } })).rejects.toBeInstanceOf(NotFoundError);
    const wrongAspect = buildDocument({ aspect: 'R9X16', copy: { headline: 'x' }, kit, template: 'bold' });
    await expect(saveCreativeVersion(ctx, project.id, { document: wrongAspect })).rejects.toBeInstanceOf(ValidationError);
  });

  it('generates a (mock) background as an AI_GENERATED media asset and flags uncited claims', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const project = await createCreativeProject(ctx, { title: 'bg', channel: 'FACEBOOK', format: 'AD', aspect: 'R191X1' });
    const { asset, run } = await generateCreativeBackground(ctx, project.id, { prompt: 'שרתים בחדר נתונים', quality: 'low' });
    expect(run.isMock).toBe(true);
    expect(asset.source).toBe('AI_GENERATED');
    expect(asset.tags).toContain('mock');
    const packet = await buildFactsPacket(ctx);
    const qa = qaIdea({ headline: 'x', subheadline: null, body: null, cta: null, price: null, badge: null }, [{ text: 'יש לנו 10,000 לקוחות', factIds: [], kind: 'fact' }, { text: 'ok', factIds: ['Z9'], kind: 'fact' }], packet);
    expect(qa.status).toBe('WARN');
    expect(qa.findings.map((f) => f.rule).sort()).toEqual(['uncited_claim', 'unknown_fact_ref']);
  });
});
