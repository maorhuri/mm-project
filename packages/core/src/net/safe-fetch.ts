/**
 * Server-side HTTP fetch with SSRF protection: only http(s), public addresses
 * only (checked on every redirect hop), bounded size and time.
 */
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { PayloadTooLargeError, ValidationError } from '../errors';

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
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    const head = parseInt(v.split(':')[0] || '0', 16);
    if (head >= 0xfc00 && head <= 0xfdff) return true; // fc00::/7 unique local
    if (head >= 0xfe80 && head <= 0xfebf) return true; // fe80::/10 link local
    if (head === 0x0064 && v.startsWith('64:ff9b:')) return true; // NAT64 well-known prefix
    return false;
  }
  return true; // not an IP literal we understand → treat as unsafe
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ValidationError('URL must point to a public website');
  }
  if (isIPv4(host) || isIPv6(host.replace(/^\[|\]$/g, ''))) {
    if (isPrivateAddress(host.replace(/^\[|\]$/g, ''))) throw new ValidationError('URL must point to a public website');
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new ValidationError(`Could not resolve host ${host}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ValidationError('URL must point to a public website');
  }
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
  return url;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError(`Resource exceeds ${maxBytes} bytes`);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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
    const res = await fetch(current.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        'user-agent': USER_AGENT,
        accept: options.accept ?? '*/*',
        'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new ValidationError(`Redirect without location from ${current.hostname}`);
      current = assertHttpUrl(new URL(location, current).toString());
      continue;
    }
    const body = await readCapped(res, options.maxBytes);
    return {
      url: current.toString(),
      status: res.status,
      contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
      body,
    };
  }
  throw new ValidationError('Too many redirects');
};
