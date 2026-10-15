import 'server-only';
import { ZodError } from 'zod';
import { isAppError, logger } from '@mm/core';
import type { ActionResult } from './action-state';

export type { ActionState, ActionResult } from './action-state';
export { idleState } from './action-state';

/** Run an action body and translate domain/validation errors into an ActionResult. */
export async function runAction(
  fn: () => Promise<{ message?: string; data?: unknown } | void>,
): Promise<ActionResult> {
  try {
    const result = await fn();
    return { status: 'success', ...(result ?? {}) };
  } catch (err) {
    // Next.js uses thrown values for redirect()/notFound(); let them through.
    if (isNextControlFlow(err)) throw err;
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        fieldErrors[key] ??= issue.message;
      }
      return { status: 'error', message: 'יש לתקן את השדות המסומנים', fieldErrors };
    }
    if (isAppError(err)) {
      const fieldErrors: Record<string, string> = {};
      if (Array.isArray(err.details)) {
        for (const d of err.details as { path?: string; message?: string }[]) {
          if (d.path && d.message) fieldErrors[d.path] ??= d.message;
        }
      }
      return { status: 'error', message: translateError(err.code, err.message), fieldErrors };
    }
    logger.error({ err }, 'unhandled action error');
    return { status: 'error', message: 'אירעה שגיאה בלתי צפויה. נסו שוב.' };
  }
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: string } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND');
}

function translateError(code: string, fallback: string): string {
  switch (code) {
    case 'unauthorized':
      return 'נדרשת התחברות';
    case 'forbidden':
      return 'אין לך הרשאה לבצע פעולה זו';
    case 'not_found':
      return 'הפריט לא נמצא';
    case 'conflict':
      return fallback;
    case 'payload_too_large':
      return 'הקובץ גדול מדי';
    default:
      return fallback;
  }
}

/** Read list-style textarea input: one item per line, trimmed, de-duplicated. */
export function linesToList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean))];
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}

export function optionalStr(form: FormData, key: string): string | null {
  const v = str(form, key).trim();
  return v ? v : null;
}

export function numberOrNull(form: FormData, key: string): number | null {
  const v = str(form, key).trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
