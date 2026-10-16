import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/net/safe-fetch';
import { isPrivateAddress } from '../src/net/safe-fetch';
import { analyzeBrandWebsite, extractColors, extractCssVariables, extractFonts, fontsFromGoogleFontsUrl } from '../src/services/brand-import';
import type { FontAcc } from '../src/services/brand-import';
import { contrastRatio, hexToHsl, isNeutral, normalizeHex, parseCssColor } from '../src/utils/color';
import { websiteAnalyzeSchema } from '../src/validation';

describe('colour utils', () => {
  it('normalises hex forms and drops alpha', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#abcd')).toBe('#aabbcc');
    expect(normalizeHex('#2563EBff')).toBe('#2563eb');
    expect(normalizeHex('2563eb')).toBeNull();
  });

  it('parses rgb/hsl/hwb/named and keywords', () => {
    expect(parseCssColor('rgb(37, 99, 235)')).toEqual({ hex: '#2563eb', alpha: 1 });
    expect(parseCssColor('rgb(37 99 235 / 50%)')?.alpha).toBeCloseTo(0.5);
    expect(parseCssColor('rgba(0,0,0,0.2)')).toEqual({ hex: '#000000', alpha: 0.2 });
    expect(parseCssColor('rgb(100%, 0%, 0%)')).toEqual({ hex: '#ff0000', alpha: 1 });
    expect(parseCssColor('rgb(foo, bar, baz)')).toBeNull(); // never '#NaNNaNNaN'
    expect(parseCssColor('hsl(0 100% 50%)')).toEqual({ hex: '#ff0000', alpha: 1 });
    expect(parseCssColor('hsl(0.5turn 100% 50%)')).toEqual({ hex: '#00ffff', alpha: 1 });
    expect(parseCssColor('hsl(200grad 100% 50%)')).toEqual({ hex: '#00ffff', alpha: 1 });
    expect(parseCssColor('hwb(0 0% 0%)')).toEqual({ hex: '#ff0000', alpha: 1 });
    expect(parseCssColor('hwb(0 50% 50%)')).toEqual({ hex: '#808080', alpha: 1 });
    expect(parseCssColor('white')).toEqual({ hex: '#ffffff', alpha: 1 });
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor('currentColor')).toBeNull();
  });

  it('converts modern colour spaces approximately', () => {
    // oklch(62.3% 0.214 259.8) ≈ #2563eb (Tailwind blue-600)
    const blue = parseCssColor('oklch(62.3% 0.214 259.8)')!.hex;
    const { h, s } = hexToHsl(blue);
    expect(Math.abs(h - hexToHsl('#2563eb').h)).toBeLessThan(10);
    expect(s).toBeGreaterThan(0.6);
    expect(parseCssColor('oklab(1 0 0)')?.hex).toBe('#ffffff');
    expect(parseCssColor('lab(0 0 0)')?.hex).toBe('#000000');
    expect(parseCssColor('lab(100 0 0)')?.hex).toBe('#ffffff');
    const lch = parseCssColor('lch(50 70 40)')!.hex; // a red/orange
    expect(hexToHsl(lch).h).toBeLessThan(40);
    expect(parseCssColor('color(srgb 1 0 0)')?.hex).toBe('#ff0000');
    expect(parseCssColor('color(display-p3 0 0 1)')?.hex).toBe('#0000ff');
    expect(parseCssColor('color(srgb-linear 1 1 1)')?.hex).toBe('#ffffff');
  });

  it('classifies neutrals and computes contrast', () => {
    expect(isNeutral('#ffffff')).toBe(true);
    expect(isNeutral('#111111')).toBe(true);
    expect(isNeutral('#808080')).toBe(true);
    expect(isNeutral('#e9ecef')).toBe(true); // bootstrap gray-200: tiny chroma, slight blue tint
    expect(isNeutral('#6b7280')).toBe(true); // slate grey
    expect(isNeutral('#2563eb')).toBe(false);
    expect(isNeutral('#d946a0')).toBe(false);
    expect(hexToHsl('#ff0000').h).toBe(0);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});

describe('SSRF guard', () => {
  it('flags private, loopback, link-local, mapped and tunnelled addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', 'fe80::1%eth0', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:c0a8:101::']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('accepts bare domains and refuses other schemes', () => {
    expect(websiteAnalyzeSchema.parse({ url: 'mvn.co.il' }).url).toBe('https://mvn.co.il');
    expect(websiteAnalyzeSchema.parse({ url: '  https://mvn.co.il/x ' }).url).toBe('https://mvn.co.il/x');
    expect(websiteAnalyzeSchema.parse({ url: '' }).url).toBeUndefined();
    expect(() => websiteAnalyzeSchema.parse({ url: 'ftp://mvn.co.il' })).toThrow();
    expect(() => websiteAnalyzeSchema.parse({ url: 'javascript:alert(1)' })).toThrow();
  });
});

describe('CSS helpers', () => {
  it('reads custom properties and Google Fonts families', () => {
    const vars = extractCssVariables(':root{--primary:#2563eb;--bg: white !important;} .x{--primary:#000}');
    expect(vars.get('--primary')).toBe('#2563eb');
    expect(vars.get('--bg')).toBe('white');
    expect(fontsFromGoogleFontsUrl('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&family=Open+Sans&display=swap')).toEqual([
      'Heebo',
      'Open Sans',
    ]);
    expect(fontsFromGoogleFontsUrl('https://fonts.googleapis.com/css?family=Assistant:400,700|Rubik')).toEqual(['Assistant', 'Rubik']);
    expect(fontsFromGoogleFontsUrl('https://evil.example/css?family=X')).toEqual([]);
  });

  it('bounds hostile var() expansion in time and memory', () => {
    const refs = Array.from({ length: 40 }, (_, i) => `var(--b${i % 3})`).join(' ');
    const css = `:root{--a:${refs};--b0:${refs.replace(/--b\d/g, '--c')};--b1:var(--c);--b2:var(--c);--c:var(--d) var(--d) var(--d) var(--d);--d:var(--e) var(--e) var(--e) var(--e);--e:#ff0000 var(--a)}`;
    const acc = new Map();
    const started = Date.now();
    extractColors(css, acc, 'css');
    expect(Date.now() - started).toBeLessThan(500);
    expect(acc.get('#ff0000')?.score).toBeGreaterThan(0);
  });

  it('extracts font families from shorthand, strips !important and drops noise', () => {
    const acc = new Map<string, FontAcc>();
    extractFonts(
      `h1{font:700 2rem/1.2 "Noto Sans Hebrew", Arial, sans-serif} .b{font-family:Assistant !important} .c{font-family:"Font Awesome 5 Free"} .d{font-family:a} .e{font: italic small-caps bold 16px / 1.5 Rubik, serif}`,
      acc,
    );
    const families = [...acc.values()].map((f) => f.family);
    expect(families).toContain('Noto Sans Hebrew');
    expect(families).toContain('Assistant');
    expect(families).toContain('Rubik');
    expect(families).not.toContain('Arial');
    expect(families).not.toContain('Font Awesome 5 Free');
    expect(families).not.toContain('a');
  });
});

describe('analyzeBrandWebsite (offline fixture)', () => {
  const html = `<!doctype html><html lang="he"><head>
    <title>MVN — אחסון אתרים</title>
    <meta name="description" content="אחסון וורדפרס מהיר ומאובטח">
    <meta name="theme-color" content="#1d4ed8">
    <meta property="og:image" content="/img/og.jpg">
    <link rel="stylesheet" href="/css/site.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap">
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" href="/favicon.ico">
    <style>.hero{background:var(--brand-primary);color:#fff}</style>
  </head><body>
    <section class="partners"><img src="/img/zabbix-logo.png" alt="Zabbix logo"></section>
    <header><a href="/"><img src="data:image/gif;base64,R0lGOD" data-src="/img/logo.svg" alt="MVN logo" class="site-logo"></a></header>
    <div style="color: rgb(234, 88, 12)">x</div>
  </body></html>`;
  const css = `:root{--brand-primary:#2563eb;--brand-secondary:#0f766e;--text:#1f2937;--bg:#f8fafc}
    @font-face{font-family:"Assistant";src:url(a.woff2)}
    @font-face{font-family:"Font Awesome 5 Free";src:url(fa.woff2)}
    .fa{font-family:"Font Awesome 5 Free"}.mono{font-family:SFMono-Regular,Menlo,monospace}
    body{font-family:Assistant, Arial, sans-serif;color:var(--text);background:var(--bg)}
    h1{font-family:"Heebo",sans-serif;color:var(--brand-primary)}
    .btn{background-color:var(--brand-primary);border-color:#2563eb}
    .btn-alt{background:#0f766e}.muted{color:#6b7280}.modern{color:oklch(62.3% 0.214 259.8)}`;

  const fetcher: Fetcher = async (url) => {
    const body = (s: string) => ({ url, status: 200, body: Buffer.from(s), contentType: 'text/css' });
    if (url === 'https://example.test/') return { url, status: 200, body: Buffer.from(html), contentType: 'text/html; charset=utf-8' };
    if (url === 'https://example.test/css/site.css') return body(css);
    return { url, status: 404, body: Buffer.alloc(0), contentType: 'text/plain' };
  };

  it('extracts colours, fonts, logos and suggestions without touching the network', async () => {
    const a = await analyzeBrandWebsite('https://example.test/', { fetcher, inspectLogo: false });
    expect(a.title).toContain('MVN');
    expect(a.description).toContain('וורדפרס');
    expect(a.language).toBe('he');
    expect(a.themeColor).toBe('#1d4ed8');
    expect(a.stats.stylesheets).toBe(1); // Google Fonts links are not fetched as stylesheets

    const hexes = a.colors.map((c) => c.hex);
    expect(hexes[0]).toBe('#2563eb'); // --brand-primary: variable bonus + declarations
    expect(hexes).toContain('#0f766e');
    expect(hexes).toContain('#1d4ed8');
    expect(hexes).toContain('#ea580c'); // inline style rgb()
    expect(a.colors.find((c) => c.hex === '#2563eb')?.variables).toContain('--brand-primary');
    expect(a.colors.find((c) => c.hex === '#f8fafc')?.neutral).toBe(true);
    expect(a.colors.find((c) => c.hex === '#1f2937')?.neutral).toBe(true);

    const families = a.fonts.map((f) => f.family);
    expect(families).toContain('Heebo');
    expect(families).toContain('Assistant');
    expect(families).not.toContain('Arial');
    expect(families).not.toContain('Font Awesome 5 Free');
    expect(families).not.toContain('SFMono-Regular');
    expect(a.fonts.find((f) => f.family === 'Heebo')?.sources).toContain('google-fonts');
    expect(a.fonts.find((f) => f.family === 'Heebo')?.score).toBe(5); // counted once (4) + one css declaration (1)
    expect(a.fonts.find((f) => f.family === 'Assistant')?.sources).toContain('font-face');

    expect(a.logos.map((l) => l.kind)).toEqual(['apple-touch-icon', 'img-logo', 'img-logo', 'og-image', 'icon']);
    expect(a.logos[0]?.url).toBe('https://example.test/apple-touch-icon.png');
    // the brand's own header logo (lazy-loaded via data-src) outranks the partner logo that appeared earlier
    expect(a.logos[1]?.url).toBe('https://example.test/img/logo.svg');
    expect(a.logos[2]?.url).toBe('https://example.test/img/zabbix-logo.png');
    expect(a.logos.find((l) => l.kind === 'icon')?.importable).toBe(false); // .ico not importable

    // Suggestions come from the fixture, not from the fallbacks.
    expect(a.suggestions.colors.primary).toBe('#2563eb');
    expect(a.suggestions.colors.background).toBe('#f8fafc');
    expect(a.suggestions.colors.foreground).toBe('#1f2937');
    expect(a.suggestions.fonts.heading).toBe('Heebo');
    expect(a.suggestions.fonts.body).toBe('Assistant');
  });

  it('decodes legacy charsets (windows-1255)', async () => {
    const cp1255 = Buffer.concat([
      Buffer.from('<!doctype html><html><head><meta charset="windows-1255"><title>'),
      Buffer.from([0xf9, 0xec, 0xe5, 0xed]), // "שלום" in windows-1255
      Buffer.from('</title></head><body></body></html>'),
    ]);
    const f: Fetcher = async (url) => ({ url, status: 200, body: cp1255, contentType: 'text/html' });
    const a = await analyzeBrandWebsite('https://legacy.test/', { fetcher: f, inspectLogo: false });
    expect(a.title).toBe('שלום');
  });

  it('rejects non-HTML and error responses', async () => {
    const bad: Fetcher = async (url) => ({ url, status: 500, body: Buffer.from('x'), contentType: 'text/html' });
    await expect(analyzeBrandWebsite('https://example.test/', { fetcher: bad, inspectLogo: false })).rejects.toThrow(/HTTP 500/);
    const json: Fetcher = async (url) => ({ url, status: 200, body: Buffer.from('{}'), contentType: 'application/json' });
    await expect(analyzeBrandWebsite('https://example.test/', { fetcher: json, inspectLogo: false })).rejects.toThrow(/HTML/);
  });
});
