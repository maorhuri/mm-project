import { describe, expect, it } from 'vitest';
import { db } from '@mm/db';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import { decideApproval, listApprovals } from '../src/services/approvals';
import { createKnowledge, getBrandKit, listKnowledge, updateBrandSettings, updateKnowledge } from '../src/services/brands';
import { deleteMedia, getMedia, listMedia, openMediaObject, uploadMedia } from '../src/services/media';
import { ctxFor, pngBuffer, twoBrandFixture } from './helpers';

describe('approval workflow', () => {
  it('knowledge starts pending, creates an approval, and becomes approved on decision', async () => {
    const { owner, editor, brandA } = await twoBrandFixture();
    const editorCtx = await ctxFor(editor, brandA.id);
    const entry = await createKnowledge(editorCtx, {
      kind: 'FAQ',
      title: 'שאלות נפוצות',
      content: 'תוכן',
    });
    expect(entry.status).toBe('PENDING');

    const ownerCtx = await ctxFor(owner, brandA.id);
    const pending = await listApprovals(ownerCtx, { status: 'PENDING', page: 1, pageSize: 10 });
    expect(pending.total).toBe(1);
    const approval = pending.items[0]!;
    expect(approval.subjectId).toBe(entry.id);

    // The owner was notified (the requesting editor was not).
    expect(await db.notification.count({ where: { userId: owner.userId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: editor.userId } })).toBe(0);

    // Editors cannot decide.
    await expect(decideApproval(editorCtx, approval.id, { decision: 'APPROVED' })).rejects.toBeInstanceOf(ForbiddenError);

    const decided = await decideApproval(ownerCtx, approval.id, { decision: 'APPROVED', note: 'ok' });
    expect(decided.status).toBe('APPROVED');
    const approved = await listKnowledge(ownerCtx, 'APPROVED');
    expect(approved.map((k) => k.id)).toEqual([entry.id]);

    await expect(decideApproval(ownerCtx, approval.id, { decision: 'REJECTED' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('editing approved knowledge invalidates the approval and requests a new one', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const entry = await createKnowledge(ctx, { kind: 'PRICING', title: 'מחירון', content: 'v1' }, { approveNow: true });
    expect(entry.status).toBe('APPROVED');
    const updated = await updateKnowledge(ctx, entry.id, { kind: 'PRICING', title: 'מחירון', content: 'v2' });
    expect(updated.status).toBe('PENDING');
    const pending = await listApprovals(ctx, { status: 'PENDING', page: 1, pageSize: 10 });
    expect(pending.items[0]?.subjectVersion).toBe(2);
  });

  it('brand settings persist and the kit reflects counts', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    await updateBrandSettings(ctx, {
      colors: { primary: '#112233' },
      keywords: ['אחסון'],
      monthlyAdBudgetIls: 3000,
      contentTargets: { reels: 4 },
    });
    const kit = await getBrandKit(ctx);
    expect(kit.settings.colors).toEqual({ primary: '#112233' });
    expect(kit.settings.monthlyAdBudgetIls).toBe(3000);
    expect(kit.knowledge).toEqual({ approved: 0, pending: 0, rejected: 0 });
  });
});

describe('media library', () => {
  it('uploads an image, detects dimensions, streams it back and soft-deletes', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const asset = await uploadMedia(ctx, {
      data: await pngBuffer(120, 80),
      originalName: 'לוגו.png',
      mimeType: 'image/png',
      tags: ['Logo', 'logo', ' hero '],
    });
    expect(asset).toMatchObject({ kind: 'IMAGE', width: 120, height: 80, mimeType: 'image/png' });
    expect(asset.tags).toEqual(['logo', 'hero']);
    expect(asset.storageKey.startsWith(`brands/${brandA.id}/`)).toBe(true);

    const { object } = await openMediaObject(ctx, asset.id);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).length).toBe(asset.sizeBytes);

    await deleteMedia(ctx, asset.id);
    await expect(getMedia(ctx, asset.id)).rejects.toThrow();
    expect((await listMedia(ctx, { page: 1, pageSize: 10 })).total).toBe(0);
  });

  it('rejects unsupported and corrupted files', async () => {
    const { owner, brandA } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    await expect(
      uploadMedia(ctx, { data: Buffer.from('hello'), originalName: 'x.exe', mimeType: 'application/octet-stream' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      uploadMedia(ctx, { data: Buffer.from('not a png'), originalName: 'x.png', mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('viewers cannot upload', async () => {
    const { editor, brandA } = await twoBrandFixture();
    await db.brandAccess.update({
      where: { userId_brandId: { userId: editor.userId, brandId: brandA.id } },
      data: { role: 'VIEWER' },
    });
    const ctx = await ctxFor(editor, brandA.id);
    expect(ctx.brandRole).toBe('VIEWER');
    await expect(
      uploadMedia(ctx, { data: await pngBuffer(), originalName: 'a.png', mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
