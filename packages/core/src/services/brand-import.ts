/**
 * Website brand import: analyse a brand's public website and SUGGEST colours,
 * fonts, logo candidates and a description. Nothing is saved until the user
 * applies a selection — the analysis is a proposal derived from the site's CSS
 * and markup, never a guess.
 */
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import type { BrandAssetType, MediaAsset } from '@mm/db';
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
  /** How often the family is used in heading (h1–h6/title) vs body (body/html/p) rules. */
  roles: { heading: number; body: number };
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
const LOGO_MAX_PIXELS = 25_000_000;

// Budgets for custom-property resolution: bounded work regardless of input.
const VAR_MAX_INPUT = 4 * 1024;
const VAR_MAX_OUTPUT = 2 * 1024;
const VAR_MAX_REFS = 32;
const MAX_COLOR_TOKENS_PER_VALUE = 64;

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

const COLOR_TOKEN_RE =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgb|hsl)a?\([^)]*\)|\b(?:oklch|oklab|lch|lab|hwb)\([^)]*\)|\bcolor\((?:srgb|srgb-linear|display-p3|rec2020|a98-rgb|prophoto-rgb)[^)]*\)/gi;
const COLOR_DECL_RE =
  /(?:^|[;{\s])(background(?:-color)?|color|border(?:-[a-z]+)?-color|border|fill|stroke|outline-color|box-shadow|text-decoration-color)\s*:\s*([^;}]+)/gi;
const VAR_DECL_RE = /(--[\w-]+)\s*:\s*([^;}]+)/g;
const VAR_REF_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/gi;
const FONT_FACE_RE = /@font-face\s*{([^}]*)}/gi;
const FONT_SHORTHAND_RE = /(?:^|[;{\s])font\s*:\s*([^;}]+)/gi;
const IMPORTANT_RE = /\s*!\s*important\s*$/i;
const BRAND_VAR_HINT = /(primary|brand|accent|main|theme|secondary|highlight|cta)/i;
const FONT_SIZE_RE = /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|pt|vw|vh|ch|ex|cm|mm|in|pc|vmin|vmax)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)(?:\/.*)?$/i;

function cleanFamily(raw: string): string | null {
  const f = raw.replace(IMPORTANT_RE, '').trim().replace(/^["']|["']$/g, '').trim();
  // Real families have ≥3 characters and letters; 1–2 letter tokens are minifier noise.
  if (!f || f.length < 3 || f.length > 60 || !/[a-z֐-׿]{2}/i.test(f)) return null;
  if (f.startsWith('var(') || f.includes('{') || f.includes('}') || f.includes('"') || f.includes("'")) return null;
  if (GENERIC_FONTS.has(f.toLowerCase())) return null;
  if (ICON_FONT_RE.test(f)) return null;
  return f;
}

export function extractCssVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of css.matchAll(VAR_DECL_RE)) {
    const name = m[1]!;
    const value = m[2]!.replace(IMPORTANT_RE, '').trim();
    if (!vars.has(name)) vars.set(name, value);
  }
  return vars;
}

/**
 * Bounded `var()` resolver. Each custom property is resolved once (memoised)
 * with a cycle guard; inputs over VAR_MAX_INPUT are ignored, at most
 * VAR_MAX_REFS references are substituted per value and every result is cut at
 * VAR_MAX_OUTPUT — so hostile stylesheets cannot blow up time or memory.
 */
class VarResolver {
  private readonly resolved = new Map<string, string>();
  private readonly inProgress = new Set<string>();
  constructor(private readonly vars: Map<string, string>) {}

  value(name: string): string {
    const cached = this.resolved.get(name);
    if (cached !== undefined) return cached;
    if (this.inProgress.has(name)) return '';
    const raw = this.vars.get(name);
    if (raw === undefined) return '';
    this.inProgress.add(name);
    const out = this.expand(raw);
    this.inProgress.delete(name);
    this.resolved.set(name, out);
    return out;
  }

  expand(value: string): string {
    if (value.length > VAR_MAX_INPUT) return '';
    if (!value.includes('var(')) return value;
    let out = '';
    let last = 0;
    let refs = 0;
    VAR_REF_RE.lastIndex = 0;
    for (const m of value.matchAll(VAR_REF_RE)) {
      out += value.slice(last, m.index);
      last = m.index! + m[0].length;
      refs += 1;
      if (refs > VAR_MAX_REFS) break;
      let sub = this.value(m[1]!);
      if (!sub && m[2]) sub = this.expand(m[2]);
      out += sub;
      if (out.length > VAR_MAX_OUTPUT) return out.slice(0, VAR_MAX_OUTPUT);
    }
    out += value.slice(last);
    return out.length > VAR_MAX_OUTPUT ? out.slice(0, VAR_MAX_OUTPUT) : out;
  }
}

interface ColorAcc {
  score: number;
  sources: Set<ColorSource>;
  variables: Set<string>;
}

export interface FontAcc {
  family: string;
  score: number;
  sources: Set<FontSource>;
  heading: number;
  body: number;
}

const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
const HEADING_SELECTOR_RE = /(^|[\s,>+~])h[1-6]\b|title|heading|headline|\.hero/i;
const BODY_SELECTOR_RE = /(^|[\s,>+~])(body|html|p)\b|\.content|\.text/i;

function addColor(acc: Map<string, ColorAcc>, hex: string, weight: number, source: ColorSource, variable?: string) {
  const entry = acc.get(hex) ?? { score: 0, sources: new Set<ColorSource>(), variables: new Set<string>() };
  entry.score += weight;
  entry.sources.add(source);
  if (variable) entry.variables.add(variable);
  acc.set(hex, entry);
}

function addFont(acc: Map<string, FontAcc>, family: string, weight: number, source: FontSource, role?: 'heading' | 'body') {
  const key = family.toLowerCase();
  const entry = acc.get(key) ?? { family, score: 0, sources: new Set<FontSource>(), heading: 0, body: 0 };
  entry.score += weight;
  entry.sources.add(source);
  if (role) entry[role] += 1;
  acc.set(key, entry);
}

function colorsFromValue(value: string): string[] {
  const out: string[] = [];
  const tokens = value.match(COLOR_TOKEN_RE) ?? [];
  for (const token of tokens.slice(0, MAX_COLOR_TOKENS_PER_VALUE)) {
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
  const resolver = new VarResolver(vars);
  for (const name of vars.keys()) {
    for (const hex of colorsFromValue(resolver.value(name))) {
      addColor(acc, hex, BRAND_VAR_HINT.test(name) ? 6 : 2, 'css-variable', name);
    }
  }
  for (const m of css.matchAll(COLOR_DECL_RE)) {
    const prop = m[1]!.toLowerCase();
    const value = resolver.expand(m[2]!.replace(IMPORTANT_RE, ''));
    const weight = prop === 'background' || prop === 'background-color' || prop === 'color' ? 1 : 0.5;
    for (const hex of colorsFromValue(value)) addColor(acc, hex, weight, source);
  }
}

/** Family list from a `font:` shorthand: everything after the size (or size/line-height) token. */
function familiesFromShorthand(value: string): string[] {
  const tokens = value.split(/\s+/).filter(Boolean);
  const sizeIdx = tokens.findIndex((t) => FONT_SIZE_RE.test(t));
  if (sizeIdx === -1) return [];
  let rest = tokens.slice(sizeIdx + 1);
  if (rest[0] === '/') rest = rest.slice(2); // "16px / 1.5 Heebo"
  else if (rest[0]?.startsWith('/')) rest = rest.slice(1); // "16px /1.5 Heebo"
  return rest.join(' ').split(',');
}

/** Count font families in CSS text. Mutates `acc`. */
export function extractFonts(css: string, acc: Map<string, FontAcc>): void {
  for (const m of css.matchAll(FONT_FACE_RE)) {
    const fam = /font-family\s*:\s*([^;]+)/i.exec(m[1]!);
    const f = fam ? cleanFamily(fam[1]!) : null;
    if (f) addFont(acc, f, 5, 'font-face');
  }
  const resolver = new VarResolver(extractCssVariables(css));
  for (const m of css.matchAll(FONT_FAMILY_RE)) {
    const list = resolver.expand(m[1]!.replace(IMPORTANT_RE, '')).split(',');
    const first = list.map(cleanFamily).find(Boolean);
    if (first) addFont(acc, first, 1, 'css');
  }
  for (const m of css.matchAll(FONT_SHORTHAND_RE)) {
    const value = resolver.expand(m[1]!.replace(IMPORTANT_RE, ''));
    const first = familiesFromShorthand(value).map(cleanFamily).find(Boolean);
    if (first) addFont(acc, first, 0.5, 'css');
  }
  // Role hints: which families are used for headings vs body text.
  for (const rule of css.matchAll(RULE_RE)) {
    const selector = rule[1]!.trim();
    if (selector.startsWith('@') || selector.length > 400) continue;
    const isHeading = HEADING_SELECTOR_RE.test(selector);
    const isBody = BODY_SELECTOR_RE.test(selector);
    if (!isHeading && !isBody) continue;
    const decl = /font(?:-family)?\s*:\s*([^;}]+)/i.exec(rule[2]!);
    if (!decl) continue;
    const value = resolver.expand(decl[1]!.replace(IMPORTANT_RE, ''));
    const list = /font-family/i.test(decl[0]) ? value.split(',') : familiesFromShorthand(value);
    const first = list.map(cleanFamily).find(Boolean);
    if (first) addFont(acc, first, 0, 'css', isHeading ? 'heading' : 'body');
  }
}

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

/** WHATWG-style charset resolution: transport header, BOM, then a prescan of the first 2 KB for <meta charset>. */
export function decodeHtml(buffer: Buffer, contentType: string): string {
  let label: string | undefined = /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (!label) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) label = 'utf-8';
    else if (buffer[0] === 0xff && buffer[1] === 0xfe) label = 'utf-16le';
    else if (buffer[0] === 0xfe && buffer[1] === 0xff) label = 'utf-16be';
  }
  if (!label) {
    const head = buffer.subarray(0, 2048).toString('latin1');
    label = /<meta[^>]+charset=["']?\s*([\w.:-]+)/i.exec(head)?.[1] ?? /content=["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1];
  }
  const encoding = (label ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

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

/**
 * Heading = the font used most in h1–h6 rules; body = the font used most in body/p rules;
 * otherwise fall back to the fonts the site deliberately loads (Google Fonts / @font-face).
 */
function suggestFonts(fonts: FontCandidate[]): BrandSiteAnalysis['suggestions']['fonts'] {
  const deliberate = fonts.filter((f) => f.sources.includes('google-fonts') || f.sources.includes('font-face') || f.score >= 3);
  const pool = deliberate.length > 0 ? deliberate : fonts;
  const byHeading = [...fonts].filter((f) => f.roles.heading > 0).sort((a, b) => b.roles.heading - a.roles.heading);
  const byBody = [...fonts].filter((f) => f.roles.body > 0).sort((a, b) => b.roles.body - a.roles.body);
  const heading = byHeading[0]?.family ?? pool[0]?.family;
  const body = byBody[0]?.family ?? pool.find((f) => f.family !== heading)?.family ?? heading;
  return { heading, body };
}

/** First URL out of a lazy-loading <img>: data-* attributes before src, srcset last. */
function imgSource($el: { attr(name: string): string | undefined }): string | undefined {
  for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'src']) {
    const v = $el.attr(attr)?.trim();
    if (v && !v.startsWith('data:')) return v;
  }
  const srcset = $el.attr('data-srcset') ?? $el.attr('srcset');
  return srcset?.split(',')[0]?.trim().split(/\s+/)[0];
}

export async function analyzeBrandWebsite(requestedUrl: string, options: AnalyzeOptions = {}): Promise<BrandSiteAnalysis> {
  const fetcher = options.fetcher ?? safeFetch;
  const warnings: string[] = [];

  const page = await fetcher(requestedUrl, { maxBytes: HTML_MAX, timeoutMs: 12_000, accept: 'text/html,application/xhtml+xml' });
  if (page.status >= 400) throw new ValidationError(`The website answered with HTTP ${page.status}`);
  if (!page.contentType.includes('html') && !page.body.subarray(0, 512).toString('latin1').toLowerCase().includes('<html')) {
    throw new ValidationError('The URL does not return an HTML page');
  }
  // Decode with the declared charset (transport header → BOM → <meta charset>) — older Hebrew sites use windows-1255.
  const $ = cheerio.load(decodeHtml(page.body, page.contentType));
  const base = abs(page.url, $('base[href]').attr('href')) ?? page.url;

  const title = $('title').first().text().trim() || $('meta[property="og:title"]').attr('content')?.trim() || null;
  const description =
    $('meta[name="description"]').attr('content')?.trim() || $('meta[property="og:description"]').attr('content')?.trim() || null;
  const language = $('html').attr('lang')?.trim() || null;
  const themeColorRaw = $('meta[name="theme-color"]').attr('content')?.trim();
  const themeColor = themeColorRaw ? (parseCssColor(themeColorRaw)?.hex ?? null) : null;

  // --- stylesheets ---------------------------------------------------------
  const sheetUrls: string[] = [];
  const googleFamilies = new Set<string>();
  $('link[rel~="stylesheet"][href], link[rel="preload"][as="style"][href]').each((_i, el) => {
    const href = abs(base, $(el).attr('href'));
    if (!href || href.includes('fonts.googleapis.com')) return;
    if (!sheetUrls.includes(href)) sheetUrls.push(href);
  });
  $('link[href*="fonts.googleapis.com"]').each((_i, el) => {
    for (const f of fontsFromGoogleFontsUrl($(el).attr('href') ?? '')) googleFamilies.add(f);
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
  const fontAcc = new Map<string, FontAcc>();
  extractFonts(externalCss, fontAcc);
  extractFonts(inlineStyles, fontAcc);
  extractFonts(styleAttrs, fontAcc);
  for (const fam of googleFamilies) addFont(fontAcc, fam, 4, 'google-fonts');

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
    const src = imgSource($el);
    const hint = `${src ?? ''} ${$el.attr('alt') ?? ''} ${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`.toLowerCase();
    if (!hint.includes('logo')) return;
    const candidate = makeCandidate(src, 'img-logo');
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
  for (const { candidate } of imgCandidates) logos.splice(logos.indexOf(candidate), 1);
  imgCandidates.sort((a, b) => b.score - a.score);
  for (const { candidate } of imgCandidates.slice(0, 4)) logos.push(candidate);

  pushLogo($('meta[property="og:image"]').attr('content'), 'og-image');
  $('link[rel~="icon"][href]').each((_i, el) => pushLogo($(el).attr('href'), 'icon'));
  const logoList = logos.slice(0, 8);

  if (options.inspectLogo !== false) {
    const best = logoList.find((l) => l.importable && l.mimeType !== 'image/svg+xml');
    if (best) {
      try {
        const res = await fetcher(best.url, { maxBytes: LOGO_MAX, timeoutMs: 10_000, accept: 'image/*' });
        if (res.status < 400) {
          const img = sharp(res.body, { failOn: 'error', limitInputPixels: LOGO_MAX_PIXELS });
          const meta = await img.metadata();
          if (meta.format && ['png', 'jpeg', 'webp', 'gif'].includes(meta.format) && meta.width && meta.height) {
            best.width = meta.width;
            best.height = meta.height;
            const { dominant } = await img.stats();
            const hex = `#${[dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
            if (!isNeutral(hex)) addColor(colorAcc, hex, 4, 'logo');
          } else {
            warnings.push(`Logo ${best.url} is not a supported raster image`);
          }
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

  const fonts: FontCandidate[] = [...fontAcc.values()]
    .map((e) => ({ family: e.family, score: Math.round(e.score * 10) / 10, sources: [...e.sources], roles: { heading: e.heading, body: e.body } }))
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

interface FetchedLogo {
  data: Buffer;
  mimeType: string | undefined;
  originalName: string;
}

/** Download and validate a logo (network + type checks only; nothing persisted). */
async function fetchLogo(url: string, fetcher: Fetcher): Promise<FetchedLogo> {
  const maxBytes = Math.min(getConfig().MEDIA_MAX_UPLOAD_MB * 1024 * 1024, LOGO_MAX * 4);
  const res = await fetcher(url, { maxBytes, timeoutMs: 15_000, accept: 'image/*' });
  if (res.status >= 400) throw new ValidationError(`Logo URL answered HTTP ${res.status}`);
  const pathname = new URL(res.url).pathname;
  const originalName = path.basename(pathname) || 'logo';
  const mime = res.contentType.split(';')[0]?.trim() || undefined;
  const type = resolveMediaType(mime && mime !== 'application/octet-stream' ? mime : undefined, pathname);
  if (!type || type.kind !== 'IMAGE') throw new ValidationError('The logo URL is not an image (PNG, JPG, WebP, GIF or SVG)');
  return { data: res.body, mimeType: type.mime, originalName };
}

export async function importLogoFromUrl(
  ctx: BrandContext,
  url: string,
  type: BrandAssetType,
  options: { fetcher?: Fetcher } = {},
): Promise<string> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const logo = await fetchLogo(url, options.fetcher ?? safeFetch);
  const asset = await storeLogo(ctx, logo, type);
  return asset.id;
}

async function storeLogo(ctx: BrandContext, logo: FetchedLogo, type: BrandAssetType): Promise<MediaAsset> {
  const asset = await uploadMedia(ctx, {
    data: logo.data,
    originalName: logo.originalName,
    mimeType: logo.mimeType,
    source: 'IMPORTED',
    title: `לוגו מיובא מהאתר (${type.toLowerCase().replace('logo_', '')})`,
    tags: ['logo', 'imported'],
  });
  await setBrandAsset(ctx, { type, mediaAssetId: asset.id, label: 'ייבוא מהאתר' });
  return asset;
}

/**
 * Persist the user's selection from an analysis. The logo (the only step with
 * a remote dependency) is fetched and validated BEFORE anything is written, so
 * a bad logo URL leaves the Brand Kit untouched.
 */
export async function applyBrandImport(ctx: BrandContext, input: BrandImportApplyInput, options: { fetcher?: Fetcher } = {}): Promise<BrandKit> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const kit = await getBrandKit(ctx);
  const applied: string[] = [];
  const logo = input.logo ? await fetchLogo(input.logo.url, options.fetcher ?? safeFetch) : null;

  try {
    if (logo && input.logo) {
      await storeLogo(ctx, logo, input.logo.type);
      applied.push('logo');
    }
    if (input.colors && Object.keys(input.colors).length > 0) {
      const existing = (kit.settings.colors ?? {}) as Record<string, string>;
      await updateBrandSettings(ctx, { colors: { ...existing, ...input.colors } });
      applied.push('colors');
    }
    if (input.fonts && (input.fonts.heading || input.fonts.body)) {
      const existing = (kit.settings.fonts ?? {}) as Record<string, string>;
      const next = { ...existing };
      if (input.fonts.heading) next.heading = input.fonts.heading;
      if (input.fonts.body) next.body = input.fonts.body;
      await updateBrandSettings(ctx, { fonts: next });
      applied.push('fonts');
    }
    if (input.description) {
      await updateBrand(ctx, { description: input.description });
      applied.push('description');
    }
  } finally {
    await auditFromContext(ctx, {
      action: 'brand.import.apply',
      entityType: 'brand',
      entityId: ctx.brandId,
      metadata: { applied, sourceUrl: input.sourceUrl ?? null },
    });
  }
  logger.info({ brandId: ctx.brandId, applied }, 'brand import applied');
  return getBrandKit(ctx);
}
