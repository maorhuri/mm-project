/**
 * Chromium (Playwright) rendering of self-contained HTML documents to PNG,
 * with JPG/WebP variants via sharp. Used by the worker only — the web app never
 * launches a browser. One shared browser per process, closed after idle.
 */
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { getConfig } from '../config';
import { ValidationError } from '../errors';
import { logger } from '../logger';
import type { RenderWarning } from '../creative/html';

export type { RenderWarning };

let browserPromise: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_MS = 3 * 60_000;

async function launch(): Promise<Browser> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--lang=he-IL', '--hide-scrollbars'],
  });
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  logger.info({ version: browser.version() }, 'chromium launched');
  return browser;
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeIfIdle(), IDLE_MS);
  idleTimer.unref();
}

async function closeIfIdle(): Promise<void> {
  const pending = browserPromise;
  if (!pending) return;
  try {
    const browser = await pending;
    // A render is still in flight — check again later.
    if (browser.contexts().length > 0) {
      touch();
      return;
    }
  } catch {
    return;
  }
  await closeBrowser();
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((err: unknown) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  touch();
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    /* already gone */
  }
}

export async function isChromiumAvailable(): Promise<boolean> {
  try {
    const browser = await getBrowser();
    return browser.isConnected();
  } catch (err) {
    logger.warn({ err }, 'chromium unavailable');
    return false;
  }
}

export interface RenderOptions {
  width: number;
  height: number;
  /** Device scale factor (2 = retina). Counts toward RENDER_MAX_PIXELS. */
  scale?: number;
  /** Keep the page background transparent (PNG with alpha). */
  transparent?: boolean;
  timeoutMs?: number;
}

export interface RenderResult {
  png: Buffer;
  warnings: RenderWarning[];
  fitted: Record<string, number>;
  durationMs: number;
}

interface PageState {
  done?: boolean;
  warnings?: RenderWarning[];
  fitted?: Record<string, number>;
}

export async function renderHtml(html: string, opts: RenderOptions): Promise<RenderResult> {
  const cfg = getConfig();
  const scale = opts.scale ?? 1;
  if (opts.width * opts.height * scale * scale > cfg.RENDER_MAX_PIXELS) {
    throw new ValidationError(`Render size exceeds the ${cfg.RENDER_MAX_PIXELS} pixel cap`);
  }
  const started = Date.now();
  const timeout = opts.timeoutMs ?? 45_000;
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: scale, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  try {
    const page = await context.newPage();
    // Documents are self-contained: every network request is refused so nothing can leak out of the box.
    await page.route('**/*', (route) => route.abort('blockedbyclient'));
    await page.setContent(html, { waitUntil: 'load', timeout });
    await page.waitForFunction(() => (globalThis as unknown as { __mm?: PageState }).__mm?.done === true, undefined, { timeout });
    const state = await page.evaluate(() => (globalThis as unknown as { __mm: PageState }).__mm);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: opts.width, height: opts.height }, animations: 'disabled', caret: 'hide', omitBackground: Boolean(opts.transparent), timeout });
    return { png, warnings: state.warnings ?? [], fitted: state.fitted ?? {}, durationMs: Date.now() - started };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function encodeVariants(png: Buffer): Promise<{ jpg: Buffer; webp: Buffer }> {
  const [jpg, webp] = await Promise.all([
    sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(),
    sharp(png).webp({ quality: 88 }).toBuffer(),
  ]);
  return { jpg, webp };
}
