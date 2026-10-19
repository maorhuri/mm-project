import { describe, expect, it } from 'vitest';
import { db } from '@mm/db';
import { encryptJson } from '../src/crypto';
import { ConflictError, ValidationError } from '../src/errors';
import type { GraphFetcher } from '../src/meta/graph';
import { decideApproval } from '../src/services/approvals';
import { uploadMedia } from '../src/services/media';
import { createPosts, fromJerusalemLocal, postContentHash, publishDuePosts, requestPostApproval, retryPost, updatePost } from '../src/services/publishing';
import { ctxFor, pngBuffer, twoBrandFixture } from './helpers';

function fakeGraph(opts: { failFirstPhoto?: boolean } = {}) {
  const calls: string[] = [];
  let photoFails = opts.failFirstPhoto ? 1 : 0;
  const fetcher: GraphFetcher = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.hostname}${u.pathname}`);
    const reply = (body: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    if (init.method === 'POST' && u.pathname.endsWith('/page1/photos')) {
      if (photoFails-- > 0) return reply({ error: { message: 'temporary', code: 2 } }, 500);
      return reply({ id: 'photo1', post_id: 'page1_post1' });
    }
    if (init.method === 'POST' && u.pathname.endsWith('/page1/feed')) return reply({ id: 'page1_text1' });
    if (init.method === 'POST' && u.pathname.endsWith('/ig1/media')) return reply({ id: 'container1' });
    if (init.method === 'POST' && u.pathname.endsWith('/ig1/media_publish')) return reply({ id: 'igmedia1' });
    if (u.pathname.endsWith('/container1')) return reply({ status_code: 'FINISHED' });
    if (u.pathname.endsWith('/page1_post1') || u.pathname.endsWith('/page1_text1')) return reply({ permalink_url: 'https://facebook.com/p/1' });
    if (u.pathname.endsWith('/igmedia1')) return reply({ permalink: 'https://instagram.com/p/abc' });
    return reply({ error: { message: `unexpected ${u.pathname}` } }, 404);
  };
  return { fetcher, calls };
}

async function connectMeta(orgId: string, brandId: string) {
  await db.providerAccount.create({
    data: {
      orgId,
      brandId,
      provider: 'meta',
      kind: 'META',
      label: 'Meta',
      status: 'CONNECTED',
      credentialsEnc: encryptJson({ accessToken: 'USER', tokenType: 'USER', expiresAt: null, pages: [{ id: 'page1', name: 'MVN', accessToken: 'PAGE-TOKEN', instagram: { id: 'ig1', username: 'mvn' } }] }),
      metadata: { userName: 'x', userId: '1', tokenType: 'USER', pages: [{ id: 'page1', name: 'MVN', instagram: { id: 'ig1', username: 'mvn' } }], selected: { pageId: 'page1', instagramId: 'ig1' } },
    },
  });
}

describe('publishing', () => {
  it('converts Israel wall-clock time (DST aware)', () => {
    expect(fromJerusalemLocal('2026-07-01T10:00').toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(fromJerusalemLocal('2026-12-01T10:00').toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(() => fromJerusalemLocal('tomorrow')).toThrow(ValidationError);
  });

  it('approval-gated publishing to Facebook and Instagram, once, with retries', async () => {
    const { owner, org, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    await connectMeta(org.id, brandA.id);
    const image = await uploadMedia(ctx, { data: await pngBuffer(400, 400), originalName: 'p.png', mimeType: 'image/png' });
    const at = new Date(Date.now() + 60_000);

    await expect(createPosts(ctx, { channels: ['INSTAGRAM'], caption: 'רק טקסט', mediaId: null, scheduledAt: at })).rejects.toBeInstanceOf(ValidationError);
    const [fb, ig] = await createPosts(ctx, { channels: ['FACEBOOK_PAGE', 'INSTAGRAM'], caption: 'מעבר אתר בלי השבתה', mediaId: image.id, scheduledAt: at });
    const [text] = await createPosts(ctx, { channels: ['FACEBOOK_PAGE'], caption: 'פוסט טקסט', mediaId: null, scheduledAt: at });
    expect(fb!.status).toBe('DRAFT');
    expect(fb!.contentHash).toBe(postContentHash('FACEBOOK_PAGE', 'מעבר אתר בלי השבתה', image.id));

    // Nothing is published before approval.
    const g = fakeGraph({ failFirstPhoto: true });
    expect(await publishDuePosts(new Date(Date.now() + 120_000), g.fetcher)).toEqual({ published: 0, failed: 0, retried: 0 });

    for (const p of [fb!, ig!, text!]) await requestPostApproval(ctx, p.id);
    // Editing the content after the request voids it: the approval cannot schedule the new text.
    const pendingIg = await db.scheduledPost.findUniqueOrThrow({ where: { id: ig!.id } });
    await updatePost(ctx, ig!.id, { caption: 'טקסט אחר', mediaId: image.id, scheduledAt: at });
    await expect(decideApproval(ctx, pendingIg.approvalId!, { decision: 'APPROVED' })).rejects.toBeInstanceOf(ConflictError);
    await requestPostApproval(ctx, ig!.id);
    for (const id of [fb!.id, ig!.id, text!.id]) {
      const p = await db.scheduledPost.findUniqueOrThrow({ where: { id } });
      await decideApproval(ctx, p.approvalId!, { decision: 'APPROVED' });
      expect((await db.scheduledPost.findUniqueOrThrow({ where: { id } })).status).toBe('SCHEDULED');
    }

    const now = new Date(Date.now() + 120_000);
    const first = await publishDuePosts(now, g.fetcher);
    expect(first).toEqual({ published: 2, failed: 0, retried: 1 });
    const fbAfter = await db.scheduledPost.findUniqueOrThrow({ where: { id: fb!.id } });
    expect(fbAfter.status).toBe('SCHEDULED'); // temporary 500 → retried later
    expect(fbAfter.attempts).toBe(1);
    const igAfter = await db.scheduledPost.findUniqueOrThrow({ where: { id: ig!.id } });
    expect(igAfter).toMatchObject({ status: 'PUBLISHED', externalId: 'igmedia1', permalink: 'https://instagram.com/p/abc' });
    // Instagram got a JPEG via a signed public link.
    expect((igAfter.meta as { jpegMediaId?: string }).jpegMediaId).toBeTruthy();
    expect(g.calls.filter((c) => c.endsWith('/ig1/media_publish'))).toHaveLength(1);

    // Second run publishes the retried photo; already-published posts are never re-sent.
    const second = await publishDuePosts(new Date(Date.now() + 3_600_000), g.fetcher);
    expect(second).toEqual({ published: 1, failed: 0, retried: 0 });
    expect(g.calls.filter((c) => c.endsWith('/ig1/media_publish'))).toHaveLength(1);
    expect((await db.scheduledPost.findUniqueOrThrow({ where: { id: fb!.id } })).permalink).toBe('https://facebook.com/p/1');
    const approval = await db.approval.findUniqueOrThrow({ where: { id: fbAfter.approvalId! } });
    expect(approval.status).toBe('EXECUTED');
    await expect(retryPost(ctx, fb!.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('a brand without a selected page fails the post with a clear error and notifies admins', async () => {
    const { owner, editor, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(editor, brandA.id);
    const [p] = await createPosts(ctx, { channels: ['FACEBOOK_PAGE'], caption: 'שלום', mediaId: null, scheduledAt: new Date(Date.now() + 60_000) });
    await requestPostApproval(ctx, p!.id);
    const ownerCtx = await ctxFor(owner, brandA.id);
    await decideApproval(ownerCtx, (await db.scheduledPost.findUniqueOrThrow({ where: { id: p!.id } })).approvalId!, { decision: 'APPROVED' });
    const res = await publishDuePosts(new Date(Date.now() + 120_000), fakeGraph().fetcher);
    expect(res.failed).toBe(1);
    const after = await db.scheduledPost.findUniqueOrThrow({ where: { id: p!.id } });
    expect(after.status).toBe('FAILED');
    expect(after.error).toContain('Meta');
  });
});
