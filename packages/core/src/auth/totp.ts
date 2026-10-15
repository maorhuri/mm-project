/**
 * TOTP (RFC 6238) over HOTP (RFC 4226) with HMAC-SHA1, 6 digits, 30-second
 * steps — the profile Google Authenticator, Authy, 1Password etc. implement.
 * Dependency-free; verified against the RFC test vectors in tests/mfa.test.ts.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

export function generateTotpSecret(bytes = 20): Buffer {
  return randomBytes(bytes);
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | ((mac[offset + 1]! & 0xff) << 16) | ((mac[offset + 2]! & 0xff) << 8) | (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(nowMs = Date.now(), period = TOTP_PERIOD): number {
  return Math.floor(nowMs / 1000 / period);
}

export function totp(secret: Buffer, nowMs = Date.now(), period = TOTP_PERIOD, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(nowMs, period), digits);
}

export interface VerifyTotpOptions {
  nowMs?: number;
  /** Accepted drift in steps on each side (1 = ±30 s). */
  window?: number;
  period?: number;
  digits?: number;
  /** Steps at or before this value are rejected (replay protection). */
  lastUsedStep?: number | null;
}

export type VerifyTotpResult = { ok: true; step: number } | { ok: false };

export function verifyTotp(secret: Buffer, code: string, options: VerifyTotpOptions = {}): VerifyTotpResult {
  const digits = options.digits ?? TOTP_DIGITS;
  const normalized = code.replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return { ok: false };
  const window = options.window ?? 1;
  const current = totpStep(options.nowMs ?? Date.now(), options.period ?? TOTP_PERIOD);
  const provided = Buffer.from(normalized);
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    if (options.lastUsedStep !== null && options.lastUsedStep !== undefined && step <= options.lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step, digits));
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) return { ok: true, step };
  }
  return { ok: false };
}

export function totpKeyUri(params: { issuer: string; account: string; secret: Buffer }): string {
  const issuer = encodeURIComponent(params.issuer);
  const label = `${issuer}:${encodeURIComponent(params.account)}`;
  return `otpauth://totp/${label}?secret=${base32Encode(params.secret)}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// Recovery codes: 10 characters from an unambiguous alphabet, shown as xxxxx-xxxxx.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let raw = '';
    for (const b of bytes) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function looksLikeRecoveryCode(code: string): boolean {
  return /^[A-Z0-9]{10}$/i.test(normalizeRecoveryCode(code));
}
