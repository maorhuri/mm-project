/**
 * Dependency-free CSS colour helpers used by the website brand import.
 * Supports hex, rgb()/rgba(), hsl()/hsla(), hwb(), oklch(), oklab(), lab(),
 * lch(), color(srgb|display-p3 …) and common named colours. Modern colour
 * spaces are converted to sRGB (gamut-clamped) — accurate enough for
 * suggestions, not for colour management.
 */

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
const clamp01 = (v: number) => clamp(v, 0, 1);
const toHex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
const finite = (...n: number[]) => n.every(Number.isFinite);

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/** Linear-light sRGB (0-1) → gamma-encoded hex. */
function linearRgbToHex(r: number, g: number, b: number): string {
  const enc = (c: number) => {
    const v = clamp01(c);
    return (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  };
  return rgbToHex(enc(r), enc(g), enc(b));
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
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

function hwbToHex(h: number, w: number, bl: number): string {
  let ww = clamp01(w);
  let bb = clamp01(bl);
  if (ww + bb >= 1) {
    const gray = (ww / (ww + bb)) * 255;
    return rgbToHex(gray, gray, gray);
  }
  const base = hslToHex(h, 1, 0.5);
  const scale = 1 - ww - bb;
  const ch = (i: number) => (parseInt(base.slice(i, i + 2), 16) / 255) * scale + ww;
  ww = clamp01(ww);
  bb = clamp01(bb);
  return rgbToHex(ch(1) * 255, ch(3) * 255, ch(5) * 255);
}

function oklabToHex(L: number, a: number, b: number): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return linearRgbToHex(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );
}

function labToHex(L: number, a: number, b: number): string {
  // CIE Lab (D50) → XYZ → linear sRGB (Bradford-adapted D50 matrix from CSS Color 4)
  const e = 216 / 24389;
  const k = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xr = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
  const yr = L > k * e ? ((L + 16) / 116) ** 3 : L / k;
  const zr = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
  const X = xr * 0.96422;
  const Y = yr * 1.0;
  const Z = zr * 0.82521;
  return linearRgbToHex(
    3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z,
    -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z,
    0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z,
  );
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

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const HUE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i;
const HUE_TO_DEG: Record<string, number> = { deg: 1, grad: 360 / 400, rad: 180 / Math.PI, turn: 360 };

function parseNumber(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const v = raw.trim();
  if (v === 'none') return 0;
  return NUM_RE.test(v) ? parseFloat(v) : NaN;
}

/** Percent → fraction of `scale`; plain number as-is. */
function parseScalar(raw: string | undefined, percentScale: number): number {
  if (raw === undefined) return NaN;
  const v = raw.trim();
  if (v === 'none') return 0;
  if (v.endsWith('%')) {
    const n = parseNumber(v.slice(0, -1));
    return Number.isFinite(n) ? (n / 100) * percentScale : NaN;
  }
  return parseNumber(v);
}

function parseHue(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const v = raw.trim();
  if (v === 'none') return 0;
  const m = HUE_RE.exec(v);
  if (!m) return NaN;
  return parseFloat(m[1]!) * (HUE_TO_DEG[(m[2] ?? 'deg').toLowerCase()] ?? 1);
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const v = parseScalar(raw, 1);
  return Number.isFinite(v) ? clamp01(v) : 1;
}

function parseChannel255(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const v = raw.trim();
  if (v === 'none') return 0;
  if (v.endsWith('%')) {
    const n = parseNumber(v.slice(0, -1));
    return Number.isFinite(n) ? clamp((n / 100) * 255, 0, 255) : NaN;
  }
  const n = parseNumber(v);
  return Number.isFinite(n) ? clamp(n, 0, 255) : NaN;
}

/**
 * Parse a CSS colour token into hex + alpha. Returns null for keywords like
 * `transparent`, `currentColor`, `inherit` and for anything it cannot parse.
 */
export function parseCssColor(value: string): { hex: string; alpha: number } | null {
  const v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'currentcolor' || v === 'inherit' || v === 'initial' || v === 'unset') return null;
  if (v.startsWith('#')) {
    const hex = normalizeHex(v);
    return hex ? { hex, alpha: hexAlpha(v) } : null;
  }
  if (NAMED[v]) return { hex: NAMED[v]!, alpha: 1 };

  const fn = /^(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(\s*([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const kind = fn[1]!;
  const inner = fn[2]!;
  const [channelsRaw, alphaRaw] = inner.includes('/') ? inner.split('/') : [inner, undefined];
  let parts = channelsRaw!
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let space: string | null = null;
  if (kind === 'color') {
    space = parts[0] ?? null;
    parts = parts.slice(1);
  }
  if (parts.length < 3) return null;
  let alpha = parseAlpha(alphaRaw);
  if (alphaRaw === undefined && parts.length >= 4 && kind !== 'color') alpha = parseAlpha(parts[3]);

  let hex: string | null = null;
  switch (kind) {
    case 'rgb':
    case 'rgba': {
      const r = parseChannel255(parts[0]);
      const g = parseChannel255(parts[1]);
      const b = parseChannel255(parts[2]);
      if (!finite(r, g, b)) return null;
      hex = rgbToHex(r, g, b);
      break;
    }
    case 'hsl':
    case 'hsla': {
      const h = parseHue(parts[0]);
      const s = parseScalar(parts[1], 1);
      const l = parseScalar(parts[2], 1);
      if (!finite(h, s, l)) return null;
      hex = hslToHex(h, s > 1 ? s / 100 : s, l > 1 ? l / 100 : l);
      break;
    }
    case 'hwb': {
      const h = parseHue(parts[0]);
      const w = parseScalar(parts[1], 1);
      const b = parseScalar(parts[2], 1);
      if (!finite(h, w, b)) return null;
      hex = hwbToHex(h, w > 1 ? w / 100 : w, b > 1 ? b / 100 : b);
      break;
    }
    case 'oklch': {
      const L = parseScalar(parts[0], 1);
      const C = parseScalar(parts[1], 0.4);
      const h = parseHue(parts[2]);
      if (!finite(L, C, h)) return null;
      const rad = (h * Math.PI) / 180;
      hex = oklabToHex(clamp01(L), C * Math.cos(rad), C * Math.sin(rad));
      break;
    }
    case 'oklab': {
      const L = parseScalar(parts[0], 1);
      const a = parseScalar(parts[1], 0.4);
      const b = parseScalar(parts[2], 0.4);
      if (!finite(L, a, b)) return null;
      hex = oklabToHex(clamp01(L), a, b);
      break;
    }
    case 'lab': {
      const L = parseScalar(parts[0], 100);
      const a = parseScalar(parts[1], 125);
      const b = parseScalar(parts[2], 125);
      if (!finite(L, a, b)) return null;
      hex = labToHex(clamp(L, 0, 100), a, b);
      break;
    }
    case 'lch': {
      const L = parseScalar(parts[0], 100);
      const C = parseScalar(parts[1], 150);
      const h = parseHue(parts[2]);
      if (!finite(L, C, h)) return null;
      const rad = (h * Math.PI) / 180;
      hex = labToHex(clamp(L, 0, 100), C * Math.cos(rad), C * Math.sin(rad));
      break;
    }
    case 'color': {
      if (!space || !['srgb', 'srgb-linear', 'display-p3', 'rec2020', 'a98-rgb', 'prophoto-rgb'].includes(space)) return null;
      const r = parseScalar(parts[0], 1);
      const g = parseScalar(parts[1], 1);
      const b = parseScalar(parts[2], 1);
      if (!finite(r, g, b)) return null;
      // Wide-gamut spaces are approximated by clamping into sRGB.
      hex = space === 'srgb-linear' ? linearRgbToHex(r, g, b) : rgbToHex(clamp01(r) * 255, clamp01(g) * 255, clamp01(b) * 255);
      break;
    }
    default:
      return null;
  }
  return hex ? { hex, alpha } : null;
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
