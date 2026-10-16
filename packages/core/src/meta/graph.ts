/**
 * Minimal Meta Graph API client: GET with pagination, typed errors, injectable
 * fetcher (tests), never logs tokens. Version comes from META_API_VERSION.
 */
import { getConfig } from '../config';
import { AppError } from '../errors';
import { logger } from '../logger';

export class MetaApiError extends AppError {
  readonly fbCode: number | null;
  readonly fbSubcode: number | null;
  readonly fbType: string | null;
  constructor(message: string, info: { status?: number; code?: number | null; subcode?: number | null; type?: string | null; traceId?: string | null } = {}) {
    super(info.status ?? 502, 'meta_api_error', message, { code: info.code ?? null, subcode: info.subcode ?? null, type: info.type ?? null, traceId: info.traceId ?? null });
    this.fbCode = info.code ?? null;
    this.fbSubcode = info.subcode ?? null;
    this.fbType = info.type ?? null;
  }
  /** OAuthException 190 = invalid/expired token; 10/200-299 = permission errors. */
  get isAuthError(): boolean {
    return this.fbCode === 190 || this.fbType === 'OAuthException';
  }
}

export type GraphFetcher = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

const defaultFetcher: GraphFetcher = (url, init) => fetch(url, init);

export interface GraphPage<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
}

export class GraphClient {
  readonly base: string;
  constructor(
    private readonly fetcher: GraphFetcher = defaultFetcher,
    version = getConfig().META_API_VERSION,
  ) {
    this.base = `https://graph.facebook.com/${version}`;
  }

  /** Absolute or relative URL; `params` are appended; the token is passed as a query param only over HTTPS to graph.facebook.com. */
  async get<T = unknown>(path: string, params: Record<string, string | number | undefined>, accessToken: string | null): Promise<T> {
    const url = new URL(path.startsWith('https://') ? path : `${this.base}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    if (accessToken) url.searchParams.set('access_token', accessToken);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let status = 0;
    let text = '';
    let usage: string | null = null;
    try {
      const res = await this.fetcher(url.toString(), { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
      status = res.status;
      text = await res.text();
      usage = res.headers.get('x-business-use-case-usage') ?? res.headers.get('x-app-usage');
    } catch (err) {
      throw new MetaApiError(`Meta API unreachable: ${err instanceof Error ? err.message : String(err)}`, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
    if (usage) logger.debug({ usage: usage.slice(0, 300), path: url.pathname }, 'meta api usage');
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new MetaApiError(`Meta API returned a non-JSON response (${status})`, { status: 502 });
    }
    const error = (json as { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } }).error;
    if (error || status >= 400) {
      throw new MetaApiError(`Meta: ${error?.message ?? `HTTP ${status}`}`, {
        status: status === 401 || status === 403 || error?.code === 190 ? 401 : status === 429 ? 429 : 502,
        code: error?.code ?? null,
        subcode: error?.error_subcode ?? null,
        type: error?.type ?? null,
        traceId: error?.fbtrace_id ?? null,
      });
    }
    return json as T;
  }

  /** Follow `paging.next` until exhausted or `max` items collected. */
  async getAll<T>(path: string, params: Record<string, string | number | undefined>, accessToken: string, max = 2000): Promise<T[]> {
    const out: T[] = [];
    let page = await this.get<GraphPage<T>>(path, { limit: 100, ...params }, accessToken);
    for (let guard = 0; guard < 100; guard++) {
      out.push(...(page.data ?? []));
      const next = page.paging?.next;
      if (!next || out.length >= max) break;
      // `next` already carries the token and params.
      page = await this.get<GraphPage<T>>(next, {}, null);
    }
    return out.slice(0, max);
  }
}

/** Meta reports budgets in the currency's minor unit (agorot/cents); insights spend in major units. */
export function minorToMajor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) / 100 : null;
}

export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
