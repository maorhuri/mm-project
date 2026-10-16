'use server';

import { revalidatePath } from 'next/cache';
import { approvalDecisionSchema, decideApproval } from '@mm/core';
import { optionalStr, runAction, str } from '@/lib/actions';
import type { ActionState } from '@/lib/actions';
import { brandContextFor } from '@/lib/brand';

export async function decideApprovalAction(brandId: string, approvalId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = approvalDecisionSchema.parse({
      decision: str(formData, 'decision'),
      note: optionalStr(formData, 'note') ?? undefined,
    });
    const approval = await decideApproval(ctx, approvalId, input);
    revalidatePath('/app', 'layout');
    revalidatePath('/app/approvals');
    revalidatePath(`/app/brands/${brandId}`);
    const label = approval.status === 'APPROVED' ? 'אושר' : approval.status === 'REJECTED' ? 'נדחה' : 'נשלח לשינויים';
    return { message: `הפריט ${label}` };
  }, formData, prev);
}
