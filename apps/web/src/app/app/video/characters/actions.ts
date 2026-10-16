'use server';

import { revalidatePath } from 'next/cache';
import { archiveCharacter, characterImageRequestSchema, characterSchema, createCharacter, generateCharacterImage, updateCharacter } from '@mm/core';
import { optionalStr, runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireBrandContext } from '@/lib/brand';

function refresh() {
  revalidatePath('/app/video/characters');
  revalidatePath('/app/video', 'layout');
  revalidatePath('/app/media');
}

export async function saveCharacterAction(characterId: string | null, prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = characterSchema.parse({
      name: str(formData, 'name'),
      description: optionalStr(formData, 'description'),
      imageMediaId: str(formData, 'imageMediaId'),
      voice: str(formData, 'voice') || undefined,
      voiceInstructions: optionalStr(formData, 'voiceInstructions'),
    });
    const character = characterId ? await updateCharacter(ctx, characterId, input) : await createCharacter(ctx, input);
    refresh();
    return { message: characterId ? 'הדמות עודכנה' : `הדמות "${character.name}" נוצרה`, data: { id: character.id } };
  }, formData, prev);
}

export async function generateCharacterImageAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    const input = characterImageRequestSchema.parse({ description: str(formData, 'description'), style: optionalStr(formData, 'style') });
    const { asset, run } = await generateCharacterImage(ctx, input);
    refresh();
    return {
      message: run.isMock ? 'נוצרה תמונת מוק (אין ספק תמונות מחובר)' : `הדמות צוירה (${run.modelId}, ${Number(run.run.costIls).toFixed(3)} ₪)`,
      data: { id: asset.id, title: asset.title, originalName: asset.originalName, width: asset.width, height: asset.height, tags: asset.tags, kind: 'IMAGE' },
    };
  }, formData, prev);
}

export async function archiveCharacterAction(characterId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireBrandContext();
    await archiveCharacter(ctx, characterId);
    refresh();
    return { message: 'הדמות הועברה לארכיון' };
  });
}
