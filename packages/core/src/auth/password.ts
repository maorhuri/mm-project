import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended parameters (19 MiB, 2 iterations, 1 lane).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Pre-computed hash used to keep login timing constant when the user does not exist. */
let dummyHashPromise: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('dummy-password-for-constant-time-login');
  return dummyHashPromise;
}
