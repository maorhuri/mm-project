import Link from 'next/link';
import { Lightbulb } from 'lucide-react';
import { CHANNEL_LABELS, FORMAT_LABELS, listCreativeProjects, listProducts } from '@mm/core';
import { ASPECTS } from '@mm/core/creative';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { CreativeStatusBadge, RenderStatusBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { relativeTime } from '@/lib/format';
import { CreateCreativeDialog } from './create-creative-dialog';

export const metadata = { title: 'סטודיו קריאייטיב' };

export default async function CreativePage() {
  const ctx = await requireBrandContext();
  const [projects, products] = await Promise.all([listCreativeProjects(ctx), listProducts(ctx)]);
  const canEdit = ctx.brandRole !== 'VIEWER';
  const productOptions = products.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader
        title="סטודיו קריאייטיב"
        description={`${ctx.brand.name} · פוסטים, סטוריז, באנרים ומודעות ממותגים. הטקסט נשאר טקסט (ניתן לעריכה), הרינדור ב-Chromium עם פונטים עבריים, וכל גרסה עוברת בקרת איכות מול העובדות המאושרות.`}
        actions={canEdit ? <CreateCreativeDialog products={productOptions} /> : null}
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="אין עדיין קריאייטיבים"
          description="צרו פרויקט, בקשו רעיונות מה-AI או כתבו טקסט בעצמכם, ובחרו תבנית ממותגת."
          action={canEdit ? <CreateCreativeDialog products={productOptions} /> : null}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const v = p.currentVersion;
            const thumb = v?.renderedPngId ? `/api/v1/brands/${ctx.brandId}/media/${v.renderedPngId}/file` : null;
            const aspect = ASPECTS[p.aspect];
            return (
              <Link key={p.id} href={`/app/creative/${p.id}`} className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={p.title} className="max-h-full max-w-full object-contain" loading="lazy" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <Lightbulb className="size-6" />
                      <span className="text-xs">{v ? 'ממתין לרינדור' : 'אין עדיין גרסה'}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CreativeStatusBadge status={p.status} />
                    {v ? <RenderStatusBadge status={v.renderStatus} /> : null}
                  </div>
                  <h3 className="truncate font-medium">{p.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {CHANNEL_LABELS[p.channel]} · {FORMAT_LABELS[p.format]} · {aspect.ratio} · {p.versionCount} גרסאות · עודכן {relativeTime(p.updatedAt)}
                  </p>
                  {p.goal ? (
                    <Badge variant="outline" className="w-fit">
                      {p.goal}
                    </Badge>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
