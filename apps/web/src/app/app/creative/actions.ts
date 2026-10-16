'use server';

import { revalidatePath } from 'next/cache';
import {
  archiveCreativeProject,
  backgroundRequestSchema,
  composeCreativeSchema,
  composeCreativeVersion,
  createCreativeProject,
  creativeProjectSchema,
  generateCreativeBackground,
  generateIdeas,
  ideaRequestSchema,
  ideaStatusSchema,
  requestCreativeApproval,
  rerenderCreativeVersion,
  saveCreativeVersion,
  setIdeaStatus,
} from '@mm/core';
import { numberOrNull, optionalStr, runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

function refresh(projectId?: string) {
  revalidatePath('/app/creative');
  revalidatePath('/app/ai');
  revalidatePath('/app/media');
  if (projectId) revalidatePath(`/app/creative/${projectId}`);
}

export async function createCreativeProjectAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = creativeProjectSchema.parse({
      title: str(formData, 'title'),
      channel: str(formData, 'channel') || undefined,
      format: str(formData, 'format') || undefined,
      aspect: str(formData, 'aspect') || undefined,
      productId: optionalStr(formData, 'productId'),
      goal: optionalStr(formData, 'goal'),
      audience: optionalStr(formData, 'audience'),
      style: optionalStr(formData, 'style'),
    });
    const project = await createCreativeProject(ctx, input);
    refresh();
    return { message: 'הפרויקט נוצר', data: { id: project.id } };
  }, formData, prev);
}

export async function generateIdeasAction(projectId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = ideaRequestSchema.parse({
      projectId,
      count: numberOrNull(formData, 'count') ?? 4,
      goal: optionalStr(formData, 'goal'),
      audience: optionalStr(formData, 'audience'),
      extra: optionalStr(formData, 'extra'),
    });
    const { ideas, run } = await generateIdeas(ctx, input);
    refresh(projectId);
    return { message: run.isMock ? 'נוצר רעיון מוק (אין ספק AI מחובר)' : `${ideas.length} רעיונות נוצרו (${run.modelId}, ${Number(run.run.costIls).toFixed(3)} ₪)` };
  }, formData, prev);
}

export async function composeVersionAction(projectId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = composeCreativeSchema.parse({
      ideaId: optionalStr(formData, 'ideaId') ?? undefined,
      template: str(formData, 'template') || undefined,
      backgroundMediaId: optionalStr(formData, 'backgroundMediaId'),
      copy: {
        headline: str(formData, 'headline'),
        subheadline: optionalStr(formData, 'subheadline'),
        body: optionalStr(formData, 'body'),
        cta: optionalStr(formData, 'cta'),
        price: optionalStr(formData, 'price'),
        badge: optionalStr(formData, 'badge'),
      },
      note: optionalStr(formData, 'note'),
    });
    const version = await composeCreativeVersion(ctx, projectId, input);
    refresh(projectId);
    const qa = (version.qa as { status?: string } | null)?.status;
    return { message: `גרסה ${version.version} נוצרה ונשלחה לרינדור${qa === 'BLOCKED' ? ' — שימו לב: בקרת האיכות חסמה את הטקסט' : ''}`, data: { versionId: version.id } };
  }, formData, prev);
}

export async function saveVersionAction(projectId: string, documentJson: string, note: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    let document: unknown;
    try {
      document = JSON.parse(documentJson);
    } catch {
      return { status: 'error', message: 'מסמך לא תקין' } as never;
    }
    const version = await saveCreativeVersion(ctx, projectId, { document, note });
    refresh(projectId);
    const qa = (version.qa as { status?: string } | null)?.status;
    return { message: `גרסה ${version.version} נשמרה ונשלחה לרינדור${qa === 'BLOCKED' ? ' — בקרת האיכות חסמה את הטקסט' : qa === 'WARN' ? ' — יש אזהרות QA' : ''}`, data: { versionId: version.id } };
  });
}

export async function generateBackgroundAction(projectId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = backgroundRequestSchema.parse({ prompt: str(formData, 'prompt'), quality: str(formData, 'quality') || undefined });
    const { asset, run } = await generateCreativeBackground(ctx, projectId, input);
    refresh(projectId);
    return {
      message: run.isMock ? 'נוצרה תמונת מוק (אין ספק תמונות מחובר)' : `הרקע נוצר (${run.modelId}, ${Number(run.run.costIls).toFixed(3)} ₪)`,
      data: { id: asset.id, title: asset.title, originalName: asset.originalName, width: asset.width, height: asset.height, tags: asset.tags },
    };
  }, formData, prev);
}

export async function requestApprovalAction(projectId: string, versionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await requestCreativeApproval(ctx, versionId);
    refresh(projectId);
    revalidatePath('/app/approvals');
    revalidatePath('/app', 'layout');
    return { message: 'הגרסה נשלחה למרכז האישורים' };
  });
}

export async function rerenderAction(projectId: string, versionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await rerenderCreativeVersion(ctx, versionId);
    refresh(projectId);
    return { message: 'הרינדור נכנס לתור' };
  });
}

export async function archiveProjectAction(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await archiveCreativeProject(ctx, projectId);
    refresh(projectId);
    return { message: 'הפרויקט הועבר לארכיון' };
  });
}

export async function setIdeaStatusAction(projectId: string, ideaId: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await setIdeaStatus(ctx, ideaId, ideaStatusSchema.parse(status));
    refresh(projectId);
    return { message: 'עודכן' };
  });
}
