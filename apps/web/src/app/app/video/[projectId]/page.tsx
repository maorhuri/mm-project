import { notFound } from 'next/navigation';
import { getConfig, getVideoProject, isAppError, listMedia } from '@mm/core';
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
  const [images, videos] = await Promise.all([listMedia(ctx, { kind: 'IMAGE', page: 1, pageSize: 120 }), listMedia(ctx, { kind: 'VIDEO', page: 1, pageSize: 60 })]);
  const toPicker = (m: (typeof images.items)[number], kind: 'IMAGE' | 'VIDEO') => ({ id: m.id, title: m.title, originalName: m.originalName, width: m.width, height: m.height, tags: m.tags, kind });
  const { project } = detail;
  return (
    <VideoWorkspace
      brandId={ctx.brandId}
      canEdit={ctx.brandRole !== 'VIEWER'}
      project={{ ...project, costIls: Number(project.costIls), estimateIls: project.estimateIls === null ? null : Number(project.estimateIls) }}
      scenes={detail.scenes}
      product={detail.product}
      estimate={detail.estimate}
      characters={detail.characters.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, imageMediaId: c.imageMediaId, voice: c.voice }))}
      images={images.items.filter((m) => m.mimeType !== 'image/svg+xml').map((m) => toPicker(m, 'IMAGE'))}
      videos={videos.items.map((m) => toPicker(m, 'VIDEO'))}
      singleRunCapIls={getConfig().AI_SINGLE_RUN_MAX_ILS}
    />
  );
}
