/**
 * Brand-aware layout templates. Every template is a pure function of the copy,
 * the Brand Kit (colours, fonts, logo) and the aspect ratio, and returns an
 * editable CreativeDocument — nothing is hard-coded per brand.
 */
import type { AspectRatio } from '@mm/db';
import { contrastRatio, normalizeHex } from '../utils/color';
import { ASPECTS } from './document';
import type { Box, CreativeDocument, CreativeLayer } from './document';
import { resolveFontFamily } from './font-families';

export type TemplateId = 'bold' | 'photo' | 'clean';

export const TEMPLATES: { id: TemplateId; label: string; description: string; needsImage: boolean }[] = [
  { id: 'bold', label: 'נועז', description: 'רקע בצבע המותג, כותרת גדולה וכפתור קריאה לפעולה', needsImage: false },
  { id: 'photo', label: 'תמונה', description: 'תמונת רקע (מהספרייה או AI) עם הכהיה וטקסט בתחתית', needsImage: true },
  { id: 'clean', label: 'נקי', description: 'רקע בהיר, פס מותג וטיפוגרפיה כהה', needsImage: false },
];

export const templateIdSchemaValues = TEMPLATES.map((t) => t.id) as [TemplateId, ...TemplateId[]];

export interface ComposeCopy {
  headline: string;
  subheadline?: string | null;
  body?: string | null;
  cta?: string | null;
  price?: string | null;
  badge?: string | null;
}

export interface ComposeKit {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  logoMediaId: string | null;
}

export interface ComposeInput {
  aspect: AspectRatio;
  copy: ComposeCopy;
  kit: ComposeKit;
  template: TemplateId;
  backgroundMediaId?: string | null;
  /** The background is a video composited underneath (photo layout without an image layer). */
  backgroundIsVideo?: boolean;
}

type Family = 'square' | 'tall' | 'wide';
type Variant = 'top' | 'bottom';

interface Layout {
  logo: Box;
  badge: Box;
  headline: Box;
  subheadline: Box;
  price: Box;
  cta: Box;
  sizes: { headline: number; subheadline: number; price: number; cta: number; badge: number };
}

function familyOf(aspect: AspectRatio): Family {
  if (aspect === 'R9X16') return 'tall';
  if (aspect === 'R16X9' || aspect === 'R191X1') return 'wide';
  return 'square';
}

function layoutFor(family: Family, variant: Variant): Layout {
  if (family === 'tall') {
    return variant === 'top'
      ? {
          logo: { x: 6, y: 13, w: 26, h: 6 },
          badge: { x: 60, y: 13.5, w: 34, h: 5 },
          headline: { x: 6, y: 28, w: 88, h: 26 },
          subheadline: { x: 6, y: 55, w: 88, h: 11 },
          price: { x: 6, y: 67, w: 60, h: 5 },
          cta: { x: 6, y: 74, w: 52, h: 6 },
          sizes: { headline: 96, subheadline: 40, price: 40, cta: 32, badge: 26 },
        }
      : {
          logo: { x: 6, y: 13, w: 26, h: 6 },
          badge: { x: 60, y: 13.5, w: 34, h: 5 },
          headline: { x: 6, y: 50, w: 88, h: 20 },
          subheadline: { x: 6, y: 70, w: 88, h: 8 },
          price: { x: 6, y: 62, w: 60, h: 5 },
          cta: { x: 6, y: 79, w: 52, h: 6 },
          sizes: { headline: 88, subheadline: 38, price: 38, cta: 32, badge: 26 },
        };
  }
  if (family === 'wide') {
    return variant === 'top'
      ? {
          logo: { x: 4, y: 7, w: 16, h: 13 },
          badge: { x: 74, y: 8, w: 22, h: 11 },
          headline: { x: 4, y: 27, w: 64, h: 36 },
          subheadline: { x: 4, y: 64, w: 64, h: 14 },
          price: { x: 70, y: 36, w: 26, h: 14 },
          cta: { x: 4, y: 81, w: 30, h: 12 },
          sizes: { headline: 76, subheadline: 32, price: 40, cta: 28, badge: 24 },
        }
      : {
          logo: { x: 4, y: 7, w: 16, h: 13 },
          badge: { x: 74, y: 8, w: 22, h: 11 },
          headline: { x: 4, y: 40, w: 64, h: 30 },
          subheadline: { x: 4, y: 70, w: 64, h: 12 },
          price: { x: 70, y: 42, w: 26, h: 14 },
          cta: { x: 4, y: 84, w: 30, h: 11 },
          sizes: { headline: 70, subheadline: 30, price: 38, cta: 26, badge: 24 },
        };
  }
  return variant === 'top'
    ? {
        logo: { x: 6, y: 5, w: 24, h: 9 },
        badge: { x: 62, y: 6, w: 32, h: 7 },
        headline: { x: 6, y: 23, w: 88, h: 34 },
        subheadline: { x: 6, y: 59, w: 88, h: 14 },
        price: { x: 6, y: 74, w: 60, h: 8 },
        cta: { x: 6, y: 85, w: 48, h: 9 },
        sizes: { headline: 88, subheadline: 38, price: 38, cta: 30, badge: 26 },
      }
    : {
        logo: { x: 6, y: 5, w: 24, h: 9 },
        badge: { x: 62, y: 6, w: 32, h: 7 },
        headline: { x: 6, y: 50, w: 88, h: 24 },
        subheadline: { x: 6, y: 75, w: 88, h: 9 },
        price: { x: 6, y: 68, w: 60, h: 6 },
        cta: { x: 6, y: 86, w: 48, h: 8 },
        sizes: { headline: 80, subheadline: 36, price: 36, cta: 30, badge: 26 },
      };
}

function kitColor(kit: ComposeKit, key: string, fallback: string): string {
  return normalizeHex(kit.colors[key] ?? '') ?? fallback;
}

/** White or near-black, whichever reads better on `bg`. */
export function textOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

export function buildDocument(input: ComposeInput): CreativeDocument {
  const { width, height } = ASPECTS[input.aspect];
  const s = Math.min(width, height) / 1080;
  const family = familyOf(input.aspect);
  const primary = kitColor(input.kit, 'primary', '#1d4ed8');
  const secondary = kitColor(input.kit, 'secondary', primary);
  const accent = kitColor(input.kit, 'accent', secondary);
  const light = kitColor(input.kit, 'background', '#ffffff');
  const dark = kitColor(input.kit, 'foreground', '#111827');
  const heading = resolveFontFamily(input.kit.fonts.heading, 'Heebo');
  const body = resolveFontFamily(input.kit.fonts.body, heading === 'Heebo' ? 'Assistant' : 'Heebo');
  const headline = clean(input.copy.headline) ?? '';
  const subheadline = clean(input.copy.subheadline);
  const cta = clean(input.copy.cta);
  const price = clean(input.copy.price);
  const badge = clean(input.copy.badge);
  const hasImage = Boolean(input.backgroundMediaId) || Boolean(input.backgroundIsVideo);
  const template: TemplateId = input.template === 'photo' && !hasImage ? 'bold' : input.template;
  const variant: Variant = template === 'photo' || (template === 'clean' && hasImage) ? 'bottom' : 'top';
  const L = layoutFor(family, variant);
  const layers: CreativeLayer[] = [];
  const px = (n: number) => Math.round(n * s);

  let background = primary;
  let textColor = textOn(primary);
  let mutedColor = textColor;
  let ctaBg = light;
  let ctaColor = textOn(light);
  let priceColor = textColor;
  let badgeBg = accent;
  let badgeColor = textOn(accent);

  if (template === 'photo') {
    background = '#000000';
    textColor = '#ffffff';
    mutedColor = '#f3f4f6';
    ctaBg = primary;
    ctaColor = textOn(primary);
    priceColor = '#ffffff';
    if (!input.backgroundIsVideo) layers.push({ id: 'bg', type: 'image', role: 'background', mediaId: input.backgroundMediaId ?? null, box: { x: 0, y: 0, w: 100, h: 100 }, fit: 'cover', opacity: 1, radius: 0 });
    layers.push({
      id: 'overlay',
      type: 'shape',
      role: 'overlay',
      box: { x: 0, y: 0, w: 100, h: 100 },
      color: '#000000',
      opacity: 1,
      radius: 0,
      gradient: { to: '#000000', angle: 180, fromOpacity: 0.05, toOpacity: 0.82 },
    });
  } else if (template === 'clean') {
    background = light;
    textColor = dark;
    mutedColor = dark;
    ctaBg = primary;
    ctaColor = textOn(primary);
    priceColor = primary;
    badgeBg = primary;
    badgeColor = textOn(primary);
    layers.push({ id: 'bar', type: 'shape', role: 'accent', box: { x: 0, y: 0, w: 100, h: family === 'wide' ? 3 : 1.6 }, color: primary, opacity: 1, radius: 0, gradient: null });
    if (hasImage && !input.backgroundIsVideo) {
      const photoBox: Box = family === 'wide' ? { x: 50, y: 10, w: 46, h: 80 } : family === 'tall' ? { x: 6, y: 20, w: 88, h: 28 } : { x: 6, y: 16, w: 88, h: 32 };
      layers.push({ id: 'photo', type: 'image', role: 'photo', mediaId: input.backgroundMediaId ?? null, box: photoBox, fit: 'cover', opacity: 1, radius: px(28) });
    }
  } else {
    layers.push({
      id: 'glow',
      type: 'shape',
      role: 'accent',
      box: family === 'wide' ? { x: 62, y: -20, w: 50, h: 140 } : { x: 45, y: -15, w: 80, h: 60 },
      color: secondary,
      opacity: secondary === primary ? 0.12 : 0.28,
      radius: px(900),
      gradient: null,
    });
  }

  if (input.kit.logoMediaId) {
    layers.push({ id: 'logo', type: 'image', role: 'logo', mediaId: input.kit.logoMediaId, box: L.logo, fit: 'contain', opacity: 1, radius: 0 });
  }
  if (badge) {
    layers.push({
      id: 'badge',
      type: 'text',
      role: 'badge',
      text: badge,
      box: L.badge,
      font: 'body',
      size: px(L.sizes.badge),
      weight: 700,
      color: badgeColor,
      align: 'end',
      valign: 'top',
      lineHeight: 1.1,
      background: badgeBg,
      radius: px(999),
      padding: px(12),
      autofit: true,
      shadow: false,
      letterSpacing: 0,
      opacity: 1,
    });
  }
  layers.push({
    id: 'headline',
    type: 'text',
    role: 'headline',
    text: headline,
    box: L.headline,
    font: 'heading',
    size: px(L.sizes.headline),
    weight: 800,
    color: textColor,
    align: 'start',
    valign: variant === 'bottom' ? 'bottom' : 'top',
    lineHeight: 1.08,
    background: null,
    radius: 0,
    padding: 0,
    autofit: true,
    shadow: template === 'photo',
    letterSpacing: 0,
    opacity: 1,
  });
  if (subheadline) {
    layers.push({
      id: 'subheadline',
      type: 'text',
      role: 'subheadline',
      text: subheadline,
      box: L.subheadline,
      font: 'body',
      size: px(L.sizes.subheadline),
      weight: 500,
      color: mutedColor,
      align: 'start',
      valign: 'top',
      lineHeight: 1.25,
      background: null,
      radius: 0,
      padding: 0,
      autofit: true,
      shadow: template === 'photo',
      letterSpacing: 0,
      opacity: template === 'clean' ? 0.8 : 0.92,
    });
  }
  if (price) {
    layers.push({
      id: 'price',
      type: 'text',
      role: 'price',
      text: price,
      box: L.price,
      font: 'heading',
      size: px(L.sizes.price),
      weight: 700,
      color: priceColor,
      align: family === 'wide' ? 'end' : 'start',
      valign: 'top',
      lineHeight: 1.1,
      background: null,
      radius: 0,
      padding: 0,
      autofit: true,
      shadow: template === 'photo',
      letterSpacing: 0,
      opacity: 1,
    });
  }
  if (cta) {
    layers.push({
      id: 'cta',
      type: 'text',
      role: 'cta',
      text: cta,
      box: L.cta,
      font: 'body',
      size: px(L.sizes.cta),
      weight: 700,
      color: ctaColor,
      align: 'start',
      valign: 'top',
      lineHeight: 1.1,
      background: ctaBg,
      radius: px(999),
      padding: px(18),
      autofit: true,
      shadow: false,
      letterSpacing: 0,
      opacity: 1,
    });
  }

  return { v: 1, aspect: input.aspect, width, height, background, fonts: { heading, body }, template, layers };
}

export interface ReelOverlayInput {
  aspect: AspectRatio;
  headline: string | null;
  kit: ComposeKit;
}

/** Vertical band (percent of height) kept free for burnt-in subtitles, per aspect family. */
export function subtitleBand(aspect: AspectRatio): { top: number; bottom: number } {
  const family = familyOf(aspect);
  return family === 'tall' ? { top: 58, bottom: 72 } : family === 'wide' ? { top: 74, bottom: 92 } : { top: 70, bottom: 90 };
}

/**
 * Overlay for video scenes (Reels / Stories / feed video): the on-screen headline sits in the upper
 * band, the logo in the corner, soft shading keeps both legible, and the lower band stays free for
 * the burnt-in subtitles (above the platform UI that covers the bottom of vertical videos).
 */
export function buildReelOverlay(input: ReelOverlayInput): CreativeDocument {
  const { width, height } = ASPECTS[input.aspect];
  const s = Math.min(width, height) / 1080;
  const px = (n: number) => Math.round(n * s);
  const family = familyOf(input.aspect);
  const heading = resolveFontFamily(input.kit.fonts.heading, 'Heebo');
  const body = resolveFontFamily(input.kit.fonts.body, heading === 'Heebo' ? 'Assistant' : 'Heebo');
  const band = subtitleBand(input.aspect);
  const layers: CreativeLayer[] = [];
  const topShade = family === 'tall' ? 34 : family === 'wide' ? 38 : 34;
  layers.push({ id: 'shade-top', type: 'shape', role: 'overlay', box: { x: 0, y: 0, w: 100, h: topShade }, color: '#000000', opacity: 1, radius: 0, gradient: { to: '#000000', angle: 180, fromOpacity: 0.5, toOpacity: 0 } });
  layers.push({ id: 'shade-bottom', type: 'shape', role: 'overlay', box: { x: 0, y: band.top - 10, w: 100, h: 110 - band.top }, color: '#000000', opacity: 1, radius: 0, gradient: { to: '#000000', angle: 180, fromOpacity: 0, toOpacity: 0.5 } });
  if (input.kit.logoMediaId) {
    const logoBox: Box = family === 'tall' ? { x: 6, y: 7, w: 26, h: 5 } : family === 'wide' ? { x: 3, y: 5, w: 14, h: 10 } : { x: 5, y: 5, w: 22, h: 7 };
    layers.push({ id: 'logo', type: 'image', role: 'logo', mediaId: input.kit.logoMediaId, box: logoBox, fit: 'contain', opacity: 1, radius: 0 });
  }
  const headline = clean(input.headline);
  if (headline) {
    const box: Box = family === 'tall' ? { x: 6, y: 14, w: 88, h: 15 } : family === 'wide' ? { x: 20, y: 6, w: 60, h: 22 } : { x: 6, y: 14, w: 88, h: 17 };
    layers.push({
      id: 'headline',
      type: 'text',
      role: 'headline',
      text: headline,
      box,
      font: 'heading',
      size: px(family === 'tall' ? 84 : family === 'wide' ? 64 : 72),
      weight: 800,
      color: '#ffffff',
      align: 'center',
      valign: 'top',
      lineHeight: 1.08,
      background: null,
      radius: 0,
      padding: 0,
      autofit: true,
      shadow: true,
      letterSpacing: 0,
      opacity: 1,
    });
  }
  return { v: 1, aspect: input.aspect, width, height, background: '#000000', fonts: { heading, body }, template: 'reel', layers };
}
