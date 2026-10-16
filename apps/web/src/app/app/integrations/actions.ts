'use server';

import { revalidatePath } from 'next/cache';
import {
  aiProviderIdSchema,
  disconnectMeta,
  metaAppCredentialsSchema,
  metaSelectSchema,
  providerCredentialsSchema,
  removeMetaAppCredentials,
  removeProviderCredentials,
  saveMetaAppCredentials,
  saveProviderCredentials,
  selectMetaAssets,
  syncMetaAds,
  testProviderConnection,
} from '@mm/core';
import { optionalStr, runAction, str } from '@/lib/actions';
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

// ---------------------------------------------------------------------------
// Meta (Facebook) — app credentials (org) and brand connection
// ---------------------------------------------------------------------------

export async function saveMetaAppAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { actor } = await requireUser();
    const ctx = await requireBrandContext();
    const input = metaAppCredentialsSchema.parse({ appId: str(formData, 'appId'), appSecret: str(formData, 'appSecret'), configId: optionalStr(formData, 'configId') });
    await saveMetaAppCredentials(actor, ctx.orgId, input);
    revalidatePath('/app/integrations');
    return { message: 'פרטי אפליקציית Meta נשמרו (מוצפנים). עכשיו אפשר לחבר את המותג.' };
  }, formData, prev);
}

export async function removeMetaAppAction(): Promise<ActionResult> {
  return runAction(async () => {
    const { actor } = await requireUser();
    const ctx = await requireBrandContext();
    await removeMetaAppCredentials(actor, ctx.orgId);
    revalidatePath('/app/integrations');
    return { message: 'פרטי האפליקציה הוסרו' };
  });
}

export async function selectMetaAssetsAction(adAccountId: string | null, pageId: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await selectMetaAssets(ctx, metaSelectSchema.parse({ adAccountId: adAccountId ?? undefined, pageId: pageId ?? undefined }));
    revalidatePath('/app/integrations');
    revalidatePath('/app/ads');
    return { message: 'הבחירה נשמרה' };
  });
}

export async function disconnectMetaAction(): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await disconnectMeta(ctx);
    revalidatePath('/app/integrations');
    revalidatePath('/app/ads');
    return { message: 'החיבור ל-Meta נותק' };
  });
}

export async function syncMetaAction(days: number): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const sync = await syncMetaAds(ctx, { days });
    revalidatePath('/app/integrations');
    revalidatePath('/app/ads');
    const s = sync.stats as { campaigns?: number; adSets?: number; ads?: number; insights?: number };
    return { message: `סונכרן: ${s.campaigns ?? 0} קמפיינים, ${s.adSets ?? 0} סטים, ${s.ads ?? 0} מודעות, ${s.insights ?? 0} שורות ביצועים` };
  });
}
