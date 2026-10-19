import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { db } from '@mm/db';
import { autopilotAfterCreative, autopilotAfterVideo, getAutopilot, runAutopilotCycle, saveAutopilot } from '../src/services/autopilot';
import { renderCreativeVersion, setCreativeRenderDispatcher } from '../src/services/creative';
import { uploadMedia } from '../src/services/media';
import { setVideoRenderDispatcher } from '../src/services/video';
import { ctxFor, twoBrandFixture } from './helpers';

const backend = {
  async renderHtml(_html: string, opts: { width: number; height: number }) {
    return { png: await sharp({ create: { width: opts.width, height: opts.height, channels: 4, background: '#123456' } }).png().toBuffer(), warnings: [], fitted: {}, durationMs: 1 };
  },
  async encodeVariants(png: Buffer) {
    return { jpg: await sharp(png).jpeg().toBuffer(), webp: await sharp(png).webp().toBuffer() };
  },
};

describe('content autopilot', () => {
  afterEach(() => {
    setVideoRenderDispatcher(null);
    setCreativeRenderDispatcher(null);
  });

  it('invents content, produces it and schedules it for approval without any brief', async () => {
    const { owner, editor, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    setVideoRenderDispatcher(async () => undefined);
    setCreativeRenderDispatcher(async () => undefined);

    // Off by default; editors cannot change it.
    expect((await getAutopilot(ctx)).enabled).toBe(false);
    await expect(saveAutopilot(await ctxFor(editor, brandA.id), { enabled: true })).rejects.toThrow();
    expect((await runAutopilotCycle(ctx)).skipped).toContain('הטייס האוטומטי כבוי');

    await saveAutopilot(ctx, { enabled: true, videosPerWeek: 3, imagePostsPerWeek: 4, channels: ['FACEBOOK_PAGE', 'INSTAGRAM'], tier: 'flagship', postHour: 19, reviewBeforeRender: false });
    const res = await runAutopilotCycle(ctx, { force: true });
    expect(res.skipped).toEqual([]);
    expect(res.videos).toHaveLength(1);
    expect(res.images).toHaveLength(1);
    const video = await db.videoProject.findUniqueOrThrow({ where: { id: res.videos[0]!.projectId } });
    expect(video.origin).toBe('autopilot');
    expect(video.status).toBe('RENDERING');
    const creative = await db.creativeProject.findUniqueOrThrow({ where: { id: res.images[0]!.projectId }, include: { versions: true } });
    expect(creative.origin).toBe('autopilot');
    expect(creative.versions).toHaveLength(1);

    // After the image renders: caption → free slot → approval on both channels.
    const version = await renderCreativeVersion(ctx, creative.versions[0]!.id, backend);
    expect(await autopilotAfterCreative(ctx, version)).toBe(2);
    expect(await autopilotAfterCreative(ctx, version)).toBe(0); // never scheduled twice
    const posts = await db.scheduledPost.findMany({ where: { brandId: brandA.id } });
    expect(posts.map((p) => p.status)).toEqual(['PENDING_APPROVAL', 'PENDING_APPROVAL']);
    expect(posts[0]!.scheduledAt.getTime()).toBeGreaterThan(Date.now());

    // After the video renders: the next free day gets it.
    const mp4 = await uploadMedia(ctx, { data: Buffer.from('fake-mp4-bytes-for-test'), originalName: 'v.mp4', mimeType: 'video/mp4' });
    const ready = await db.videoProject.update({ where: { id: video.id }, data: { status: 'READY', outputMediaId: mp4.id } });
    expect(await autopilotAfterVideo(ctx, ready)).toBe(2);
    const all = await db.scheduledPost.findMany({ where: { brandId: brandA.id }, orderBy: { scheduledAt: 'asc' } });
    expect(new Set(all.map((p) => p.scheduledAt.toISOString().slice(0, 10))).size).toBe(2); // different days
  });
});

describe('ideas and character modes', () => {
  it('proposes several distinct concepts and puts the character in every scene when asked', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const { generateConcepts } = await import('../src/services/autopilot');
    const concepts = await generateConcepts(ctx, 'video', 4);
    expect(concepts).toHaveLength(4);
    expect(new Set(concepts.map((c) => c.title)).size).toBe(4);
    const img = await uploadMedia(ctx, { data: await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).png().toBuffer(), originalName: 'c.png', mimeType: 'image/png' });
    const { createCharacter } = await import('../src/services/characters');
    const { autoProduceVideo } = await import('../src/services/video');
    const robot = await createCharacter(ctx, { name: 'מאיה', imageMediaId: img.id, voice: 'nova' });
    const res = await autoProduceVideo(ctx, { brief: concepts[0]!.brief, aspect: 'R9X16', characterId: robot.id, characterMode: 'all', sceneCount: 3, targetSeconds: 20, videoTier: 'flagship', reviewFirst: true });
    const scenes = await db.videoScene.findMany({ where: { projectId: res.project.id } });
    expect(scenes.every((s) => s.characterId === robot.id)).toBe(true);
  });
});
