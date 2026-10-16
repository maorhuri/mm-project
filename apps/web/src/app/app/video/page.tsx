import Link from 'next/link';
import { Clapperboard } from 'lucide-react';
import { listProducts, listVideoProjects } from '@mm/core';
import { ASPECTS } from '@mm/core/creative';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { VideoStatusBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { relativeTime } from '@/lib/format';
import { CreateVideoDialog } from './create-video-dialog';

export const metadata = { title: 'סטודיו וידאו' };

export default async function VideoPage() {
  const ctx = await requireBrandContext();
  const [projects, products] = await Promise.all([listVideoProjects(ctx), listProducts(ctx)]);
  const canEdit = ctx.brandRole !== 'VIEWER';
  const productOptions = products.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
      <PageHeader
        title="סטודיו וידאו"
        description={`${ctx.brand.name} · סרטונים קצרים: תסריט → קריינות עברית → סצנות ממותגות → MP4 עם כתוביות צרובות. העלות מוצגת לפני הרינדור ונרשמת ביומן ה-AI.`}
        actions={canEdit ? <CreateVideoDialog products={productOptions} /> : null}
      />
      {projects.length === 0 ? (
        <EmptyState icon={Clapperboard} title="אין עדיין סרטונים" description="צרו פרויקט, בקשו תסריט, ערכו את הסצנות ורנדרו." action={canEdit ? <CreateVideoDialog products={productOptions} /> : null} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/app/video/${p.id}`} className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary">
              <div className="flex flex-wrap items-center gap-1.5">
                <VideoStatusBadge status={p.status} />
                {p.status === 'RENDERING' ? <span className="text-xs text-muted-foreground">{p.renderProgress}%</span> : null}
              </div>
              <h3 className="font-medium">{p.title}</h3>
              <p className="text-xs text-muted-foreground">
                {ASPECTS[p.aspect].ratio} · {p.sceneCount} סצנות{p.durationMs ? ` · ${Math.round(p.durationMs / 1000)} שנ'` : ''} · {Number(p.costIls) > 0 ? `${Number(p.costIls).toFixed(2)} ₪ · ` : ''}עודכן {relativeTime(p.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
