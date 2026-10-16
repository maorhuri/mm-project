'use server';

import { revalidatePath } from 'next/cache';
import {
  analyzeBrandSite,
  applyBrandImport,
  brandAssetSchema,
  brandCreateSchema,
  brandImportApplySchema,
  brandSettingsSchema,
  brandUpdateSchema,
  competitorSchema,
  createBrand,
  createCompetitor,
  createKnowledge,
  createProduct,
  deleteBrand,
  deleteCompetitor,
  deleteKnowledge,
  deleteProduct,
  knowledgeSchema,
  productSchema,
  removeBrandAsset,
  setBrandAsset,
  updateBrand,
  updateBrandSettings,
  updateKnowledge,
  updateProduct,
  websiteAnalyzeSchema,
} from '@mm/core';
import type { BrandSettingsInput } from '@mm/core';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { linesToList, numberOrNull, optionalStr, runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { BRAND_COOKIE, brandContextFor } from '@/lib/brand';

function revalidateBrand(brandId: string) {
  revalidatePath('/app', 'layout');
  revalidatePath(`/app/brands/${brandId}`);
}

export async function createBrandAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { actor } = await requireUser();
    const input = brandCreateSchema.parse({
      orgId: str(formData, 'orgId'),
      name: str(formData, 'name'),
      slug: optionalStr(formData, 'slug') ?? undefined,
      industry: str(formData, 'industry'),
      description: str(formData, 'description'),
      websiteUrl: str(formData, 'websiteUrl'),
      isDemo: formData.get('isDemo') === 'on',
    });
    const brand = await createBrand(actor, input);
    revalidatePath('/app', 'layout');
    return { message: `המותג "${brand.name}" נוצר`, data: { id: brand.id } };
  }, formData, prev);
}

export async function updateBrandAction(brandId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = brandUpdateSchema.parse({
      name: str(formData, 'name'),
      status: str(formData, 'status'),
      industry: optionalStr(formData, 'industry'),
      description: optionalStr(formData, 'description'),
      websiteUrl: str(formData, 'websiteUrl'),
      isDemo: formData.get('isDemo') === 'on',
    });
    await updateBrand(ctx, input);
    revalidateBrand(brandId);
    return { message: 'פרטי המותג נשמרו' };
  }, formData, prev);
}

export async function updateBrandDesignAction(brandId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const colors: Record<string, string> = {};
    for (const key of ['primary', 'secondary', 'accent', 'background', 'foreground']) {
      const v = str(formData, `color_${key}`).trim();
      if (v) colors[key] = v;
    }
    const input = brandSettingsSchema.parse({
      colors,
      fonts: { heading: str(formData, 'font_heading').trim() || undefined, body: str(formData, 'font_body').trim() || undefined },
      graphicStyle: optionalStr(formData, 'graphicStyle'),
    });
    await updateBrandSettings(ctx, input);
    revalidateBrand(brandId);
    return { message: 'הגדרות העיצוב נשמרו' };
  }, formData, prev);
}

export async function updateBrandAudienceAction(brandId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    let audiences: unknown = [];
    try {
      audiences = JSON.parse(str(formData, 'audiencesJson') || '[]');
    } catch {
      audiences = [];
    }
    const targets: Record<string, number> = {};
    for (const key of ['marketingPosts', 'professionalPosts', 'securityPosts', 'reels']) {
      const n = numberOrNull(formData, `target_${key}`);
      if (n !== null) targets[key] = n;
    }
    const input: BrandSettingsInput = brandSettingsSchema.parse({
      tone: {
        voice: str(formData, 'tone_voice').trim() || undefined,
        style: str(formData, 'tone_style').trim() || undefined,
        language: str(formData, 'tone_language').trim() || undefined,
        doNots: linesToList(formData.get('tone_doNots')),
      },
      audiences,
      keywords: linesToList(formData.get('keywords')),
      hashtags: linesToList(formData.get('hashtags')),
      ctaPresets: linesToList(formData.get('ctaPresets')),
      allowedClaims: linesToList(formData.get('allowedClaims')),
      forbiddenClaims: linesToList(formData.get('forbiddenClaims')),
      publishingMode: str(formData, 'publishingMode') || undefined,
      contentTargets: targets,
      monthlyAdBudgetIls: numberOrNull(formData, 'monthlyAdBudgetIls'),
    });
    await updateBrandSettings(ctx, input);
    revalidateBrand(brandId);
    return { message: 'קהל, טון ויעדים נשמרו' };
  }, formData, prev);
}

export async function saveProductAction(
  brandId: string,
  productId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = productSchema.parse({
      name: str(formData, 'name'),
      slug: optionalStr(formData, 'slug') ?? undefined,
      category: optionalStr(formData, 'category'),
      description: optionalStr(formData, 'description'),
      features: linesToList(formData.get('features')),
      audiences: linesToList(formData.get('audiences')),
      priceFromIls: numberOrNull(formData, 'priceFromIls'),
      pricingNote: optionalStr(formData, 'pricingNote'),
      url: str(formData, 'url'),
      isActive: formData.get('isActive') === 'on',
      sortOrder: numberOrNull(formData, 'sortOrder') ?? 0,
    });
    if (productId) await updateProduct(ctx, productId, input);
    else await createProduct(ctx, input);
    revalidateBrand(brandId);
    return { message: productId ? 'המוצר עודכן' : 'המוצר נוסף' };
  });
}

export async function deleteProductAction(brandId: string, productId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    await deleteProduct(ctx, productId);
    revalidateBrand(brandId);
    return { message: 'המוצר נמחק' };
  });
}

export async function saveKnowledgeAction(
  brandId: string,
  knowledgeId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = knowledgeSchema.parse({
      kind: str(formData, 'kind'),
      title: str(formData, 'title'),
      sourceUrl: str(formData, 'sourceUrl'),
      content: str(formData, 'content'),
    });
    if (knowledgeId) {
      await updateKnowledge(ctx, knowledgeId, input);
    } else {
      await createKnowledge(ctx, input, { approveNow: formData.get('approveNow') === 'on' });
    }
    revalidateBrand(brandId);
    revalidatePath('/app/approvals');
    return { message: knowledgeId ? 'המידע עודכן' : 'המידע נוסף' };
  });
}

export async function deleteKnowledgeAction(brandId: string, knowledgeId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    await deleteKnowledge(ctx, knowledgeId);
    revalidateBrand(brandId);
    return { message: 'המידע נמחק' };
  });
}

export async function createCompetitorAction(brandId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = competitorSchema.parse({
      name: str(formData, 'name'),
      websiteUrl: str(formData, 'websiteUrl'),
      notes: optionalStr(formData, 'notes'),
    });
    await createCompetitor(ctx, input);
    revalidateBrand(brandId);
    return { message: 'המתחרה נוסף' };
  }, formData, prev);
}

export async function deleteCompetitorAction(brandId: string, competitorId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    await deleteCompetitor(ctx, competitorId);
    revalidateBrand(brandId);
    return { message: 'המתחרה הוסר' };
  });
}

/** Permanently delete a brand (org admins; slug confirmation). Redirects to the brand list. */
export async function deleteBrandAction(brandId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    await deleteBrand(ctx, str(formData, 'confirm'));
    const jar = await cookies();
    if (jar.get(BRAND_COOKIE)?.value === brandId) jar.delete(BRAND_COOKIE);
    revalidatePath('/app', 'layout');
    redirect('/app/brands?deleted=1');
  }, formData, prev);
}

/** Analyse the brand website and return suggestions (nothing is saved). */
export async function analyzeWebsiteAction(brandId: string, url: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = websiteAnalyzeSchema.parse({ url: url.trim() || undefined });
    const analysis = await analyzeBrandSite(ctx, input.url);
    return { message: 'ניתוח האתר הושלם', data: analysis };
  });
}

/** Persist the user's selection from a website analysis. */
export async function applyWebsiteImportAction(brandId: string, payload: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = brandImportApplySchema.parse(payload);
    await applyBrandImport(ctx, input);
    revalidateBrand(brandId);
    return { message: 'ה-Brand Kit עודכן מהאתר' };
  });
}

export async function setBrandAssetAction(brandId: string, type: string, mediaAssetId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = brandAssetSchema.parse({ type, mediaAssetId });
    await setBrandAsset(ctx, input);
    revalidateBrand(brandId);
    return { message: 'הנכס עודכן' };
  });
}

export async function removeBrandAssetAction(brandId: string, assetId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    await removeBrandAsset(ctx, assetId);
    revalidateBrand(brandId);
    return { message: 'הנכס הוסר' };
  });
}
