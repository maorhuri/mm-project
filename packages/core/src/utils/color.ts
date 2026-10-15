/** Small, dependency-free CSS colour helpers used by the website brand import. */

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  blue: '#0000ff',
  green: '#008000',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  orange: '#ffa500',
  purple: '#800080',
  yellow: '#ffff00',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
  indigo: '#4b0082',
  violet: '#ee82ee',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  coral: '#ff7f50',
  salmon: '#fa8072',
  tomato: '#ff6347',
  crimson: '#dc143c',
  turquoise: '#40e0d0',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  slategray: '#708090',
  darkgray: '#a9a9a9',
  lightgray: '#d3d3d3',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
  dimgray: '#696969',
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const toHex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function hexToHsl(hex: string): Hsl {
  const n = normalizeHex(hex) ?? '#000000';
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** `#abc` / `#abcd` / `#aabbcc` / `#aabbccdd` → `#aabbcc` (alpha dropped), else null. */
export function normalizeHex(input: string): string | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${h.slice(0, 6)}`;
}

function hexAlpha(input: string): number {
  const m = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!m) return 1;
  const h = m[1]!;
  const a = h.length === 4 ? h[3]! + h[3]! : h.slice(6, 8);
  return parseInt(a, 16) / 255;
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const v = raw.trim();
  if (v.endsWith('%')) return clamp(parseFloat(v) / 100, 0, 1);
  const n = parseFloat(v);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

function parseChannel(raw: string): number {
  const v = raw.trim();
  if (v.endsWith('%')) return clamp((parseFloat(v) / 100) * 255, 0, 255);
  return clamp(parseFloat(v), 0, 255);
}

/**
 * Parse a CSS colour token into hex + alpha. Supports hex, rgb()/rgba() (comma or
 * space syntax, optional `/ alpha`), hsl()/hsla(), and common named colours.
 * Returns null for keywords like `transparent`, `currentColor`, `inherit`.
 */
export function parseCssColor(value: string): { hex: string; alpha: number } | null {
  const v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'currentcolor' || v === 'inherit' || v === 'initial') return null;
  if (v.startsWith('#')) {
    const hex = normalizeHex(v);
    return hex ? { hex, alpha: hexAlpha(v) } : null;
  }
  if (NAMED[v]) return { hex: NAMED[v]!, alpha: 1 };

  const fn = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const kind = fn[1]!;
  const inner = fn[2]!;
  const [channels, alphaRaw] = inner.includes('/') ? inner.split('/') : [inner, undefined];
  const parts = channels!
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  let alpha = parseAlpha(alphaRaw);
  if (alphaRaw === undefined && parts.length >= 4) alpha = parseAlpha(parts[3]);

  if (kind.startsWith('rgb')) {
    return { hex: rgbToHex(parseChannel(parts[0]!), parseChannel(parts[1]!), parseChannel(parts[2]!)), alpha };
  }
  const h = parseFloat(parts[0]!.replace('deg', ''));
  const s = parseFloat(parts[1]!) / 100;
  const l = parseFloat(parts[2]!) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  return { hex: hslToHex(h, s, l), alpha };
}

/** Greys, near-white and near-black are "neutral" — never brand accents. */
export function isNeutral(hex: string): boolean {
  const n = normalizeHex(hex) ?? '#000000';
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const { s, l } = hexToHsl(hex);
  return chroma < 0.1 || s < 0.12 || l > 0.96 || l < 0.05;
}

export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h);
  return Math.min(d, 360 - d);
}

/** Relative luminance-based contrast ratio (WCAG). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = normalizeHex(hex) ?? '#000000';
    const ch = [1, 3, 5].map((i) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}
