import { notFound } from 'next/navigation';
import { getCreativeProject, isAppError, listMedia, loadComposeKit } from '@mm/core';
import { requireBrandContext } from '@/lib/brand';
import { CreativeWorkspace } from './creative-workspace';

export const metadata = { title: 'קריאייטיב' };

export default async function CreativeProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireBrandContext();
  let detail;
  try {
    detail = await getCreativeProject(ctx, projectId);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const [kit, media] = await Promise.all([loadComposeKit(ctx), listMedia(ctx, { kind: 'IMAGE', page: 1, pageSize: 80 })]);
  const images = media.items
    .filter((m) => m.mimeType !== 'image/svg+xml' || true)
    .map((m) => ({ id: m.id, title: m.title, originalName: m.originalName, width: m.width, height: m.height, tags: m.tags }));
  return (
    <CreativeWorkspace
      brandId={ctx.brandId}
      canEdit={ctx.brandRole !== 'VIEWER'}
      project={detail.project}
      versions={detail.versions}
      ideas={detail.ideas}
      product={detail.product}
      kit={kit}
      images={images}
    />
  );
}
