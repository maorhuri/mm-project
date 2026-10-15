'use server';

import { revalidatePath } from 'next/cache';
import {
  changePassword,
  changePasswordSchema,
  confirmMfaEnrollment,
  disableMfa,
  invalidateAllUserSessions,
  mfaDisableSchema,
  mfaVerifySchema,
  regenerateRecoveryCodes,
  startMfaEnrollment,
} from '@mm/core';
import { runAction, str } from '@/lib/actions';
import type { ActionResult, ActionState } from '@/lib/actions';
import { requireUser } from '@/lib/auth';

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { user, session } = await requireUser();
    const input = changePasswordSchema.parse({
      currentPassword: str(formData, 'currentPassword'),
      newPassword: str(formData, 'newPassword'),
      confirmPassword: str(formData, 'confirmPassword'),
    });
    const res = await changePassword(user.id, input.currentPassword, input.newPassword, session.id);
    revalidatePath('/app/settings');
    return { message: `הסיסמה שונתה. ${res.revokedSessions} חיבורים אחרים נותקו.` };
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return runAction(async () => {
    const { user, session } = await requireUser();
    const count = await invalidateAllUserSessions(user.id, session.id);
    revalidatePath('/app/settings');
    return { message: `${count} חיבורים נותקו` };
  });
}

// --- Two-factor authentication ------------------------------------------------

/** Returns { secretBase32, otpauthUri, qrDataUrl } in `data`. */
export async function startMfaEnrollmentAction(): Promise<ActionResult> {
  return runAction(async () => {
    const { user } = await requireUser();
    const enrollment = await startMfaEnrollment(user.id);
    return { message: 'סרקו את הקוד באפליקציה', data: enrollment };
  });
}

/** Confirms the first code; returns { recoveryCodes } in `data` (shown once). */
export async function confirmMfaEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { user, session } = await requireUser();
    const { code } = mfaVerifySchema.parse({ code: str(formData, 'code') });
    const res = await confirmMfaEnrollment(user.id, code, { keepSessionId: session.id });
    revalidatePath('/app', 'layout');
    return { message: 'אימות דו-שלבי הופעל', data: res };
  });
}

export async function disableMfaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { user } = await requireUser();
    const input = mfaDisableSchema.parse({ password: str(formData, 'password'), code: str(formData, 'code') });
    await disableMfa(user.id, input);
    revalidatePath('/app', 'layout');
    return { message: 'אימות דו-שלבי הושבת' };
  });
}

/** Returns { recoveryCodes } in `data`. */
export async function regenerateRecoveryCodesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { user } = await requireUser();
    const { code } = mfaVerifySchema.parse({ code: str(formData, 'code') });
    const res = await regenerateRecoveryCodes(user.id, code);
    revalidatePath('/app/settings');
    return { message: 'נוצרו קודי גיבוי חדשים — הישנים בוטלו', data: res };
  });
}
