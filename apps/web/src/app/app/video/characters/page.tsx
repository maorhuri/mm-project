import Link from 'next/link';
import { listCharacters, listMedia } from '@mm/core';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { requireBrandContext } from '@/lib/brand';
import { CharactersManager } from './characters-manager';

export const metadata = { title: 'דמויות המותג' };

export default async function CharactersPage() {
  const ctx = await requireBrandContext();
  const [characters, images] = await Promise.all([listCharacters(ctx), listMedia(ctx, { kind: 'IMAGE', page: 1, pageSize: 120 })]);
  return (
    <>
      <PageHeader
        title="דמויות המותג"
        description={`${ctx.brand.name} · דמויות קבועות (מסקוט, פרזנטור) שמופיעות ומדברות בסרטונים. הכי טוב: תמונת פנים קדמית, פה גלוי, רקע נקי.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/app/video">לסטודיו הווידאו</Link>
          </Button>
        }
      />
      <CharactersManager
        brandId={ctx.brandId}
        canEdit={ctx.brandRole !== 'VIEWER'}
        characters={characters.map((c) => ({ id: c.id, name: c.name, description: c.description, imageMediaId: c.imageMediaId, voice: c.voice, voiceInstructions: c.voiceInstructions }))}
        images={images.items.filter((m) => m.mimeType !== 'image/svg+xml').map((m) => ({ id: m.id, title: m.title, originalName: m.originalName, width: m.width, height: m.height, tags: m.tags, kind: 'IMAGE' as const }))}
      />
    </>
  );
}
