import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { z } from 'zod';
import { getMetaConnection, listMedia, listPosts } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { requireBrandContext } from '@/lib/brand';
import { CalendarBoard } from './calendar-board';

export const metadata = { title: 'לוח תוכן ופרסום' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireBrandContext();
  const now = new Date();
  const month = z.string().regex(/^\d{4}-\d{2}$/).catch(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).parse(first(sp.m) ?? '');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600_000);
  const to = new Date(Date.UTC(y, m, 1) + 3 * 3600_000);

  const [posts, connection, creatives, videos, images, libVideos] = await Promise.all([
    listPosts(ctx, { from, to }),
    getMetaConnection(ctx),
    ctx.db.creativeVersion.findMany({ where: { renderedJpgId: { not: null }, status: { in: ['READY', 'APPROVED'] } }, orderBy: { createdAt: 'desc' }, take: 30, include: { project: { select: { title: true } } } }),
    ctx.db.videoProject.findMany({ where: { outputMediaId: { not: null }, status: { in: ['READY', 'APPROVED'] } }, orderBy: { updatedAt: 'desc' }, take: 30 }),
    listMedia(ctx, { kind: 'IMAGE', page: 1, pageSize: 60 }),
    listMedia(ctx, { kind: 'VIDEO', page: 1, pageSize: 30 }),
  ]);
  const sources = [
    ...creatives.map((v) => ({ key: `creative_version:${v.id}`, label: `קריאייטיב · ${v.project.title} (גרסה ${v.version})${v.status === 'APPROVED' ? ' ✓' : ''}`, mediaId: v.renderedJpgId!, kind: 'IMAGE' as const, sourceType: 'creative_version', sourceId: v.id })),
    ...videos.map((v) => ({ key: `video_project:${v.id}`, label: `סרטון · ${v.title}${v.status === 'APPROVED' ? ' ✓' : ''}`, mediaId: v.outputMediaId!, kind: 'VIDEO' as const, sourceType: 'video_project', sourceId: v.id })),
    ...images.items.filter((i) => i.mimeType !== 'image/svg+xml').map((i) => ({ key: `media:${i.id}`, label: `תמונה · ${i.title ?? i.originalName}`, mediaId: i.id, kind: 'IMAGE' as const, sourceType: 'media', sourceId: i.id })),
    ...libVideos.items.map((i) => ({ key: `media:${i.id}`, label: `וידאו · ${i.title ?? i.originalName}`, mediaId: i.id, kind: 'VIDEO' as const, sourceType: 'media', sourceId: i.id })),
  ];
  const page = connection.pages.find((p) => p.id === connection.selected.pageId) ?? null;
  const missingScopes = connection.connected ? ['pages_manage_posts', 'instagram_content_publish'].filter((s) => connection.scopes.length > 0 && !connection.scopes.includes(s)) : [];

  return (
    <>
      <PageHeader
        title="לוח תוכן ופרסום"
        description={`${ctx.brand.name} · מתזמנים פוסטים לפייסבוק ולאינסטגרם. כל פוסט מתפרסם אוטומטית במועד — רק אחרי אישור של התוכן המדויק.`}
      />
      {!connection.connected || !page ? (
        <Alert variant="warning">
          <CalendarDays />
          <AlertTitle>{!connection.connected ? 'המותג לא מחובר ל-Meta' : 'לא נבחר עמוד פייסבוק לפרסום'}</AlertTitle>
          <AlertDescription>
            אפשר לתכנן ולאשר כבר עכשיו; הפרסום עצמו יתבצע אחרי החיבור.{' '}
            <Button asChild size="sm" variant="link" className="h-auto p-0">
              <Link href="/app/integrations">לחיבור Meta</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : missingScopes.length ? (
        <Alert variant="warning">
          <CalendarDays />
          <AlertTitle>חסרות הרשאות פרסום</AlertTitle>
          <AlertDescription>
            הוסיפו ל-Configuration של Facebook Login for Business את ההרשאות {missingScopes.join(', ')} והתחברו מחדש. <Link href="/app/integrations" className="underline">לאינטגרציות</Link>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          מפרסם לעמוד <b>{page.name}</b>
          {page.instagram ? (
            <>
              {' '}
              ולאינסטגרם <b dir="ltr">@{page.instagram.username ?? page.instagram.id}</b>
            </>
          ) : (
            ' (לעמוד אין אינסטגרם עסקי מקושר)'
          )}
        </p>
      )}
      <CalendarBoard
        brandId={ctx.brandId}
        month={month}
        canEdit={ctx.brandRole !== 'VIEWER'}
        posts={posts.map((p) => ({ ...p, scheduledAt: p.scheduledAt.toISOString(), publishedAt: p.publishedAt?.toISOString() ?? null, createdAt: undefined, updatedAt: undefined }))}
        sources={sources}
        initialSource={first(sp.source) ?? null}
      />
    </>
  );
}
