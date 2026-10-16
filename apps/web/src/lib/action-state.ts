/** Shared between server actions and client forms — must stay free of server-only imports. */
export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; data?: unknown }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Record<string, string>;
      /**
       * Submitted string values echoed back so the form can re-populate itself:
       * React 19 resets a <form action> after the action returns, even on error.
       * Secrets (password/key fields) are never echoed.
       */
      values?: Record<string, string>;
      /** Increments per failed submission; use as the form `key` so defaults re-apply. */
      attempt?: number;
    };

/** What an executed action actually returns (never idle). */
export type ActionResult = Exclude<ActionState, { status: 'idle' }>;

export const idleState: ActionState = { status: 'idle' };

/** Value to show in an input after a failed submission, else the original default. */
export function formValue(state: ActionState, name: string, fallback: string | number | null | undefined): string {
  if (state.status === 'error' && state.values && name in state.values) return state.values[name] ?? '';
  return fallback === null || fallback === undefined ? '' : String(fallback);
}

/** `on` / `off` for checkboxes after a failed submission. */
export function formChecked(state: ActionState, name: string, fallback: boolean): boolean {
  if (state.status === 'error' && state.values) return state.values[name] === 'on';
  return fallback;
}

/** Changes after every failed submission so a form keyed on it remounts with the echoed values. */
export function formKey(state: ActionState): string {
  return state.status === 'error' ? `attempt-${state.attempt ?? 1}` : 'initial';
}

/**
 * Await a server action called from client code (startTransition etc.). A
 * transport-level failure (network, 5xx, deploy in progress) becomes an error
 * result instead of throwing into the nearest error boundary.
 */
export async function callAction(promise: Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await promise;
  } catch {
    return { status: 'error', message: 'החיבור לשרת נכשל — נסו שוב בעוד רגע' };
  }
}

/** First field-level message, for toasts when a form has no inline slot for it. */
export function firstFieldError(state: ActionResult): string | null {
  if (state.status !== 'error' || !state.fieldErrors) return null;
  const first = Object.entries(state.fieldErrors)[0];
  return first ? `${first[0]}: ${first[1]}` : null;
}
