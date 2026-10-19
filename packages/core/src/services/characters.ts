/**
 * Brand characters: recurring mascots / presenters reused across videos — a
 * reference image (a front-facing portrait works best for lip-sync), a TTS voice
 * and a short description used in video prompts.
 */
import type { BrandCharacter, MediaAsset } from '@mm/db';
import { runImage } from '../ai/engine';
import type { RunImageResult } from '../ai/engine';
import { AiOutputInvalidError } from '../ai/types';
import { auditFromContext } from '../audit';
import { NotFoundError, ValidationError } from '../errors';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import type { CharacterImageRequestInput, CharacterInput } from '../validation';
import { getMedia, uploadMedia } from './media';

export async function listCharacters(ctx: BrandContext, opts: { includeInactive?: boolean } = {}): Promise<BrandCharacter[]> {
  return ctx.db.brandCharacter.findMany({ where: opts.includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } });
}

export async function getCharacter(ctx: BrandContext, characterId: string): Promise<BrandCharacter> {
  const character = await ctx.db.brandCharacter.findUnique({ where: { id: characterId } });
  if (!character) throw new NotFoundError('character');
  return character;
}

async function assertCharacterImage(ctx: BrandContext, mediaId: string): Promise<MediaAsset> {
  const media = await getMedia(ctx, mediaId);
  if (media.kind !== 'IMAGE' || media.mimeType === 'image/svg+xml') throw new ValidationError('תמונת הדמות חייבת להיות PNG / JPG / WebP', [{ path: 'imageMediaId', message: 'סוג קובץ לא נתמך' }]);
  return media;
}

export async function createCharacter(ctx: BrandContext, input: CharacterInput): Promise<BrandCharacter> {
  assertBrandRole(ctx, 'EDITOR');
  await assertCharacterImage(ctx, input.imageMediaId);
  const character = await ctx.db.brandCharacter.create({
    data: {
      brandId: ctx.brandId,
      name: input.name,
      description: input.description ?? null,
      imageMediaId: input.imageMediaId,
      voice: input.voice,
      voiceInstructions: input.voiceInstructions ?? null,
      createdById: ctx.actor.userId || null,
    },
  });
  await auditFromContext(ctx, { action: 'character.create', entityType: 'brand_character', entityId: character.id, after: { name: character.name } });
  return character;
}

export async function updateCharacter(ctx: BrandContext, characterId: string, input: CharacterInput): Promise<BrandCharacter> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await getCharacter(ctx, characterId);
  if (input.imageMediaId !== before.imageMediaId) await assertCharacterImage(ctx, input.imageMediaId);
  const character = await ctx.db.brandCharacter.update({
    where: { id: characterId },
    data: { name: input.name, description: input.description ?? null, imageMediaId: input.imageMediaId, voice: input.voice, voiceInstructions: input.voiceInstructions ?? null },
  });
  await auditFromContext(ctx, { action: 'character.update', entityType: 'brand_character', entityId: characterId, before: { name: before.name, voice: before.voice }, after: { name: character.name, voice: character.voice } });
  return character;
}

export async function archiveCharacter(ctx: BrandContext, characterId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  await getCharacter(ctx, characterId);
  await ctx.db.brandCharacter.update({ where: { id: characterId }, data: { isActive: false } });
  await auditFromContext(ctx, { action: 'character.archive', entityType: 'brand_character', entityId: characterId });
}

/** AI portrait for a new character: front-facing, mouth visible, plain background — the best input for lip-sync. */
export async function generateCharacterImage(ctx: BrandContext, input: CharacterImageRequestInput): Promise<{ asset: MediaAsset; run: RunImageResult }> {
  assertBrandRole(ctx, 'EDITOR');
  const prompt = [
    `Character portrait for a brand video presenter / mascot: ${input.description}.`,
    input.style ? `Style: ${input.style}.` : 'Style: high-quality 3D animated character, soft studio lighting.',
    'Front-facing, looking straight at the camera, head and shoulders in frame, mouth clearly visible and closed, friendly neutral expression, centred, plain soft gradient background.',
    'No text, no letters, no logos, no watermark.',
  ].join(' ');
  const run = await runImage(ctx, { task: 'CHARACTER_IMAGE', label: 'דמות חדשה', prompt, width: 1024, height: 1536, quality: 'high', metadata: { kind: 'character' } });
  const image = run.images[0];
  if (!image) throw new AiOutputInvalidError('לא התקבלה תמונה');
  const asset = await uploadMedia(ctx, {
    data: image.data,
    originalName: `character-${Date.now()}.png`,
    mimeType: image.mimeType,
    title: 'דמות (AI)',
    altText: input.description.slice(0, 250),
    tags: ['character', 'ai', run.isMock ? 'mock' : 'generated'],
    source: 'AI_GENERATED',
  });
  return { asset, run };
}

/** A short Hebrew sample of an OpenAI voice (generated once per brand and voice, then cached in the media library). */
export async function voiceSample(ctx: BrandContext, voice: string): Promise<MediaAsset> {
  const { ttsVoiceSchema } = await import('../validation');
  const v = ttsVoiceSchema.parse(voice);
  const tag = `voice-sample-${v}`;
  const cached = await ctx.db.mediaAsset.findFirst({ where: { tags: { has: tag }, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  if (cached) return cached;
  const { runTts } = await import('../ai/engine');
  const tts = await runTts(ctx, {
    text: `שלום! ככה אני נשמע בסרטונים של ${ctx.brand.name}. קצב טבעי, אנרגיה טובה, ובדיוק המסר שצריך.`,
    voice: v,
    format: 'mp3',
    label: `דוגמת קול ${v}`,
    instructions: 'Native Israeli Hebrew voice-over for an Instagram Reel: energetic, confident and warm, brisk conversational pace.',
  });
  return uploadMedia(ctx, { data: tts.audio, originalName: `voice-${v}.mp3`, mimeType: tts.mimeType, title: `דוגמת קול ${v}`, tags: ['voice-sample', tag], source: 'AI_GENERATED' });
}
