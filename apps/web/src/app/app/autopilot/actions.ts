'use server';

import { revalidatePath } from 'next/cache';
import { JOBS, QUEUES, getQueue, saveAutopilot } from '@mm/core';
import { runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

export async function saveAutopilotAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const cfg = await saveAutopilot(ctx, {
      enabled: formData.get('enabled') === 'on',
      videosPerWeek: str(formData, 'videosPerWeek'),
      imagePostsPerWeek: str(formData, 'imagePostsPerWeek'),
      channels: formData.getAll('channels').map(String),
      tier: str(formData, 'tier') || undefined,
      characterId: str(formData, 'characterId') || null,
      postHour: str(formData, 'postHour'),
    });
    revalidatePath('/app/autopilot');
    return { message: cfg.enabled ? 'הטייס האוטומטי פעיל — מחזור יצירה רץ כל בוקר ב-07:00' : 'הטייס האוטומטי כבוי' };
  }, formData, prev);
}

/** Run one creative cycle now in the worker (one video + one image post). */
export async function runAutopilotNowAction(): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    if (ctx.brandRole === 'VIEWER') return { status: 'error', message: 'אין הרשאה' } as never;
    await getQueue(QUEUES.content).add(JOBS.autopilot, { brandId: ctx.brandId, actorUserId: ctx.actor.userId, force: true, idempotencyKey: `autopilot:${ctx.brandId}:${Date.now()}` }, { attempts: 1 });
    revalidatePath('/app/autopilot');
    return { message: 'מחזור יצירה התחיל ברקע: קונספט חדש → סרטון + פוסט תמונה → כיתוב → תזמון → אישור. יופיע כאן תוך כמה דקות.' };
  });
}
