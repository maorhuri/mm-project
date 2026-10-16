'use server';

import { revalidatePath } from 'next/cache';
import {
  createVideoProject,
  deleteVideoProject,
  generateVideoScript,
  requestVideoApproval,
  startVideoRender,
  updateVideoScene,
  videoProjectSchema,
  videoSceneUpdateSchema,
  videoScriptRequestSchema,
} from '@mm/core';
import { numberOrNull, optionalStr, runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

function refresh(projectId?: string) {
  revalidatePath('/app/video');
  revalidatePath('/app/ai');
  if (projectId) revalidatePath(`/app/video/${projectId}`);
}

export async function createVideoProjectAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = videoProjectSchema.parse({
      title: str(formData, 'title'),
      goal: optionalStr(formData, 'goal'),
      productId: optionalStr(formData, 'productId'),
      aspect: str(formData, 'aspect') || undefined,
      voice: str(formData, 'voice') || undefined,
    });
    const project = await createVideoProject(ctx, input);
    refresh();
    return { message: 'פרויקט הווידאו נוצר', data: { id: project.id } };
  }, formData, prev);
}

export async function generateScriptAction(projectId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = videoScriptRequestSchema.parse({
      sceneCount: numberOrNull(formData, 'sceneCount') ?? 5,
      targetSeconds: numberOrNull(formData, 'targetSeconds') ?? 30,
      extra: optionalStr(formData, 'extra'),
    });
    const { scenes, run } = await generateVideoScript(ctx, projectId, input);
    refresh(projectId);
    return { message: run.isMock ? 'נוצר תסריט מוק (אין ספק AI מחובר)' : `התסריט נוצר: ${scenes.length} סצנות (${run.modelId}, ${Number(run.run.costIls).toFixed(3)} ₪)` };
  }, formData, prev);
}

export async function updateSceneAction(projectId: string, sceneId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = videoSceneUpdateSchema.parse({
      narration: str(formData, 'narration'),
      onScreenText: optionalStr(formData, 'onScreenText'),
      visualKind: str(formData, 'visualKind') || undefined,
      mediaId: optionalStr(formData, 'mediaId'),
      visualPrompt: optionalStr(formData, 'visualPrompt'),
    });
    await updateVideoScene(ctx, sceneId, input);
    refresh(projectId);
    return { message: 'הסצנה נשמרה' };
  }, formData, prev);
}

export async function startRenderAction(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await startVideoRender(ctx, projectId);
    refresh(projectId);
    return { message: 'הרינדור התחיל — קריינות, ויז\'ואלים והרכבה. זה לוקח כמה דקות.' };
  });
}

export async function requestVideoApprovalAction(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await requestVideoApproval(ctx, projectId);
    refresh(projectId);
    revalidatePath('/app/approvals');
    revalidatePath('/app', 'layout');
    return { message: 'הסרטון נשלח למרכז האישורים' };
  });
}

export async function deleteVideoProjectAction(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await deleteVideoProject(ctx, projectId);
    refresh();
    return { message: 'הפרויקט נמחק' };
  });
}
