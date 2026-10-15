import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { getBrandKit, isAppError, listKnowledge, listMedia } from '@mm/core';
import type { BrandContext } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BrandStatusBadge } from '@/components/status-badges';
import { brandContextFor } from '@/lib/brand';
import { BrandAudienceForm } from './brand-audience-form';
import { BrandDesignForm } from './brand-design-form';
import { BrandIdentityForm } from './brand-identity-form';
import { CompetitorsPanel } from './competitors-panel';
import { KnowledgePanel } from './knowledge-panel';
import { LogoPicker } from './logo-picker';
import { ProductsPanel } from './products-panel';
import { WebsiteImport } from './website-import';

export const metadata = { title: 'Brand Kit' };

const TABS = ['identity', 'design', 'audience', 'products', 'knowledge', 'competitors'] as const;
type Tab = (typeof TABS)[number];

export default async function BrandKitPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { brandId } = await params;
  const { tab } = await searchParams;
  const activeTab: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'identity';

  let ctx: BrandContext;
  try {
    ctx = await brandContextFor(brandId);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    if (isAppError(err) && err.status === 403) {
      return (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>אין גישה למותג הזה</AlertTitle>
          <AlertDescription>
            בקשו ממנהל הארגון להעניק לכם הרשאה. <Link href="/app/brands" className="underline">חזרה למותגים</Link>
          </AlertDescription>
        </Alert>
      );
    }
    throw err;
  }

  const [kit, knowledge, images] = await Promise.all([
    getBrandKit(ctx),
    listKnowledge(ctx),
    listMedia(ctx, { kind: 'IMAGE', page: 1, pageSize: 100 }),
  ]);
  const isAdmin = ctx.brandRole === 'BRAND_ADMIN';
  const canEdit = ctx.brandRole !== 'VIEWER';

  return (
    <>
      <PageHeader
        title={kit.brand.name}
        description="Brand Kit — המוח השיווקי של המותג. ה-AI ישתמש רק במידע שמוגדר ומאושר כאן."
        badges={
          <>
            <BrandStatusBadge status={kit.brand.status} />
            {kit.brand.isDemo ? <Badge variant="warning">מותג דמו</Badge> : null}
            <Badge variant="outline">{roleLabel(ctx.brandRole)}</Badge>
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/app/media">ספריית מדיה</Link>
          </Button>
        }
      />

      <Tabs defaultValue={activeTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="identity">זהות ולוגו</TabsTrigger>
          <TabsTrigger value="design">צבעים ופונטים</TabsTrigger>
          <TabsTrigger value="audience">קהל, טון ויעדים</TabsTrigger>
          <TabsTrigger value="products">מוצרים ושירותים ({kit.products.length})</TabsTrigger>
          <TabsTrigger value="knowledge">
            מאגר ידע ({kit.knowledge.approved}
            {kit.knowledge.pending ? ` +${kit.knowledge.pending} ממתינים` : ''})
          </TabsTrigger>
          <TabsTrigger value="competitors">מתחרים ({kit.competitors.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <BrandIdentityForm brand={kit.brand} disabled={!isAdmin} />
          <LogoPicker brandId={brandId} assets={kit.assets} images={images.items} disabled={!isAdmin} />
        </TabsContent>

        <TabsContent value="design" className="flex flex-col gap-6">
          <WebsiteImport
            brandId={brandId}
            websiteUrl={kit.brand.websiteUrl}
            hasDescription={Boolean(kit.brand.description)}
            disabled={!isAdmin}
          />
          <BrandDesignForm brandId={brandId} settings={kit.settings} disabled={!isAdmin} />
        </TabsContent>

        <TabsContent value="audience">
          <BrandAudienceForm brandId={brandId} settings={kit.settings} disabled={!isAdmin} />
        </TabsContent>

        <TabsContent value="products">
          <ProductsPanel brandId={brandId} products={kit.products} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="knowledge">
          <KnowledgePanel brandId={brandId} entries={knowledge} canEdit={canEdit} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="competitors">
          <CompetitorsPanel brandId={brandId} competitors={kit.competitors} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function roleLabel(role: BrandContext['brandRole']): string {
  return role === 'BRAND_ADMIN' ? 'מנהל מותג' : role === 'EDITOR' ? 'עורך' : 'צופה';
}
