/** Shared between server actions and client forms — must stay free of server-only imports. */
export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; data?: unknown }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

/** What an executed action actually returns (never idle). */
export type ActionResult = Exclude<ActionState, { status: 'idle' }>;

export const idleState: ActionState = { status: 'idle' };
