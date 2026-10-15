/**
 * Tenant isolation: a user who can access brand A must never read, modify,
 * delete or create data in brand B — through the context gate or the client.
 */
import { describe, expect, it } from 'vitest';
import { db, forBrand } from '@mm/db';
import { ForbiddenError, NotFoundError } from '../src/errors';
import { decideApproval, listApprovals, requestApproval } from '../src/services/approvals';
import { createProduct, listProducts, updateProduct } from '../src/services/brands';
import { deleteMedia, getMedia, listMedia, uploadMedia } from '../src/services/media';
import { listAccessibleBrands, resolveBrandContext } from '../src/tenancy/context';
import { ctxFor, pngBuffer, twoBrandFixture } from './helpers';

describe('tenant isolation', () => {
  it('only lists brands the actor may access', async () => {
    const { owner, editor, brandA, brandB } = await twoBrandFixture();
    const ownerBrands = (await listAccessibleBrands(owner)).map((b) => b.id).sort();
    expect(ownerBrands).toEqual([brandA.id, brandB.id].sort());
    const editorBrands = (await listAccessibleBrands(editor)).map((b) => b.id);
    expect(editorBrands).toEqual([brandA.id]);
  });

  it('refuses to build a context for a brand without access', async () => {
    const { editor, brandB } = await twoBrandFixture();
    await expect(resolveBrandContext(editor, brandB.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resolveBrandContext(editor, '00000000-0000-7000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('media uploaded to brand B is invisible and immutable from brand A', async () => {
    const { owner, editor, brandA, brandB } = await twoBrandFixture();
    const ctxOwnerB = await ctxFor(owner, brandB.id);
    const ctxEditorA = await ctxFor(editor, brandA.id);
    const png = await pngBuffer();

    const inB = await uploadMedia(ctxOwnerB, { data: png, originalName: 'b.png', mimeType: 'image/png' });
    const inA = await uploadMedia(ctxEditorA, { data: png, originalName: 'a.png', mimeType: 'image/png' });

    const listA = await listMedia(ctxEditorA, { page: 1, pageSize: 50 });
    expect(listA.items.map((m) => m.id)).toEqual([inA.id]);

    await expect(getMedia(ctxEditorA, inB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMedia(ctxEditorA, inB.id)).rejects.toBeInstanceOf(NotFoundError);

    // Raw tenant client: even a direct lookup by id cannot cross brands.
    expect(await forBrand(brandA.id).mediaAsset.findUnique({ where: { id: inB.id } })).toBeNull();
    expect(await forBrand(brandA.id).mediaAsset.count()).toBe(1);
    // A forged brandId in `where` is overridden, not honoured: only brand A rows come back.
    const forged = await forBrand(brandA.id).mediaAsset.findMany({ where: { brandId: brandB.id } });
    expect(forged.map((m) => m.brandId)).toEqual([brandA.id]);
    // Unscoped root client sees both — proving the filter comes from the tenant layer.
    expect(await db.mediaAsset.count()).toBe(2);
  });

  it('creates through the tenant client are stamped with the context brand', async () => {
    const { owner, brandA, brandB } = await twoBrandFixture();
    const ctxA = await ctxFor(owner, brandA.id);
    const product = await createProduct(ctxA, { name: 'Hosting' });
    expect(product.brandId).toBe(brandA.id);

    const forged = await forBrand(brandA.id).brandProduct.create({
      data: { name: 'Forged', slug: 'forged', brandId: brandB.id } as never,
    });
    expect(forged.brandId).toBe(brandA.id);
    expect(await listProducts(await ctxFor(owner, brandB.id))).toHaveLength(0);
  });

  it('cross-brand updates fail even for an org owner using the wrong context', async () => {
    const { owner, brandA, brandB } = await twoBrandFixture();
    const ctxA = await ctxFor(owner, brandA.id);
    const ctxB = await ctxFor(owner, brandB.id);
    const product = await createProduct(ctxB, { name: 'VPS' });
    await expect(updateProduct(ctxA, product.id, { name: 'Hacked' })).rejects.toBeInstanceOf(NotFoundError);
    const untouched = await db.brandProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(untouched.name).toBe('VPS');
  });

  it('approvals are isolated per brand', async () => {
    const { owner, editor, brandA, brandB } = await twoBrandFixture();
    const ctxB = await ctxFor(owner, brandB.id);
    const approval = await requestApproval(ctxB, {
      type: 'OTHER',
      title: 'B only',
      subjectType: 'test',
      subjectId: 'x',
    });
    const ctxEditorA = await ctxFor(editor, brandA.id);
    const seen = await listApprovals(ctxEditorA, { page: 1, pageSize: 10 });
    expect(seen.total).toBe(0);
    await expect(decideApproval(await ctxFor(owner, brandA.id), approval.id, { decision: 'APPROVED' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('super admins can access every brand', async () => {
    const { brandB } = await twoBrandFixture();
    const { makeUser } = await import('./helpers');
    const superAdmin = await makeUser({ isSuperAdmin: true });
    const ctx = await resolveBrandContext(superAdmin, brandB.id);
    expect(ctx.brandRole).toBe('BRAND_ADMIN');
  });
});
