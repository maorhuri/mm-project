import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { isAppError, logger } from '@mm/core';
import type { ActionResult, ActionState } from './action-state';

export type { ActionState, ActionResult } from './action-state';
export { idleState } from './action-state';

const SECRET_FIELD = /(password|secret|token|apikey|api_key|code)/i;

/** String form entries worth echoing back into a re-rendered form (never secrets or files). */
function echoValues(formData: FormData | undefined): Record<string, string> | undefined {
  if (!formData) return undefined;
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && !SECRET_FIELD.test(key)) values[key] = value;
  }
  return values;
}

function attemptOf(prev: ActionState | undefined): number {
  return prev && prev.status === 'error' ? (prev.attempt ?? 1) + 1 : 1;
}

/**
 * Run an action body and translate domain/validation errors into an ActionResult.
 * Pass the FormData (and previous state) so failed submissions keep the user's input.
 */
export async function runAction(
  fn: () => Promise<{ message?: string; data?: unknown } | void>,
  formData?: FormData,
  prev?: ActionState,
): Promise<ActionResult> {
  try {
    const result = await fn();
    return { status: 'success', ...(result ?? {}) };
  } catch (err) {
    // redirect()/notFound()/forbidden() and dynamic-rendering bailouts must reach Next.js.
    unstable_rethrow(err);
    const values = echoValues(formData);
    const attempt = attemptOf(prev);
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) fieldErrors[issue.path.join('.') || '_'] ??= issue.message;
      // Bubble nested issues (e.g. features.2) up to every ancestor key so list fields show them.
      for (const issue of err.issues) {
        for (let depth = issue.path.length - 1; depth >= 1; depth--) {
          const parent = issue.path.slice(0, depth).join('.');
          const child = issue.path[depth];
          const where = typeof child === 'number' ? `פריט ${child + 1}: ` : `${String(child)}: `;
          fieldErrors[parent] ??= `${where}${issue.message}`;
        }
      }
      return { status: 'error', message: 'יש לתקן את השדות המסומנים', fieldErrors, values, attempt };
    }
    if (isAppError(err)) {
      const fieldErrors: Record<string, string> = {};
      if (Array.isArray(err.details)) {
        for (const d of err.details as { path?: string; message?: string }[]) {
          if (d.path && d.message) fieldErrors[d.path] ??= d.message;
        }
      }
      return { status: 'error', message: translateError(err.code, err.message), fieldErrors, values, attempt };
    }
    logger.error({ err }, 'unhandled action error');
    return { status: 'error', message: 'אירעה שגיאה בלתי צפויה. נסו שוב.', values, attempt };
  }
}

function translateError(code: string, fallback: string): string {
  switch (code) {
    case 'unauthorized':
      return 'נדרשת התחברות';
    case 'forbidden':
      return 'אין לך הרשאה לבצע פעולה זו';
    case 'not_found':
      return 'הפריט לא נמצא';
    case 'rate_limited':
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
