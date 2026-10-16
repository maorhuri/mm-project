'use server';

import { revalidatePath } from 'next/cache';
import { syncMetaAds } from '@mm/core';
import { runAction } from '@/lib/actions';
import type { ActionResult } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

export async function syncAdsAction(days: number): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const sync = await syncMetaAds(ctx, { days });
    revalidatePath('/app/ads');
    revalidatePath('/app/integrations');
    const s = sync.stats as { campaigns?: number; insights?: number };
    return { message: `סונכרן: ${s.campaigns ?? 0} קמפיינים, ${s.insights ?? 0} שורות ביצועים` };
  });
}
