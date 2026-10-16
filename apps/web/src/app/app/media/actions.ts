'use server';

import { revalidatePath } from 'next/cache';
import { deleteMedia, mediaUpdateSchema, updateMedia } from '@mm/core';
import { linesToList, optionalStr, runAction } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { brandContextFor } from '@/lib/brand';

export async function updateMediaAction(brandId: string, mediaId: string, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    const input = mediaUpdateSchema.parse({
      title: optionalStr(formData, 'title'),
      altText: optionalStr(formData, 'altText'),
      tags: linesToList(formData.get('tags')),
    });
    await updateMedia(ctx, mediaId, input);
    revalidatePath('/app/media');
    return { message: 'הפרטים נשמרו' };
  }, formData, prev);
}

export async function deleteMediaAction(brandId: string, mediaId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await brandContextFor(brandId);
    await deleteMedia(ctx, mediaId);
    revalidatePath('/app/media');
    revalidatePath(`/app/brands/${brandId}`);
    return { message: 'הקובץ נמחק' };
  });
}
