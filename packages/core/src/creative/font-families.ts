/** Bundled Hebrew font families — pure module, safe for browser bundles. */

export const FONT_FAMILIES = ['Heebo', 'Assistant', 'Rubik', 'Noto Sans Hebrew'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_FILES: Record<FontFamily, string> = {
  Heebo: 'Heebo.ttf',
  Assistant: 'Assistant.ttf',
  Rubik: 'Rubik.ttf',
  'Noto Sans Hebrew': 'NotoSansHebrew.ttf',
};

/** Map a brand-kit font name (e.g. "Rubik, sans-serif") to a bundled family. */
export function resolveFontFamily(name: string | null | undefined, fallback: FontFamily): FontFamily {
  if (!name) return fallback;
  const first = (name.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  for (const f of FONT_FAMILIES) if (f.toLowerCase() === first) return f;
  if (first.includes('noto')) return 'Noto Sans Hebrew';
  if (first.includes('rubik')) return 'Rubik';
  if (first.includes('assistant')) return 'Assistant';
  if (first.includes('heebo')) return 'Heebo';
  return fallback;
}

/** Public URL served by the web app (apps/web/public/fonts). */
export function fontPublicUrl(family: FontFamily): string {
  return `/fonts/${FONT_FILES[family]}`;
}
