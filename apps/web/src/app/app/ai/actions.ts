'use server';

import { revalidatePath } from 'next/cache';
import { aiProviderIdSchema, probeProvider } from '@mm/core';
import { runAction } from '@/lib/actions';
import type { ActionResult } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

/** Real end-to-end probe: one tiny prompt through the engine (recorded in the ledger). */
export async function probeProviderAction(provider: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const result = await probeProvider(ctx, aiProviderIdSchema.parse(provider));
    revalidatePath('/app/ai');
    if (result.isMock) return { message: 'אין מפתח לספק הזה — הופעל מוק מסומן', data: result.run.id };
    return { message: `${result.modelId}: "${result.text.trim().slice(0, 40)}" (${result.run.latencyMs ?? '?'}ms, ${Number(result.run.costIls).toFixed(4)} ₪)`, data: result.run.id };
  });
}
