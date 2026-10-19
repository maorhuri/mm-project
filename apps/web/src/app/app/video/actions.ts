'use server';

import { revalidatePath } from 'next/cache';
import {
  generateConcepts,
  cancelVideoRender,
  setScenesApproved,
  autoProduceVideo,
  autoVideoSchema,
  createVideoProject,
  deleteVideoProject,
  generateVideoScript,
  isAppError,
  requestVideoApproval,
  startVideoRender,
  updateVideoScene,
  updateVideoSettings,
  videoProjectSchema,
  videoSceneUpdateSchema,
  videoScriptRequestSchema,
  videoSettingsSchema,
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
      motionPrompt: optionalStr(formData, 'motionPrompt'),
      characterId: optionalStr(formData, 'characterId'),
    });
    await updateVideoScene(ctx, sceneId, input);
    refresh(projectId);
    return { message: 'הסצנה נשמרה' };
  }, formData, prev);
}

export async function updateSettingsAction(projectId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = videoSettingsSchema.parse({
      voice: str(formData, 'voice'),
      motionStills: formData.get('motionStills') === 'on',
      videoTier: str(formData, 'videoTier'),
      ambientAudio: formData.get('ambientAudio') === 'on',
      transitions: formData.get('transitions') === 'on',
      musicMediaId: optionalStr(formData, 'musicMediaId'),
      musicVolume: numberOrNull(formData, 'musicVolume') ?? 18,
    });
    await updateVideoSettings(ctx, projectId, input);
    refresh(projectId);
    return { message: 'הגדרות הסרטון נשמרו' };
  }, formData, prev);
}

export async function startRenderAction(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    try {
      await startVideoRender(ctx, projectId);
    } catch (err) {
      if (isAppError(err) && err.code === 'ai_approval_required') {
        refresh(projectId);
        revalidatePath('/app/approvals');
        revalidatePath('/app', 'layout');
        return { message: `${err.message}. הרינדור יתחיל אוטומטית ברגע שמנהל המותג יאשר.`, data: { approvalRequired: true } };
      }
      throw err;
    }
    refresh(projectId);
    return { message: 'הרינדור התחיל — קריינות, ויז\'ואלים והרכבה. קליפים של AI עשויים לקחת כמה דקות.' };
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

export async function autoVideoAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = autoVideoSchema.parse({
      brief: str(formData, 'brief'),
      aspect: str(formData, 'aspect') || undefined,
      productId: optionalStr(formData, 'productId'),
      characterId: optionalStr(formData, 'characterId'),
      sceneCount: numberOrNull(formData, 'sceneCount') ?? undefined,
      targetSeconds: numberOrNull(formData, 'targetSeconds') ?? undefined,
      videoTier: str(formData, 'videoTier') || undefined,
      voice: optionalStr(formData, 'voice') ?? undefined,
      reviewFirst: formData.get('reviewFirst') === 'on',
      characterMode: optionalStr(formData, 'characterMode') ?? undefined,
    });
    const result = await autoProduceVideo(ctx, input);
    refresh(result.project.id);
    revalidatePath('/app/approvals');
    revalidatePath('/app', 'layout');
    return { message: result.message, data: { id: result.project.id, approvalRequired: result.approvalRequired } };
  }, formData, prev);
}

export async function cancelRenderAction(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const p = await cancelVideoRender(ctx, projectId);
    refresh(projectId);
    return { message: p.status === 'RENDERING' ? 'הרינדור ייעצר בשלב הבא (קליפ שכבר בייצור יסתיים וישמר)' : 'הרינדור נעצר' };
  });
}

export async function approveScenesAction(projectId: string, sceneIds: string[] | 'all', approved: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const n = await setScenesApproved(ctx, projectId, sceneIds, approved);
    refresh(projectId);
    return { message: approved ? (n > 1 ? `${n} סצנות אושרו` : 'הסצנה אושרה') : 'האישור בוטל' };
  });
}

export async function videoIdeasAction(): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const concepts = await generateConcepts(ctx, 'video', 4);
    return { message: `${concepts.length} רעיונות חדשים`, data: concepts };
  });
}
