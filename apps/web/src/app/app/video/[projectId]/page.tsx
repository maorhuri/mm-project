import { notFound } from 'next/navigation';
import { getVideoProject, isAppError, listMedia } from '@mm/core';
import { requireBrandContext } from '@/lib/brand';
import { VideoWorkspace } from './video-workspace';

export const metadata = { title: 'סרטון' };

export default async function VideoProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireBrandContext();
  let detail;
  try {
    detail = await getVideoProject(ctx, projectId);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const media = await listMedia(ctx, { kind: 'IMAGE', page: 1, pageSize: 80 });
  const { project } = detail;
  return (
    <VideoWorkspace
      brandId={ctx.brandId}
      canEdit={ctx.brandRole !== 'VIEWER'}
      project={{ ...project, costIls: Number(project.costIls) }}
      scenes={detail.scenes}
      product={detail.product}
      estimate={detail.estimate}
      images={media.items.map((m) => ({ id: m.id, title: m.title, originalName: m.originalName, width: m.width, height: m.height, tags: m.tags }))}
    />
  );
}
