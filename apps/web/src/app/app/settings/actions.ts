'use server';

import { revalidatePath } from 'next/cache';
import { changePassword, changePasswordSchema, invalidateAllUserSessions } from '@mm/core';
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
