import Link from 'next/link';
import { Images } from 'lucide-react';
import { z } from 'zod';
import { listMedia } from '@mm/core';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { requireBrandContext } from '@/lib/brand';
import { formatNumber } from '@/lib/format';
import { MediaGrid } from './media-grid';
import { MediaUploader } from './media-uploader';

export const metadata = { title: 'ספריית מדיה' };

const KINDS = [
  { value: '', label: 'כל הסוגים' },
  { value: 'IMAGE', label: 'תמונות' },
  { value: 'VIDEO', label: 'וידאו' },
  { value: 'AUDIO', label: 'אודיו' },
  { value: 'FONT', label: 'פונטים' },
  { value: 'DOCUMENT', label: 'מסמכים' },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const kindSchema = z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'FONT', 'DOCUMENT', 'OTHER']).optional().catch(undefined);
const textSchema = z.string().trim().max(100).optional().catch(undefined);

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireBrandContext();
  // Lenient URL parsing: bad filters fall back to defaults instead of crashing the page.
  const query = {
    kind: kindSchema.parse(first(sp.kind) || undefined),
    search: textSchema.parse(first(sp.search) || undefined),
    tag: z.string().trim().max(40).optional().catch(undefined).parse(first(sp.tag) || undefined),
    page: z.coerce.number().int().min(1).catch(1).parse(first(sp.page) ?? 1),
    pageSize: 40,
  };
  const page = await listMedia(ctx, query);
  const canEdit = ctx.brandRole !== 'VIEWER';
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

  const link = (p: number) => {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.search) params.set('search', query.search);
    if (query.tag) params.set('tag', query.tag);
    params.set('page', String(p));
    return `/app/media?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="ספריית מדיה"
        description={`${ctx.brand.name} · ${formatNumber(page.total)} קבצים. האחסון מופרד לכל מותג (S3-compatible).`}
        actions={canEdit ? <MediaUploader brandId={ctx.brandId} /> : null}
      />

      <form className="flex flex-wrap items-end gap-2" action="/app/media" method="get">
        <div className="w-40">
          <Select name="kind" defaultValue={query.kind ?? ''} aria-label="סוג">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-64">
          <Input name="search" defaultValue={query.search ?? ''} placeholder="חיפוש לפי שם / כותרת" aria-label="חיפוש" />
        </div>
        {query.tag ? <input type="hidden" name="tag" value={query.tag} /> : null}
        <Button type="submit" variant="secondary">
          סינון
        </Button>
        {query.kind || query.search || query.tag ? (
          <Button asChild variant="ghost">
            <Link href="/app/media">ניקוי</Link>
          </Button>
        ) : null}
      </form>

      {page.items.length === 0 ? (
        <EmptyState
          icon={Images}
          title={page.total === 0 && !query.kind && !query.search ? 'הספרייה ריקה' : 'לא נמצאו קבצים'}
          description="העלו לוגואים, תמונות, סרטונים, פונטים מורשים ומסמכים. תמונות, PNG/JPG/WebP/SVG, וידאו MP4/MOV/WebM."
        />
      ) : (
        <MediaGrid brandId={ctx.brandId} items={page.items} canEdit={canEdit} />
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button asChild variant="outline" size="sm" disabled={page.page <= 1}>
            <Link href={link(Math.max(1, page.page - 1))}>הקודם</Link>
          </Button>
          <span className="text-muted-foreground">
            עמוד {page.page} מתוך {totalPages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page.page >= totalPages}>
            <Link href={link(Math.min(totalPages, page.page + 1))}>הבא</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
