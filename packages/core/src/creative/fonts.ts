/**
 * Bundled Hebrew fonts (SIL OFL, see packages/core/assets/fonts/OFL-NOTICE.txt).
 * The browser preview loads them from /fonts/*, the Chromium renderer embeds
 * them as data: URIs so the document is fully self-contained.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { FONT_FAMILIES, FONT_FILES } from './font-families';
import type { FontFamily } from './font-families';

export * from './font-families';

let dirCache: string | null | undefined;

/** Directory holding the bundled TTF files (MM_FONTS_DIR, else resolved from cwd / module location). */
export function fontsDir(): string | null {
  if (dirCache !== undefined) return dirCache;
  const here = typeof __dirname === 'string' ? __dirname : null;
  const candidates = [
    process.env.MM_FONTS_DIR,
    path.resolve(process.cwd(), 'packages/core/assets/fonts'),
    path.resolve(process.cwd(), '../../packages/core/assets/fonts'),
    path.resolve(process.cwd(), 'assets/fonts'),
    here ? path.resolve(here, '../../assets/fonts') : undefined,
    here ? path.resolve(here, '../../../packages/core/assets/fonts') : undefined,
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  dirCache = candidates.find((c) => existsSync(path.join(c, FONT_FILES.Heebo))) ?? null;
  return dirCache;
}

const dataUrlCache = new Map<FontFamily, string>();

/** data: URI of the font file for self-contained (Chromium) documents; null when the file is unavailable. */
export function fontDataUrl(family: FontFamily): string | null {
  const cached = dataUrlCache.get(family);
  if (cached) return cached;
  const dir = fontsDir();
  if (!dir) return null;
  const file = path.join(dir, FONT_FILES[family]);
  if (!existsSync(file)) return null;
  const url = `data:font/ttf;base64,${readFileSync(file).toString('base64')}`;
  dataUrlCache.set(family, url);
  return url;
}

/** data: URIs for every bundled family — pass as `fontSrc` for render-mode HTML. */
export function renderFontSources(): Partial<Record<FontFamily, string>> {
  const out: Partial<Record<FontFamily, string>> = {};
  for (const family of FONT_FAMILIES) {
    const url = fontDataUrl(family);
    if (url) out[family] = url;
  }
  return out;
}
