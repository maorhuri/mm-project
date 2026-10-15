/**
 * Website brand import: analyse a brand's public website and SUGGEST colours,
 * fonts, logo candidates and a description. Nothing is saved until the user
 * applies a selection — the analysis is a proposal derived from the site's CSS
 * and markup, never a guess.
 */
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import type { BrandAssetType } from '@mm/db';
import { auditFromContext } from '../audit';
import { getConfig } from '../config';
import { ValidationError } from '../errors';
import { logger } from '../logger';
import { safeFetch } from '../net/safe-fetch';
import type { Fetcher } from '../net/safe-fetch';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import { contrastRatio, hexToHsl, hueDistance, isNeutral, parseCssColor } from '../utils/color';
import type { BrandImportApplyInput } from '../validation';
import { getBrand, getBrandKit, setBrandAsset, updateBrand, updateBrandSettings } from './brands';
import type { BrandKit } from './brands';
import { resolveMediaType, uploadMedia } from './media';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColorSource = 'css' | 'css-variable' | 'theme-color' | 'inline-style' | 'logo';
export type FontSource = 'google-fonts' | 'font-face' | 'css';
export type LogoKind = 'apple-touch-icon' | 'og-image' | 'img-logo' | 'icon';

export interface ColorCandidate {
  hex: string;
  /** Weighted frequency across stylesheets (variables and theme-color count extra). */
  score: number;
  sources: ColorSource[];
  neutral: boolean;
  /** CSS variable names that resolve to this colour, e.g. `--primary`. */
  variables: string[];
}

export interface FontCandidate {
  family: string;
  score: number;
  sources: FontSource[];
}

export interface LogoCandidate {
  url: string;
  kind: LogoKind;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  /** True when the file type can be imported into the media library. */
  importable: boolean;
}

export interface BrandSiteAnalysis {
  requestedUrl: string;
  finalUrl: string;
  fetchedAt: string;
  title: string | null;
  description: string | null;
  language: string | null;
  themeColor: string | null;
  colors: ColorCandidate[];
  fonts: FontCandidate[];
  logos: LogoCandidate[];
  suggestions: {
    colors: Partial<Record<'primary' | 'secondary' | 'accent' | 'background' | 'foreground', string>>;
    fonts: { heading?: string; body?: string };
  };
  stats: { stylesheets: number; cssBytes: number; htmlBytes: number };
  warnings: string[];
}

export interface AnalyzeOptions {
  fetcher?: Fetcher;
  /** Download the best logo candidate to read its size and dominant colour (default true). */
  inspectLogo?: boolean;
}

const HTML_MAX = 2 * 1024 * 1024;
const CSS_MAX = 1.5 * 1024 * 1024;
const LOGO_MAX = 3 * 1024 * 1024;
const MAX_STYLESHEETS = 8;
const GENERIC_FONTS = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'roboto',
  'helvetica neue',
  'helvetica',
  'arial',
  'noto sans',
  'apple color emoji',
  'segoe ui emoji',
  'segoe ui symbol',
  'noto color emoji',
  'sfmono-regular',
  'menlo',
  'monaco',
  'consolas',
  'liberation mono',
  'courier new',
  'courier',
  'georgia',
  'times new roman',
  'times',
  'verdana',
  'tahoma',
  'inherit',
  'initial',
  'unset',
  'var',
  'emoji',
  'math',
]);

/** Icon/symbol fonts are never brand typography. */
const ICON_FONT_RE =
  /(font ?awesome|fontawesome|material (icons|symbols)|icomoon|glyphicons|dashicons|eicons|elementor-icons|fontello|bootstrap-icons|ionicons|feather|simple-line-icons|themify|linearicons|genericons|slick|swiper-icons|woocommerce|wp-|revicons|fa-|icon)/i;

// ---------------------------------------------------------------------------
// CSS extraction (pure)
// ---------------------------------------------------------------------------

const COLOR_TOKEN_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?:rgb|hsl)a?\([^)]*\)/gi;
const COLOR_DECL_RE =
  /(?:^|[;{\s])(background(?:-color)?|color|border(?:-[a-z]+)?-color|border|fill|stroke|outline-color|box-shadow|text-decoration-color)\s*:\s*([^;}]+)/gi;
const VAR_DECL_RE = /(--[\w-]+)\s*:\s*([^;}]+)/g;
const VAR_REF_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/gi;
const FONT_FACE_RE = /@font-face\s*{([^}]*)}/gi;
const FONT_SHORTHAND_RE = /(?:^|[;{\s])font\s*:\s*([^;}]+)/gi;
const BRAND_VAR_HINT = /(primary|brand|accent|main|theme|secondary|highlight|cta)/i;

function cleanFamily(raw: string): string | null {
  const f = raw.trim().replace(/^["']|["']$/g, '').trim();
  // Real families have ≥3 characters and letters; 1–2 letter tokens are minifier noise.
  if (!f || f.length < 3 || f.length > 60 || !/[a-z֐-׿]{2}/i.test(f)) return null;
  if (f.startsWith('var(') || f.includes('{') || f.includes('}')) return null;
  if (GENERIC_FONTS.has(f.toLowerCase())) return null;
  if (ICON_FONT_RE.test(f)) return null;
  return f;
}

export function extractCssVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of css.matchAll(VAR_DECL_RE)) {
    const name = m[1]!;
    const value = m[2]!.trim();
    if (!vars.has(name)) vars.set(name, value);
  }
  return vars;
}

function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 4 || !value.includes('var(')) return value;
  return value.replace(VAR_REF_RE, (_m, name: string, fallback?: string) => {
    const v = vars.get(name);
    if (v !== undefined) return resolveVars(v, vars, depth + 1);
    return fallback ? resolveVars(fallback, vars, depth + 1) : '';
  });
}

interface ColorAcc {
  score: number;
  sources: Set<ColorSource>;
  variables: Set<string>;
}

function addColor(acc: Map<string, ColorAcc>, hex: string, weight: number, source: ColorSource, variable?: string) {
  const entry = acc.get(hex) ?? { score: 0, sources: new Set<ColorSource>(), variables: new Set<string>() };
  entry.score += weight;
  entry.sources.add(source);
  if (variable) entry.variables.add(variable);
  acc.set(hex, entry);
}

function colorsFromValue(value: string): string[] {
  const out: string[] = [];
  for (const token of value.match(COLOR_TOKEN_RE) ?? []) {
    const parsed = parseCssColor(token);
    if (parsed && parsed.alpha >= 0.3) out.push(parsed.hex);
  }
  if (out.length === 0) {
    const named = parseCssColor(value.trim().split(/\s+/)[0] ?? '');
    if (named) out.push(named.hex);
  }
  return out;
}

/** Count colours in CSS text, resolving custom properties. Mutates `acc`. */
export function extractColors(css: string, acc: Map<string, ColorAcc>, source: ColorSource): void {
  const vars = extractCssVariables(css);
  for (const [name, raw] of vars) {
    const resolved = resolveVars(raw, vars);
    for (const hex of colorsFromValue(resolved)) {
      addColor(acc, hex, BRAND_VAR_HINT.test(name) ? 6 : 2, 'css-variable', name);
    }
  }
  for (const m of css.matchAll(COLOR_DECL_RE)) {
    const prop = m[1]!.toLowerCase();
    const value = resolveVars(m[2]!, vars);
    const weight = prop === 'background' || prop === 'background-color' || prop === 'color' ? 1 : 0.5;
    for (const hex of colorsFromValue(value)) addColor(acc, hex, weight, source);
  }
}

/** Count font families in CSS text. Mutates `acc`. */
export function extractFonts(css: string, acc: Map<string, { score: number; sources: Set<FontSource> }>): void {
  const add = (family: string, weight: number, source: FontSource) => {
    const key = family.toLowerCase();
    const e = acc.get(key) ?? { score: 0, sources: new Set<FontSource>() };
    e.score += weight;
    e.sources.add(source);
    acc.set(key, e);
    familyNames.set(key, familyNames.get(key) ?? family);
  };
  for (const m of css.matchAll(FONT_FACE_RE)) {
    const fam = /font-family\s*:\s*([^;]+)/i.exec(m[1]!);
    const f = fam ? cleanFamily(fam[1]!) : null;
    if (f) add(f, 5, 'font-face');
  }
  const vars = extractCssVariables(css);
  for (const m of css.matchAll(FONT_FAMILY_RE)) {
    const list = resolveVars(m[1]!, vars).split(',');
    const first = list.map(cleanFamily).find(Boolean);
    if (first) add(first, 1, 'css');
  }
  for (const m of css.matchAll(FONT_SHORTHAND_RE)) {
    const value = resolveVars(m[1]!, vars);
    // shorthand: the family list is everything after the size/line-height token
    const after = value.split(/\s+(?=[^\d])/).slice(-1)[0] ?? '';
    const first = after.split(',').map(cleanFamily).find(Boolean);
    if (first && /\d/.test(value)) add(first, 0.5, 'css');
  }
}

const familyNames = new Map<string, string>();

export function fontsFromGoogleFontsUrl(href: string): string[] {
  const families: string[] = [];
  try {
    const u = new URL(href, 'https://fonts.googleapis.com/');
    if (!u.hostname.endsWith('fonts.googleapis.com')) return families;
    for (const value of u.searchParams.getAll('family')) {
      for (const part of value.split('|')) {
        const name = part.split(':')[0]?.replace(/\+/g, ' ').trim();
        if (name) families.push(name);
      }
    }
  } catch {
    /* ignore malformed */
  }
  return families;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function abs(base: string, href: string | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function suggestColors(colors: ColorCandidate[]): BrandSiteAnalysis['suggestions']['colors'] {
  const brand = colors.filter((c) => !c.neutral);
  const neutrals = colors.filter((c) => c.neutral);
  const out: BrandSiteAnalysis['suggestions']['colors'] = {};
  const primary = brand[0];
  if (primary) out.primary = primary.hex;
  const secondary = brand.find(
    (c) => primary && c.hex !== primary.hex && (hueDistance(c.hex, primary.hex) > 25 || Math.abs(hexToHsl(c.hex).l - hexToHsl(primary.hex).l) > 0.25),
  );
  if (secondary) out.secondary = secondary.hex;
  const accent = brand.find((c) => c.hex !== primary?.hex && c.hex !== secondary?.hex);
  if (accent) out.accent = accent.hex;
  const background = neutrals.find((c) => hexToHsl(c.hex).l > 0.85);
  out.background = background?.hex ?? '#ffffff';
  const foreground = neutrals.find((c) => hexToHsl(c.hex).l < 0.3 && contrastRatio(c.hex, out.background!) >= 4.5);
  out.foreground = foreground?.hex ?? '#111827';
  return out;
}

/** Prefer fonts the site deliberately loads (Google Fonts / @font-face) over stack fallbacks. */
function suggestFonts(fonts: FontCandidate[]): BrandSiteAnalysis['suggestions']['fonts'] {
  const deliberate = fonts.filter((f) => f.sources.includes('google-fonts') || f.sources.includes('font-face') || f.score >= 3);
  const pool = deliberate.length > 0 ? deliberate : fonts;
  const heading = pool[0]?.family;
  const body = pool[1]?.family ?? heading;
  return { heading, body };
}

export async function analyzeBrandWebsite(requestedUrl: string, options: AnalyzeOptions = {}): Promise<BrandSiteAnalysis> {
  const fetcher = options.fetcher ?? safeFetch;
  const warnings: string[] = [];
  familyNames.clear();

  const page = await fetcher(requestedUrl, { maxBytes: HTML_MAX, timeoutMs: 12_000, accept: 'text/html,application/xhtml+xml' });
  if (page.status >= 400) throw new ValidationError(`The website answered with HTTP ${page.status}`);
  if (!page.contentType.includes('html') && !page.body.subarray(0, 512).toString('utf8').toLowerCase().includes('<html')) {
    throw new ValidationError('The URL does not return an HTML page');
  }
  const html = page.body.toString('utf8');
  const $ = cheerio.load(html);
  const base = abs(page.url, $('base[href]').attr('href')) ?? page.url;

  const title = $('title').first().text().trim() || $('meta[property="og:title"]').attr('content')?.trim() || null;
  const description =
    $('meta[name="description"]').attr('content')?.trim() || $('meta[property="og:description"]').attr('content')?.trim() || null;
  const language = $('html').attr('lang')?.trim() || null;
  const themeColorRaw = $('meta[name="theme-color"]').attr('content')?.trim();
  const themeColor = themeColorRaw ? (parseCssColor(themeColorRaw)?.hex ?? null) : null;

  // --- stylesheets ---------------------------------------------------------
  const sheetUrls: string[] = [];
  const googleFamilies: string[] = [];
  $('link[rel~="stylesheet"][href], link[rel="preload"][as="style"][href]').each((_i, el) => {
    const href = abs(base, $(el).attr('href'));
    if (!href) return;
    if (href.includes('fonts.googleapis.com')) googleFamilies.push(...fontsFromGoogleFontsUrl(href));
    else if (!sheetUrls.includes(href)) sheetUrls.push(href);
  });
  $('link[href*="fonts.googleapis.com"]').each((_i, el) => {
    googleFamilies.push(...fontsFromGoogleFontsUrl($(el).attr('href') ?? ''));
  });
  if (sheetUrls.length > MAX_STYLESHEETS) {
    warnings.push(`Only the first ${MAX_STYLESHEETS} of ${sheetUrls.length} stylesheets were analysed`);
  }
  const sheets = await Promise.all(
    sheetUrls.slice(0, MAX_STYLESHEETS).map(async (url) => {
      try {
        const res = await fetcher(url, { maxBytes: CSS_MAX, timeoutMs: 10_000, accept: 'text/css,*/*;q=0.1' });
        if (res.status >= 400) {
          warnings.push(`Stylesheet ${url} answered HTTP ${res.status}`);
          return '';
        }
        return res.body.toString('utf8');
      } catch (err) {
        warnings.push(`Stylesheet ${url} could not be read (${err instanceof Error ? err.message : 'error'})`);
        return '';
      }
    }),
  );

  const inlineStyles = $('style')
    .map((_i, el) => $(el).text())
    .get()
    .join('\n');
  const styleAttrs = $('[style]')
    .map((_i, el) => `x{${$(el).attr('style') ?? ''}}`)
    .get()
    .join('\n');
  const externalCss = sheets.join('\n');
  const cssBytes = Buffer.byteLength(inlineStyles) + Buffer.byteLength(styleAttrs) + Buffer.byteLength(externalCss);

  // --- colours -------------------------------------------------------------
  const colorAcc = new Map<string, ColorAcc>();
  extractColors(externalCss, colorAcc, 'css');
  extractColors(inlineStyles, colorAcc, 'css');
  extractColors(styleAttrs, colorAcc, 'inline-style');
  if (themeColor) addColor(colorAcc, themeColor, 8, 'theme-color');

  // --- fonts ---------------------------------------------------------------
  const fontAcc = new Map<string, { score: number; sources: Set<FontSource> }>();
  extractFonts(externalCss, fontAcc);
  extractFonts(inlineStyles, fontAcc);
  extractFonts(styleAttrs, fontAcc);
  for (const fam of googleFamilies) {
    const key = fam.toLowerCase();
    const e = fontAcc.get(key) ?? { score: 0, sources: new Set<FontSource>() };
    e.score += 4;
    e.sources.add('google-fonts');
    fontAcc.set(key, e);
    familyNames.set(key, familyNames.get(key) ?? fam);
  }

  // --- logo candidates -----------------------------------------------------
  const logos: LogoCandidate[] = [];
  const makeCandidate = (href: string | undefined, kind: LogoKind): LogoCandidate | null => {
    const url = abs(base, href);
    if (!url || logos.some((l) => l.url === url)) return null;
    const type = resolveMediaType(undefined, new URL(url).pathname);
    return { url, kind, width: null, height: null, mimeType: type?.mime ?? null, importable: type?.kind === 'IMAGE' };
  };
  const pushLogo = (href: string | undefined, kind: LogoKind) => {
    const c = makeCandidate(href, kind);
    if (c) logos.push(c);
  };
  $('link[rel~="apple-touch-icon"][href]').each((_i, el) => pushLogo($(el).attr('href'), 'apple-touch-icon'));

  // <img> logos: rank the brand's own logo above partner/client logos.
  const origin = new URL(base).origin;
  const hostLabel = new URL(base).hostname.replace(/^www\./, '').split('.')[0] ?? '';
  const imgCandidates: { candidate: LogoCandidate; score: number }[] = [];
  $('img').each((_i, el) => {
    const $el = $(el);
    const hint = `${$el.attr('src') ?? ''} ${$el.attr('alt') ?? ''} ${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`.toLowerCase();
    if (!hint.includes('logo')) return;
    const candidate = makeCandidate($el.attr('src') ?? $el.attr('data-src'), 'img-logo');
    if (!candidate) return;
    let score = 0;
    if (hostLabel.length >= 2 && hint.includes(hostLabel)) score += 4;
    if ($el.closest('header, nav, .navbar, .header, [class*="header"], [class*="navbar"], [id*="header"], [class*="brand"]').length) score += 3;
    if ($el.closest(`a[href="/"], a[href="${origin}"], a[href="${origin}/"]`).length) score += 3;
    if (/(partner|client|customer|vendor|sponsor|tech|stack|integration|certif)/.test(hint)) score -= 3;
    if (/(zabbix|grafana|prometheus|aws|google|microsoft|cloudflare|wordpress|woocommerce|cpanel|plesk|litespeed)/.test(hint)) score -= 2;
    imgCandidates.push({ candidate, score });
    logos.push(candidate); // reserve the URL for de-duplication; replaced by the ranked list below
  });
  // Replace the DOM-ordered img entries with the ranked top 4.
  for (const { candidate } of imgCandidates) logos.splice(logos.indexOf(candidate), 1);
  imgCandidates.sort((a, b) => b.score - a.score);
  for (const { candidate } of imgCandidates.slice(0, 4)) logos.push(candidate);

  pushLogo($('meta[property="og:image"]').attr('content'), 'og-image');
  $('link[rel~="icon"][href]').each((_i, el) => pushLogo($(el).attr('href'), 'icon'));
  const logoList = logos.slice(0, 8);

  if (options.inspectLogo !== false) {
    const best = logoList.find((l) => l.importable);
    if (best) {
      try {
        const res = await fetcher(best.url, { maxBytes: LOGO_MAX, timeoutMs: 10_000, accept: 'image/*' });
        if (res.status < 400 && !res.contentType.includes('svg')) {
          const img = sharp(res.body, { failOn: 'none' });
          const [meta, stats] = await Promise.all([img.metadata(), img.stats()]);
          best.width = meta.width ?? null;
          best.height = meta.height ?? null;
          const dom = stats.dominant;
          const hex = `#${[dom.r, dom.g, dom.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
          if (!isNeutral(hex)) addColor(colorAcc, hex, 4, 'logo');
        }
      } catch (err) {
        warnings.push(`Logo ${best.url} could not be inspected (${err instanceof Error ? err.message : 'error'})`);
      }
    }
  }

  // --- rank ----------------------------------------------------------------
  const colors: ColorCandidate[] = [...colorAcc.entries()]
    .map(([hex, e]) => ({ hex, score: Math.round(e.score * 10) / 10, sources: [...e.sources], neutral: isNeutral(hex), variables: [...e.variables].slice(0, 6) }))
    .sort((a, b) => b.score - a.score);
  const brandColors = colors.filter((c) => !c.neutral).slice(0, 10);
  const neutralColors = colors.filter((c) => c.neutral).slice(0, 4);
  const rankedColors = [...brandColors, ...neutralColors];

  const fonts: FontCandidate[] = [...fontAcc.entries()]
    .map(([key, e]) => ({ family: familyNames.get(key) ?? key, score: Math.round(e.score * 10) / 10, sources: [...e.sources] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (rankedColors.length === 0) warnings.push('No colours were found in the site CSS');
  if (fonts.length === 0) warnings.push('No fonts were found in the site CSS');

  return {
    requestedUrl,
    finalUrl: page.url,
    fetchedAt: new Date().toISOString(),
    title,
    description,
    language,
    themeColor,
    colors: rankedColors,
    fonts,
    logos: logoList,
    suggestions: {
      colors: suggestColors(rankedColors),
      fonts: suggestFonts(fonts),
    },
    stats: { stylesheets: sheets.filter(Boolean).length, cssBytes, htmlBytes: page.body.length },
    warnings,
  };
}

/** Analyse the brand's configured website (or an explicit URL). */
export async function analyzeBrandSite(ctx: BrandContext, url?: string | null, options: AnalyzeOptions = {}): Promise<BrandSiteAnalysis> {
  assertBrandRole(ctx, 'EDITOR');
  const target = url?.trim() || (await getBrand(ctx)).websiteUrl;
  if (!target) throw new ValidationError('Set the brand website URL first');
  const analysis = await analyzeBrandWebsite(target, options);
  await auditFromContext(ctx, {
    action: 'brand.import.analyze',
    entityType: 'brand',
    entityId: ctx.brandId,
    metadata: { url: analysis.finalUrl, colors: analysis.colors.length, fonts: analysis.fonts.length, logos: analysis.logos.length },
  });
  return analysis;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export async function importLogoFromUrl(
  ctx: BrandContext,
  url: string,
  type: BrandAssetType,
  options: { fetcher?: Fetcher } = {},
): Promise<string> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const fetcher = options.fetcher ?? safeFetch;
  const maxBytes = getConfig().MEDIA_MAX_UPLOAD_MB * 1024 * 1024;
  const res = await fetcher(url, { maxBytes: Math.min(maxBytes, LOGO_MAX * 4), timeoutMs: 15_000, accept: 'image/*' });
  if (res.status >= 400) throw new ValidationError(`Logo URL answered HTTP ${res.status}`);
  const pathname = new URL(res.url).pathname;
  const originalName = path.basename(pathname) || 'logo';
  const asset = await uploadMedia(ctx, {
    data: res.body,
    originalName,
    mimeType: res.contentType.split(';')[0]?.trim() || undefined,
    source: 'IMPORTED',
    title: `לוגו מיובא מהאתר (${type.toLowerCase().replace('logo_', '')})`,
    tags: ['logo', 'imported'],
  });
  await setBrandAsset(ctx, { type, mediaAssetId: asset.id, label: 'ייבוא מהאתר' });
  return asset.id;
}

/** Persist the user's selection from an analysis. Only the provided parts change. */
export async function applyBrandImport(ctx: BrandContext, input: BrandImportApplyInput): Promise<BrandKit> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const kit = await getBrandKit(ctx);
  const applied: string[] = [];

  if (input.colors && Object.keys(input.colors).length > 0) {
    const existing = (kit.settings.colors ?? {}) as Record<string, string>;
    await updateBrandSettings(ctx, { colors: { ...existing, ...input.colors } });
    applied.push('colors');
  }
  if (input.fonts && (input.fonts.heading || input.fonts.body)) {
    const existing = (kit.settings.fonts ?? {}) as Record<string, string>;
    await updateBrandSettings(ctx, { fonts: { ...existing, ...input.fonts } });
    applied.push('fonts');
  }
  if (input.description) {
    await updateBrand(ctx, { description: input.description });
    applied.push('description');
  }
  if (input.logo) {
    try {
      await importLogoFromUrl(ctx, input.logo.url, input.logo.type);
      applied.push('logo');
    } catch (err) {
      logger.warn({ err, url: input.logo.url }, 'logo import failed');
      throw err instanceof ValidationError ? err : new ValidationError('Logo could not be imported');
    }
  }
  await auditFromContext(ctx, {
    action: 'brand.import.apply',
    entityType: 'brand',
    entityId: ctx.brandId,
    metadata: { applied, sourceUrl: input.sourceUrl ?? null },
  });
  return getBrandKit(ctx);
}
