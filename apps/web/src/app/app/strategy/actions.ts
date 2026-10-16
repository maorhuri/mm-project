'use server';

import { revalidatePath } from 'next/cache';
import { briefRequestSchema, briefStatusSchema, generateStrategyBrief, setStrategyBriefStatus } from '@mm/core';
import { optionalStr, runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

export async function generateBriefAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = briefRequestSchema.parse({ kind: str(formData, 'kind'), focus: optionalStr(formData, 'focus') });
    const { brief, run } = await generateStrategyBrief(ctx, input);
    revalidatePath('/app/strategy');
    revalidatePath('/app/ai');
    return { message: run.isMock ? 'נוצר בריף מוק (אין ספק AI מחובר)' : `הבריף נוצר (${run.modelId}, ${Number(run.run.costIls).toFixed(3)} ₪)`, data: { id: brief.id } };
  }, formData, prev);
}

export async function setBriefStatusAction(briefId: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await setStrategyBriefStatus(ctx, briefId, briefStatusSchema.parse(status));
    revalidatePath('/app/strategy');
    revalidatePath(`/app/strategy/${briefId}`);
    return { message: status === 'ACCEPTED' ? 'הבריף אומץ' : status === 'ARCHIVED' ? 'הבריף הועבר לארכיון' : 'הסטטוס עודכן' };
  });
}
