import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@mm/db';
import { createMfaChallenge, verifyMfaChallenge } from '../src/auth/mfa-challenge';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hashRecoveryCode,
  hotp,
  totp,
  totpKeyUri,
  verifyTotp,
} from '../src/auth/totp';
import { ConflictError, ValidationError } from '../src/errors';
import { enforceRateLimit, rateLimit, resetRateLimit } from '../src/security/rate-limit';
import { confirmMfaEnrollment, disableMfa, getMfaStatus, regenerateRecoveryCodes, startMfaEnrollment, verifyMfaCode } from '../src/services/mfa';
import { createUser } from '../src/services/users';
import { decryptString } from '../src/crypto';

// RFC 6238 Appendix B test vectors (SHA1, secret "12345678901234567890").
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP primitives', () => {
  it('matches the RFC 6238 vectors', () => {
    expect(hotp(RFC_SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(RFC_SECRET, Math.floor(1234567890 / 30), 8)).toBe('89005924');
    expect(hotp(RFC_SECRET, Math.floor(2000000000 / 30), 8)).toBe('69279037');
    expect(totp(RFC_SECRET, 59 * 1000)).toBe('287082');
    expect(totp(RFC_SECRET, 1111111109 * 1000)).toBe('081804');
  });

  it('base32 round-trips and tolerates formatting', () => {
    const buf = Buffer.from('Hello, Google Authenticator!');
    const enc = base32Encode(buf);
    expect(enc).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(enc)).toEqual(buf);
    expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(buf);
    expect(() => base32Decode('abc1')).toThrow();
  });

  it('verifies within the window, rejects replays and garbage', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now })).toEqual({ ok: true, step: Math.floor(now / 30000) });
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now + 30_000 }).ok).toBe(true); // previous step still accepted
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now + 90_000 }).ok).toBe(false); // too old
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastUsedStep: Math.floor(now / 30000) }).ok).toBe(false); // replay
    expect(verifyTotp(RFC_SECRET, '12345', { nowMs: now }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', { nowMs: now }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now }).ok).toBe(true); // spaces ok
  });

  it('builds an otpauth URI Google Authenticator understands', () => {
    const uri = totpKeyUri({ issuer: 'MM Marketing OS', account: 'a@b.c', secret: RFC_SECRET });
    expect(uri.startsWith('otpauth://totp/MM%20Marketing%20OS:a%40b.c?secret=')).toBe(true);
    expect(uri).toContain('issuer=MM%20Marketing%20OS');
    expect(uri).toContain('algorithm=SHA1&digits=6&period=30');
  });

  it('recovery codes are unambiguous and hash consistently', () => {
    const codes = generateRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0]!)).toBe(hashRecoveryCode(codes[0]!.toLowerCase().replace('-', ' ')));
  });
});

describe('MFA challenge token', () => {
  it('signs, verifies, expires and rejects tampering', () => {
    const token = createMfaChallenge('user-1', 60);
    const parsed = verifyMfaChallenge(token);
    expect(parsed?.userId).toBe('user-1');
    expect(parsed?.nonce).toBeTruthy();
    expect(verifyMfaChallenge(`${token}x`)).toBeNull();
    expect(verifyMfaChallenge(token.replace(/^./, 'Z'))).toBeNull();
    expect(verifyMfaChallenge(createMfaChallenge('user-1', -1))).toBeNull();
    expect(verifyMfaChallenge(undefined)).toBeNull();
  });
});

describe('rate limiter (Redis)', () => {
  it('allows up to max in a window then blocks', async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    await resetRateLimit(key);
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60)).allowed).toBe(true);
    const blocked = await rateLimit(key, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    await expect(enforceRateLimit(key, 3, 60)).rejects.toMatchObject({ status: 429 });
    await resetRateLimit(key);
  });
});

describe('MFA enrollment & verification', () => {
  afterEach(() => vi.useRealTimers());

  it('enrols with a valid code, verifies, blocks replay, consumes recovery codes, disables', async () => {
    const user = await createUser({ email: 'mfa@test.local', name: 'M', password: 'password-1234' });
    expect(await getMfaStatus(user.id)).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });

    const enrollment = await startMfaEnrollment(user.id);
    expect(enrollment.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(enrollment.otpauthUri).toContain(`secret=${enrollment.secretBase32}`);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mfaEnabled).toBe(false);
    expect(decryptString(stored.mfaSecretEnc!)).toBe(enrollment.secretBase32);

    const secret = base32Decode(enrollment.secretBase32);
    await expect(confirmMfaEnrollment(user.id, '000000')).rejects.toBeInstanceOf(ValidationError);
    const { recoveryCodes } = await confirmMfaEnrollment(user.id, totp(secret));
    expect(recoveryCodes).toHaveLength(8);
    expect(await getMfaStatus(user.id)).toMatchObject({ enabled: true, recoveryCodesLeft: 8 });
    await expect(startMfaEnrollment(user.id)).rejects.toBeInstanceOf(ConflictError);

    // The enrolment code's step is marked used: the same code cannot log in.
    expect((await verifyMfaCode(user.id, totp(secret))).ok).toBe(false);
    // A code for the next step is accepted exactly once.
    const next = totp(secret, Date.now() + 30_000);
    expect(await verifyMfaCode(user.id, next)).toMatchObject({ ok: true, method: 'totp' });
    expect((await verifyMfaCode(user.id, next)).ok).toBe(false);

    // Recovery code: accepted once.
    expect(await verifyMfaCode(user.id, recoveryCodes[0]!)).toMatchObject({ ok: true, method: 'recovery', recoveryCodesLeft: 7 });
    expect((await verifyMfaCode(user.id, recoveryCodes[0]!)).ok).toBe(false);
    expect((await verifyMfaCode(user.id, 'ZZZZZ-ZZZZZ')).ok).toBe(false);

    // Regenerate and disable. Every step inside the ±1 window is now used, so move the clock
    // forward one minute (only Date is faked; Prisma/Redis timers keep running).
    const later = Date.now() + 60_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(later);
    const regenerated = await regenerateRecoveryCodes(user.id, totp(secret, later));
    vi.useRealTimers();
    expect(regenerated.recoveryCodes).toHaveLength(8);
    expect(await getMfaStatus(user.id)).toMatchObject({ recoveryCodesLeft: 8 });
    await expect(disableMfa(user.id, { password: 'wrong', code: '000000' })).rejects.toBeInstanceOf(ValidationError);
    await disableMfa(user.id, { password: 'password-1234', code: regenerated.recoveryCodes[1]! });
    expect(await getMfaStatus(user.id)).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
  });
});
