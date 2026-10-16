/**
 * CreativeDocument → self-contained HTML. The same markup drives the live
 * preview (iframe srcdoc, fonts/images via app URLs) and the Chromium render
 * (fonts and images inlined as data: URIs, no network).
 */
import type { CreativeDocument, ImageLayer, ShapeLayer, TextLayer } from './document';
import { fontPublicUrl } from './font-families';
import type { FontFamily } from './font-families';

export interface HtmlOptions {
  mode: 'render' | 'preview';
  /** mediaId → src (data: URI for render, app URL for preview). */
  images: Record<string, string>;
  /** Font sources per family. Required for render mode (data: URIs from `renderFontSources()`); preview defaults to /fonts/*. */
  fontSrc?: Partial<Record<FontFamily, string>>;
}

export interface RenderWarning {
  layer?: string;
  kind: 'overflow' | 'empty' | 'missing_image' | 'font_missing' | 'other';
  message: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const pct = (n: number) => `${num(n)}%`;
const px = (n: number) => `${num(n)}px`;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${num(alpha)})`;
}

function boxStyle(l: { box: { x: number; y: number; w: number; h: number } }): string {
  return `left:${pct(l.box.x)};top:${pct(l.box.y)};width:${pct(l.box.w)};height:${pct(l.box.h)};`;
}

function textHtml(l: TextLayer, doc: CreativeDocument): string {
  const family = l.font === 'heading' ? doc.fonts.heading : doc.fonts.body;
  const justify = l.valign === 'top' ? 'flex-start' : l.valign === 'middle' ? 'center' : 'flex-end';
  const alignItems = l.background ? (l.align === 'center' ? 'center' : l.align === 'end' ? 'flex-end' : 'flex-start') : 'stretch';
  const outer = `${boxStyle(l)}opacity:${num(l.opacity)};justify-content:${justify};align-items:${alignItems};`;
  const inner = [
    `font-family:'${family}'`,
    `font-size:${px(l.size)}`,
    `font-weight:${l.weight}`,
    `color:${l.color}`,
    `text-align:${l.align}`,
    `line-height:${num(l.lineHeight)}`,
    `letter-spacing:${px(l.letterSpacing)}`,
    l.background ? `background:${l.background}` : '',
    `border-radius:${px(l.radius)}`,
    `padding:${px(l.padding)}`,
    l.shadow ? 'text-shadow:0 2px 14px rgba(0,0,0,.45)' : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<div class="layer text" data-layer="${escapeHtml(l.id)}" data-text data-role="${l.role}" data-autofit="${l.autofit ? '1' : '0'}" data-size="${num(l.size)}" style="${outer}"><div class="inner" style="${inner}">${escapeHtml(l.text)}</div></div>`;
}

function imageHtml(l: ImageLayer, opts: HtmlOptions): string {
  const src = l.mediaId ? opts.images[l.mediaId] : undefined;
  if (!src) {
    const label = opts.mode === 'preview' ? (l.role === 'logo' ? 'אין לוגו ב-Brand Kit' : 'אין תמונה — בחרו מהספרייה או צרו ב-AI') : '';
    return `<div class="layer image missing" data-layer="${escapeHtml(l.id)}" data-missing="1" data-role="${l.role}" style="${boxStyle(l)}opacity:${num(l.opacity)};border-radius:${px(l.radius)}">${escapeHtml(label)}</div>`;
  }
  return `<div class="layer image" data-layer="${escapeHtml(l.id)}" data-role="${l.role}" style="${boxStyle(l)}opacity:${num(l.opacity)};border-radius:${px(l.radius)};overflow:hidden"><img src="${escapeHtml(src)}" alt="" style="width:100%;height:100%;object-fit:${l.fit};display:block"></div>`;
}

function shapeHtml(l: ShapeLayer): string {
  const bg = l.gradient
    ? `background:linear-gradient(${num(l.gradient.angle)}deg,${hexToRgba(l.color, l.gradient.fromOpacity)},${hexToRgba(l.gradient.to, l.gradient.toOpacity)})`
    : `background:${l.color}`;
  return `<div class="layer shape" data-layer="${escapeHtml(l.id)}" data-role="${l.role}" style="${boxStyle(l)}${bg};opacity:${num(l.opacity)};border-radius:${px(l.radius)}"></div>`;
}

function fontFace(family: FontFamily, src: string | null): string {
  if (!src) return '';
  return `@font-face{font-family:'${family}';src:url("${src}") format('truetype');font-weight:100 900;font-style:normal;font-display:block}`;
}

const SCRIPT = `(function(){
  var MODE = document.documentElement.getAttribute('data-mode');
  function fits(el, inner){ return inner.scrollHeight <= el.clientHeight + 1 && inner.scrollWidth <= el.clientWidth + 1; }
  function run(){
    var warnings = [], fitted = {};
    var nodes = document.querySelectorAll('[data-text]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], inner = el.firstElementChild, id = el.getAttribute('data-layer');
      if (!inner) continue;
      var size = parseFloat(el.getAttribute('data-size')) || parseFloat(getComputedStyle(inner).fontSize), min = size * 0.55;
      inner.style.fontSize = size + 'px';
      if (el.getAttribute('data-autofit') === '1') {
        var guard = 0;
        while (!fits(el, inner) && size > min && guard++ < 60) { size = size - Math.max(1, size * 0.05); inner.style.fontSize = size + 'px'; }
        fitted[id] = Math.round(size);
      }
      if (!fits(el, inner)) warnings.push({ layer: id, kind: 'overflow', message: 'הטקסט חורג מהמסגרת גם אחרי הקטנה' });
      if (!(inner.textContent || '').trim() && el.getAttribute('data-role') !== 'custom') warnings.push({ layer: id, kind: 'empty', message: 'שכבת טקסט ריקה' });
    }
    var missing = document.querySelectorAll('[data-missing]');
    for (var j = 0; j < missing.length; j++) warnings.push({ layer: missing[j].getAttribute('data-layer'), kind: 'missing_image', message: missing[j].getAttribute('data-role') === 'logo' ? 'אין לוגו' : 'חסרה תמונה' });
    var fams = document.documentElement.getAttribute('data-fonts').split('|');
    for (var k = 0; k < fams.length; k++) { try { if (fams[k] && !document.fonts.check("16px '" + fams[k] + "'")) warnings.push({ kind: 'font_missing', message: 'הפונט ' + fams[k] + ' לא נטען' }); } catch (e) {} }
    window.__mm = { done: true, warnings: warnings, fitted: fitted };
    if (MODE === 'preview' && window.parent !== window) { try { window.parent.postMessage({ type: 'mm-creative-preview', warnings: warnings, fitted: fitted }, '*'); } catch (e) {} }
  }
  var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  ready.then(run, run);
})();`;

export function documentToHtml(doc: CreativeDocument, opts: HtmlOptions): string {
  const families = [...new Set([doc.fonts.heading, doc.fonts.body])];
  const faces = families
    .map((f) => fontFace(f, opts.fontSrc?.[f] ?? (opts.mode === 'render' ? null : fontPublicUrl(f))))
    .join('\n');
  const layers = doc.layers
    .filter((l) => !l.hidden)
    .map((l) => (l.type === 'text' ? textHtml(l, doc) : l.type === 'image' ? imageHtml(l, opts) : shapeHtml(l)))
    .join('\n');
  return `<!doctype html>
<html lang="he" dir="rtl" data-mode="${opts.mode}" data-fonts="${escapeHtml(families.join('|'))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${doc.width}">
<style>
${faces}
html,body{margin:0;padding:0;background:transparent}
#canvas{position:relative;width:${doc.width}px;height:${doc.height}px;overflow:hidden;background:${doc.background};direction:rtl;font-family:'${doc.fonts.body}',sans-serif;-webkit-font-smoothing:antialiased}
.layer{position:absolute;box-sizing:border-box}
.text{display:flex;flex-direction:column;overflow:hidden}
.text .inner{white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box;max-width:100%}
.missing{border:3px dashed rgba(120,120,120,.55);display:flex;align-items:center;justify-content:center;font:${Math.round(doc.width / 40)}px sans-serif;color:#555;background:rgba(255,255,255,.35);text-align:center;padding:16px}
</style>
</head>
<body><div id="canvas">
${layers}
</div>
<script>${SCRIPT}</script>
</body></html>`;
}
