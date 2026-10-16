/**
 * CreativeDocument v1 — the editable source of a creative: a fixed canvas with
 * absolutely positioned layers (percent boxes). Text layers keep real Hebrew
 * text (never baked into an image) so every version stays editable.
 */
import type { AspectRatio } from '@mm/db';
import { z } from 'zod';
import { FONT_FAMILIES } from './font-families';

export const ASPECTS: Record<AspectRatio, { width: number; height: number; label: string; ratio: string }> = {
  R1X1: { width: 1080, height: 1080, label: 'ריבוע 1:1 — פוסט פיד', ratio: '1:1' },
  R4X5: { width: 1080, height: 1350, label: 'אנכי 4:5 — פיד אינסטגרם / פייסבוק', ratio: '4:5' },
  R9X16: { width: 1080, height: 1920, label: 'סטורי / רילס 9:16', ratio: '9:16' },
  R16X9: { width: 1920, height: 1080, label: 'רחב 16:9 — באנר / יוטיוב', ratio: '16:9' },
  R191X1: { width: 1200, height: 628, label: 'מודעה 1.91:1 — פיד פייסבוק / לינק', ratio: '1.91:1' },
};

export const aspectRatioSchema = z.enum(['R1X1', 'R4X5', 'R9X16', 'R16X9', 'R191X1']);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'צבע בפורמט #RRGGBB');
const pct = z.number().min(-50).max(150);
const dim = z.number().min(0.5).max(200);

export const boxSchema = z.object({ x: pct, y: pct, w: dim, h: dim });
export type Box = z.infer<typeof boxSchema>;

const fontFamilySchema = z.enum(FONT_FAMILIES);

const layerBase = {
  id: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().max(60).optional(),
  hidden: z.boolean().optional(),
};

export const TEXT_ROLES = ['headline', 'subheadline', 'body', 'cta', 'price', 'badge', 'custom'] as const;

export const textLayerSchema = z.object({
  ...layerBase,
  type: z.literal('text'),
  role: z.enum(TEXT_ROLES),
  text: z.string().max(600),
  box: boxSchema,
  font: z.enum(['heading', 'body']).default('heading'),
  /** Font size in canvas pixels. */
  size: z.number().min(10).max(400),
  weight: z.number().int().min(100).max(900).default(700),
  color: hex,
  align: z.enum(['start', 'center', 'end']).default('start'),
  valign: z.enum(['top', 'middle', 'bottom']).default('top'),
  lineHeight: z.number().min(0.8).max(2.2).default(1.15),
  /** Pill/panel background behind the text (hugs the text). */
  background: hex.nullable().default(null),
  radius: z.number().min(0).max(2000).default(0),
  padding: z.number().min(0).max(200).default(0),
  /** Shrink the font (down to 55 %) until the text fits its box. */
  autofit: z.boolean().default(true),
  shadow: z.boolean().default(false),
  letterSpacing: z.number().min(-5).max(20).default(0),
  opacity: z.number().min(0).max(1).default(1),
});

export const imageLayerSchema = z.object({
  ...layerBase,
  type: z.literal('image'),
  role: z.enum(['background', 'logo', 'photo']),
  mediaId: z.string().uuid().nullable(),
  box: boxSchema,
  fit: z.enum(['cover', 'contain']).default('cover'),
  opacity: z.number().min(0).max(1).default(1),
  radius: z.number().min(0).max(2000).default(0),
});

export const shapeLayerSchema = z.object({
  ...layerBase,
  type: z.literal('shape'),
  role: z.enum(['overlay', 'panel', 'accent', 'divider']),
  box: boxSchema,
  color: hex,
  opacity: z.number().min(0).max(1).default(1),
  radius: z.number().min(0).max(2000).default(0),
  gradient: z
    .object({
      to: hex,
      angle: z.number().min(0).max(360).default(180),
      fromOpacity: z.number().min(0).max(1).default(1),
      toOpacity: z.number().min(0).max(1).default(1),
    })
    .nullable()
    .default(null),
});

export const layerSchema = z.discriminatedUnion('type', [textLayerSchema, imageLayerSchema, shapeLayerSchema]);

export const creativeDocumentSchema = z.object({
  v: z.literal(1),
  aspect: aspectRatioSchema,
  width: z.number().int().min(200).max(4096),
  height: z.number().int().min(200).max(4096),
  background: hex,
  fonts: z.object({ heading: fontFamilySchema, body: fontFamilySchema }),
  template: z.string().max(40).optional(),
  layers: z.array(layerSchema).max(40),
});

export type CreativeDocument = z.infer<typeof creativeDocumentSchema>;
export type CreativeDocumentInput = z.input<typeof creativeDocumentSchema>;
export type CreativeLayer = CreativeDocument['layers'][number];
export type TextLayer = z.infer<typeof textLayerSchema>;
export type ImageLayer = z.infer<typeof imageLayerSchema>;
export type ShapeLayer = z.infer<typeof shapeLayerSchema>;
export type TextRole = (typeof TEXT_ROLES)[number];

/** Validate + apply defaults. Throws ZodError. */
export function parseDocument(input: unknown): CreativeDocument {
  const doc = creativeDocumentSchema.parse(input);
  const ids = new Set<string>();
  for (const l of doc.layers) {
    if (ids.has(l.id)) throw new z.ZodError([{ code: 'custom', path: ['layers'], message: `מזהה שכבה כפול: ${l.id}` }]);
    ids.add(l.id);
  }
  return doc;
}

/** Text content by role — the copy the QA rules check. */
export function documentCopy(doc: CreativeDocument): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const l of doc.layers) {
    if (l.type !== 'text' || l.hidden) continue;
    const key = l.role === 'custom' ? l.id : l.role;
    copy[key] = copy[key] ? `${copy[key]}\n${l.text}` : l.text;
  }
  return copy;
}

/** Media ids referenced by image layers. */
export function documentMediaIds(doc: CreativeDocument): string[] {
  return [...new Set(doc.layers.flatMap((l) => (l.type === 'image' && l.mediaId && !l.hidden ? [l.mediaId] : [])))];
}
