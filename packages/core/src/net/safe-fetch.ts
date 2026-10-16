/**
 * Server-side HTTP fetch with SSRF protection.
 *
 * Only http(s) on ports 80/443; the hostname is validated up front (cheap,
 * user-facing errors) AND every socket is pinned to vetted addresses by doing
 * the private-address check inside the connector's own DNS lookup — so a DNS
 * answer that changes between "check" and "connect" (rebinding) cannot reach a
 * private address. Redirects are followed manually through the same agent.
 * Size and time are bounded.
 */
import dns from 'node:dns';
import { isIPv4, isIPv6 } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { AppError, PayloadTooLargeError, ValidationError } from '../errors';

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  accept?: string;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export type Fetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;

const USER_AGENT = 'MM-Marketing-OS/1.0 (+brand-kit-import; contact: support@mvn.co.il)';
const ALLOWED_PORTS = new Set(['', '80', '443']);

export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIPv6(ip)) {
    const v = ip.toLowerCase().replace(/%.*$/, '');
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    const head = parseInt(v.split(':')[0] || '0', 16);
    if (head >= 0xfc00 && head <= 0xfdff) return true; // fc00::/7 unique local
    if (head >= 0xfe80 && head <= 0xfebf) return true; // fe80::/10 link local
    if (v.startsWith('64:ff9b:')) return true; // NAT64 well-known prefix
    if (v.startsWith('2002:')) return true; // 6to4 — could embed a private v4
    return false;
  }
  return true; // not an IP literal we understand → treat as unsafe
}

const BLOCKED_HOST = new ValidationError('URL must point to a public website');

/**
 * DNS lookup used by the connector: every answer must be public, otherwise the
 * connection is refused. Handles both the single-address and `all: true`
 * (happy-eyeballs) call shapes net.connect uses.
 */
type LookupCallback = (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;
function guardedLookup(hostname: string, options: dns.LookupOptions | number, callback: LookupCallback): void {
  const opts: dns.LookupOptions = typeof options === 'number' ? { family: options } : { ...options };
  dns.lookup(hostname, { ...opts, all: true }, (err, result) => {
    if (err) return callback(err);
    const list = (Array.isArray(result) ? result : [result]) as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error(BLOCKED_HOST.message), { code: 'EPRIVATEADDR' }));
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

let agent: Agent | undefined;
function getAgent(): Agent {
  // `connect.lookup` is typed loosely by undici; the cast keeps our guarded signature.
  agent ??= new Agent({
    connect: { lookup: guardedLookup, timeout: 10_000 } as unknown as Agent.Options['connect'],
  });
  return agent;
}

/** Cheap, user-facing pre-check (the connector enforces the real guarantee). */
export async function assertPublicHostname(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw BLOCKED_HOST;
  }
  if (isIPv4(host) || isIPv6(host)) {
    if (isPrivateAddress(host)) throw BLOCKED_HOST;
    return;
  }
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new ValidationError(`Could not resolve host ${host}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw BLOCKED_HOST;
}

function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new ValidationError('URLs with credentials are not allowed');
  if (!ALLOWED_PORTS.has(url.port)) throw new ValidationError('Only the standard web ports (80/443) are allowed');
  return url;
}

/** Translate transport failures into clear, user-facing errors. */
function fetchFailure(err: unknown, hostname: string, timeoutMs: number): AppError {
  if (err instanceof AppError) return err;
  const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
  const code = cause?.code ?? (err as { code?: string } | null)?.code;
  const name = (err as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new ValidationError(`${hostname} did not respond within ${Math.round(timeoutMs / 1000)}s`);
  }
  if (code === 'EPRIVATEADDR') return BLOCKED_HOST;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new ValidationError(`Could not resolve host ${hostname}`);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') return new ValidationError(`${hostname} refused the connection`);
  if (typeof code === 'string' && /CERT|SSL|TLS/i.test(code)) return new ValidationError(`${hostname} has an invalid TLS certificate`);
  return new ValidationError(`Could not fetch ${hostname}: ${cause?.message ?? (err instanceof Error ? err.message : 'network error')}`.slice(0, 300));
}

/** Structural stream type: undici's and the global ReadableStream types differ but both satisfy this. */
interface ByteStream {
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
}

async function readCapped(body: ByteStream | null, declaredLength: number, maxBytes: number): Promise<Buffer> {
  if (declaredLength > maxBytes) throw new PayloadTooLargeError(`Resource exceeds ${maxBytes} bytes`);
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError(`Resource exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Fetch a public URL safely. Redirects are followed manually and re-validated. */
export const safeFetch: Fetcher = async (raw, options) => {
  const maxRedirects = options.maxRedirects ?? 4;
  let current = assertHttpUrl(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHostname(current.hostname);
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(current.toString(), {
        dispatcher: getAgent(),
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? '*/*',
          'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
        },
      });
    } catch (err) {
      throw fetchFailure(err, current.hostname, options.timeoutMs);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new ValidationError(`Redirect without location from ${current.hostname}`);
      current = assertHttpUrl(new URL(location, current).toString());
      continue;
    }
    let body: Buffer;
    try {
      body = await readCapped(res.body as unknown as ByteStream | null, Number(res.headers.get('content-length') ?? 0), options.maxBytes);
    } catch (err) {
      throw fetchFailure(err, current.hostname, options.timeoutMs);
    }
    return {
      url: current.toString(),
      status: res.status,
      contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
      body,
    };
  }
  throw new ValidationError('Too many redirects');
};
