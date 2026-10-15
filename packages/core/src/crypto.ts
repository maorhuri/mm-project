import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getConfig } from './config';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function key(): Buffer {
  const raw = Buffer.from(getConfig().APP_ENCRYPTION_KEY, 'base64');
  if (raw.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)');
  }
  return raw;
}

/** Encrypt a UTF-8 string for storage (OAuth tokens, API keys, TOTP secrets). */
export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptString(token: string): string {
  const [version, ivB64, tagB64, ctB64] = token.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted value');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T = unknown>(token: string): T {
  return JSON.parse(decryptString(token)) as T;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** URL-safe random token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
