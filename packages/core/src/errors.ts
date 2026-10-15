import type { ZodError } from 'zod';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details ?? null } };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'resource') {
    super(404, 'not_found', `${entity} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(422, 'validation_error', message, details);
  }

  static fromZod(err: ZodError): ValidationError {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new ValidationError('Validation failed', details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'File is too large') {
    super(413, 'payload_too_large', message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
