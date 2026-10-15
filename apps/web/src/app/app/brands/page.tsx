import Link from 'next/link';
import { Palette } from 'lucide-react';
import { isOrgAdmin, listUserOrganizations } from '@mm/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { BrandStatusBadge } from '@/components/status-badges';
import { requireUser } from '@/lib/auth';
import { getBrandSelection } from '@/lib/brand';
import { CreateBrandDialog } from './create-brand-dialog';
import { SelectBrandButton } from './select-brand-button';

export const metadata = { title: 'מותגים' };

export default async function BrandsPage() {
  const { actor } = await requireUser();
  const [{ brands, current }, orgs] = await Promise.all([getBrandSelection(), listUserOrganizations(actor)]);
  const creatableOrgs = orgs.filter((o) => actor.isSuperAdmin || isOrgAdmin(o.role)).map((o) => ({ id: o.id, name: o.name }));

  return (
    <>
      <PageHeader
        title="מותגים"
        description="כל מותג הוא סביבה נפרדת לחלוטין: נתונים, מדיה, אישורים, קמפיינים ולידים."
        actions={creatableOrgs.length > 0 ? <CreateBrandDialog orgs={creatableOrgs} /> : null}
      />

      {brands.length === 0 ? (
        <EmptyState
          icon={Palette}
          title="אין עדיין מותגים"
          description={
            creatableOrgs.length > 0
              ? 'צרו את המותג הראשון כדי להתחיל להגדיר Brand Kit ולהעלות מדיה.'
              : 'בקשו ממנהל הארגון גישה למותג.'
          }
          action={creatableOrgs.length > 0 ? <CreateBrandDialog orgs={creatableOrgs} /> : null}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => (
            <Card key={b.id} className={b.id === current?.id ? 'border-primary/50 ring-1 ring-primary/30' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">{b.name}</CardTitle>
                  <div className="flex flex-wrap justify-end gap-1">
                    <BrandStatusBadge status={b.status} />
                    {b.isDemo ? <Badge variant="warning">דמו</Badge> : null}
                  </div>
                </div>
                <CardDescription dir="ltr" className="text-start">
                  /{b.slug}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Button asChild size="sm">
                  <Link href={`/app/brands/${b.id}`}>Brand Kit</Link>
                </Button>
                {b.id !== current?.id ? <SelectBrandButton brandId={b.id} /> : <Badge variant="secondary">נבחר</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
