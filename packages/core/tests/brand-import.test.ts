import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/net/safe-fetch';
import { isPrivateAddress } from '../src/net/safe-fetch';
import { analyzeBrandWebsite, extractCssVariables, fontsFromGoogleFontsUrl } from '../src/services/brand-import';
import { contrastRatio, hexToHsl, isNeutral, normalizeHex, parseCssColor } from '../src/utils/color';

describe('colour utils', () => {
  it('normalises hex forms and drops alpha', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#abcd')).toBe('#aabbcc');
    expect(normalizeHex('#2563EBff')).toBe('#2563eb');
    expect(normalizeHex('2563eb')).toBeNull();
  });
  it('parses rgb/hsl/named and keywords', () => {
    expect(parseCssColor('rgb(37, 99, 235)')).toEqual({ hex: '#2563eb', alpha: 1 });
    expect(parseCssColor('rgb(37 99 235 / 50%)')?.alpha).toBeCloseTo(0.5);
    expect(parseCssColor('rgba(0,0,0,0.2)')).toEqual({ hex: '#000000', alpha: 0.2 });
    expect(parseCssColor('hsl(0 100% 50%)')).toEqual({ hex: '#ff0000', alpha: 1 });
    expect(parseCssColor('white')).toEqual({ hex: '#ffffff', alpha: 1 });
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor('currentColor')).toBeNull();
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
  it('flags private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('CSS helpers', () => {
  it('reads custom properties and Google Fonts families', () => {
    const vars = extractCssVariables(':root{--primary:#2563eb;--bg: white;} .x{--primary:#000}');
    expect(vars.get('--primary')).toBe('#2563eb');
    expect(vars.get('--bg')).toBe('white');
    expect(fontsFromGoogleFontsUrl('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&family=Open+Sans&display=swap')).toEqual([
      'Heebo',
      'Open Sans',
    ]);
    expect(fontsFromGoogleFontsUrl('https://fonts.googleapis.com/css?family=Assistant:400,700|Rubik')).toEqual(['Assistant', 'Rubik']);
    expect(fontsFromGoogleFontsUrl('https://evil.example/css?family=X')).toEqual([]);
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
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" href="/favicon.ico">
    <style>.hero{background:var(--brand-primary);color:#fff}</style>
  </head><body>
    <section class="partners"><img src="/img/zabbix-logo.png" alt="Zabbix logo"></section>
    <header><a href="/"><img src="/img/logo.svg" alt="MVN logo" class="site-logo"></a></header>
    <div style="color: rgb(234, 88, 12)">x</div>
  </body></html>`;
  const css = `:root{--brand-primary:#2563eb;--brand-secondary:#0f766e;--text:#111827}
    @font-face{font-family:"Assistant";src:url(a.woff2)}
    @font-face{font-family:"Font Awesome 5 Free";src:url(fa.woff2)}
    .fa{font-family:"Font Awesome 5 Free"}.mono{font-family:SFMono-Regular,Menlo,monospace}
    body{font-family:Assistant, Arial, sans-serif;color:var(--text);background:#ffffff}
    h1{font-family:"Heebo",sans-serif;color:var(--brand-primary)}
    .btn{background-color:var(--brand-primary);border-color:#2563eb}
    .btn-alt{background:#0f766e}.muted{color:#6b7280}`;

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

    const hexes = a.colors.map((c) => c.hex);
    expect(hexes[0]).toBe('#2563eb'); // --brand-primary: variable bonus + declarations
    expect(hexes).toContain('#0f766e');
    expect(hexes).toContain('#1d4ed8');
    expect(hexes).toContain('#ea580c'); // inline style rgb()
    expect(a.colors.find((c) => c.hex === '#2563eb')?.variables).toContain('--brand-primary');
    expect(a.colors.find((c) => c.hex === '#ffffff')?.neutral).toBe(true);

    const families = a.fonts.map((f) => f.family);
    expect(families).toContain('Heebo');
    expect(families).toContain('Assistant');
    expect(families).not.toContain('Arial');
    expect(families).not.toContain('Font Awesome 5 Free'); // icon fonts are never brand typography
    expect(families).not.toContain('SFMono-Regular');
    expect(a.fonts.find((f) => f.family === 'Heebo')?.sources).toContain('google-fonts');
    expect(a.fonts.find((f) => f.family === 'Assistant')?.sources).toContain('font-face');

    expect(a.logos.map((l) => l.kind)).toEqual(['apple-touch-icon', 'img-logo', 'img-logo', 'og-image', 'icon']);
    expect(a.logos[0]?.url).toBe('https://example.test/apple-touch-icon.png');
    // the brand's own header logo outranks the partner logo that appeared earlier in the DOM
    expect(a.logos[1]?.url).toBe('https://example.test/img/logo.svg');
    expect(a.logos[2]?.url).toBe('https://example.test/img/zabbix-logo.png');
    expect(a.logos.find((l) => l.kind === 'icon')?.importable).toBe(false); // .ico not importable

    expect(a.suggestions.colors.primary).toBe('#2563eb');
    expect(a.suggestions.colors.background).toBe('#ffffff');
    expect(a.suggestions.colors.foreground).toBe('#111827');
    expect(a.suggestions.fonts.heading).toBeDefined();
    expect(a.stats.stylesheets).toBe(1);
  });

  it('rejects non-HTML and error responses', async () => {
    const bad: Fetcher = async (url) => ({ url, status: 500, body: Buffer.from('x'), contentType: 'text/html' });
    await expect(analyzeBrandWebsite('https://example.test/', { fetcher: bad, inspectLogo: false })).rejects.toThrow(/HTTP 500/);
    const json: Fetcher = async (url) => ({ url, status: 200, body: Buffer.from('{}'), contentType: 'application/json' });
    await expect(analyzeBrandWebsite('https://example.test/', { fetcher: json, inspectLogo: false })).rejects.toThrow(/HTML/);
  });
});
