/**
 * Two-factor authentication (TOTP, Google Authenticator compatible) with
 * one-time recovery codes. Secrets are stored AES-256-GCM encrypted; recovery
 * codes are stored as sha256 hashes and consumed on use.
 */
import { db } from '@mm/db';
import { toDataURL } from 'qrcode';
import { recordAudit } from '../audit';
import { getConfig } from '../config';
import { decryptString, encryptString } from '../crypto';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { verifyPassword } from '../auth/password';
import { invalidateAllUserSessions } from '../auth/session';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  totpKeyUri,
  verifyTotp,
} from '../auth/totp';

export interface MfaStatus {
  enabled: boolean;
  enrolledAt: Date | null;
  recoveryCodesLeft: number;
}

export interface MfaEnrollment {
  secretBase32: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export type MfaVerification =
  | { ok: true; method: 'totp' | 'recovery'; recoveryCodesLeft: number }
  | { ok: false };

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaEnrolledAt: true, mfaRecoveryCodes: true },
  });
  if (!user) throw new NotFoundError('user');
  return { enabled: user.mfaEnabled, enrolledAt: user.mfaEnrolledAt, recoveryCodesLeft: user.mfaRecoveryCodes.length };
}

/** Step 1: generate a secret and the QR code. Not active until confirmed. */
export async function startMfaEnrollment(userId: string): Promise<MfaEnrollment> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('user');
  if (user.mfaEnabled) throw new ConflictError('Two-factor authentication is already enabled');
  const secret = generateTotpSecret();
  const secretBase32 = base32Encode(secret);
  await db.user.update({ where: { id: userId }, data: { mfaSecretEnc: encryptString(secretBase32) } });
  const otpauthUri = totpKeyUri({ issuer: getConfig().APP_NAME, account: user.email, secret });
  const qrDataUrl = await toDataURL(otpauthUri, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return { secretBase32, otpauthUri, qrDataUrl };
}

/** Step 2: prove the authenticator works, enable MFA, hand out recovery codes once. */
export async function confirmMfaEnrollment(
  userId: string,
  code: string,
  options: { keepSessionId?: string } = {},
): Promise<{ recoveryCodes: string[] }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('user');
  if (user.mfaEnabled) throw new ConflictError('Two-factor authentication is already enabled');
  if (!user.mfaSecretEnc) throw new ValidationError('Start the enrollment first');
  const secret = base32Decode(decryptString(user.mfaSecretEnc));
  const result = verifyTotp(secret, code, { window: 1 });
  if (!result.ok) {
    throw new ValidationError('Invalid code', [{ path: 'code', message: 'הקוד שגוי — נסו שוב עם הקוד הנוכחי באפליקציה' }]);
  }
  const recoveryCodes = generateRecoveryCodes(8);
  await db.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      mfaLastUsedStep: result.step,
      mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
    },
  });
  const revoked = await invalidateAllUserSessions(userId, options.keepSessionId);
  await recordAudit(
    { actorUserId: userId },
    { action: 'auth.mfa.enable', entityType: 'user', entityId: userId, metadata: { revokedSessions: revoked } },
  );
  return { recoveryCodes };
}

/** Verify a TOTP or recovery code for a user with MFA enabled. */
export async function verifyMfaCode(userId: string, code: string): Promise<MfaVerification> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.mfaEnabled || !user.mfaSecretEnc) return { ok: false };

  if (looksLikeRecoveryCode(code) && !/^\d{6}$/.test(code.replace(/[\s-]/g, ''))) {
    const hash = hashRecoveryCode(code);
    if (!user.mfaRecoveryCodes.includes(hash)) return { ok: false };
    const remaining = user.mfaRecoveryCodes.filter((h) => h !== hash);
    await db.user.update({ where: { id: userId }, data: { mfaRecoveryCodes: remaining } });
    await recordAudit(
      { actorUserId: userId },
      { action: 'auth.mfa.recovery_code_used', entityType: 'user', entityId: userId, metadata: { remaining: remaining.length } },
    );
    return { ok: true, method: 'recovery', recoveryCodesLeft: remaining.length };
  }

  const secret = base32Decode(decryptString(user.mfaSecretEnc));
  const result = verifyTotp(secret, code, { window: 1, lastUsedStep: user.mfaLastUsedStep });
  if (!result.ok) return { ok: false };
  await db.user.update({ where: { id: userId }, data: { mfaLastUsedStep: result.step } });
  return { ok: true, method: 'totp', recoveryCodesLeft: user.mfaRecoveryCodes.length };
}

/** Turn MFA off — requires the password and a valid code. */
export async function disableMfa(userId: string, input: { password: string; code: string }): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('user');
  if (!user.mfaEnabled) throw new ConflictError('Two-factor authentication is not enabled');
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new ValidationError('Invalid password', [{ path: 'password', message: 'הסיסמה שגויה' }]);
  }
  const verified = await verifyMfaCode(userId, input.code);
  if (!verified.ok) throw new ValidationError('Invalid code', [{ path: 'code', message: 'הקוד שגוי' }]);
  await db.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecretEnc: null, mfaEnrolledAt: null, mfaLastUsedStep: null, mfaRecoveryCodes: [] },
  });
  await recordAudit({ actorUserId: userId }, { action: 'auth.mfa.disable', entityType: 'user', entityId: userId });
}

/** Replace all recovery codes — requires a valid TOTP code. */
export async function regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('user');
  if (!user.mfaEnabled || !user.mfaSecretEnc) throw new ConflictError('Two-factor authentication is not enabled');
  const secret = base32Decode(decryptString(user.mfaSecretEnc));
  const result = verifyTotp(secret, code, { window: 1, lastUsedStep: user.mfaLastUsedStep });
  if (!result.ok) throw new ValidationError('Invalid code', [{ path: 'code', message: 'הקוד שגוי' }]);
  const recoveryCodes = generateRecoveryCodes(8);
  await db.user.update({
    where: { id: userId },
    data: { mfaLastUsedStep: result.step, mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
  });
  await recordAudit({ actorUserId: userId }, { action: 'auth.mfa.recovery_codes_regenerated', entityType: 'user', entityId: userId });
  return { recoveryCodes };
}
