'use server';

import { revalidatePath } from 'next/cache';
import {
  aiProviderIdSchema,
  providerCredentialsSchema,
  removeProviderCredentials,
  saveProviderCredentials,
  testProviderConnection,
} from '@mm/core';
import { runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { requireBrandContext } from '@/lib/brand';

/** Save an org-wide API key for an AI provider (org OWNER/ADMIN). */
export async function saveProviderKeyAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { actor } = await requireUser();
    const ctx = await requireBrandContext();
    const input = providerCredentialsSchema.parse({ provider: str(formData, 'provider'), apiKey: str(formData, 'apiKey') });
    await saveProviderCredentials(actor, ctx.orgId, input.provider, { apiKey: input.apiKey });
    const test = await testProviderConnection(actor, ctx.orgId, input.provider);
    revalidatePath('/app/integrations');
    revalidatePath('/app');
    if (!test.ok) return { message: `המפתח נשמר אך בדיקת החיבור נכשלה: ${test.error ?? 'שגיאה'}`, data: test };
    return { message: `החיבור ל-${input.provider} אומת (${test.models.length} מודלים זמינים, ${test.latencyMs}ms)`, data: test };
  }, formData, prev);
}

export async function testProviderAction(provider: string): Promise<ActionResult> {
  return runAction(async () => {
    const { actor } = await requireUser();
    const ctx = await requireBrandContext();
    const p = aiProviderIdSchema.parse(provider);
    const test = await testProviderConnection(actor, ctx.orgId, p);
    revalidatePath('/app/integrations');
    if (!test.ok) return { status: 'error', message: `בדיקת החיבור נכשלה: ${test.error ?? 'שגיאה'}` } as never;
    return { message: `מחובר — ${test.models.length} מודלים זמינים (${test.latencyMs}ms)`, data: test };
  });
}

export async function removeProviderKeyAction(provider: string): Promise<ActionResult> {
  return runAction(async () => {
    const { actor } = await requireUser();
    const ctx = await requireBrandContext();
    const p = aiProviderIdSchema.parse(provider);
    await removeProviderCredentials(actor, ctx.orgId, p);
    revalidatePath('/app/integrations');
    revalidatePath('/app');
    return { message: 'המפתח הוסר' };
  });
}
