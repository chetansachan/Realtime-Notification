// [initial module draft]
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'unprocessable'
  | 'payload_too_large'
  | 'not_ready'
  | 'internal_error';

const TITLES: Record<ErrorCode, string> = {
  bad_request: 'Bad Request',
  validation_failed: 'Validation Failed',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not Found',
  conflict: 'Conflict',
  idempotency_conflict: 'Idempotency Conflict',
  rate_limited: 'Too Many Requests',
  unprocessable: 'Unprocessable Entity',
  payload_too_large: 'Payload Too Large',
  not_ready: 'Service Unavailable',
  internal_error: 'Internal Server Error',
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, detail: string, details?: unknown) {
    super(detail);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toProblem(requestId?: string) {
    return {
      type: `https://errors.notification-service.dev/${this.code}`,
      title: TITLES[this.code],
      status: this.statusCode,
      detail: this.message,
      code: this.code,
      ...(this.details === undefined ? {} : { errors: this.details }),
      ...(requestId === undefined ? {} : { requestId }),
    };
  }
}

export const badRequest = (detail: string, details?: unknown) =>
  new AppError(400, 'bad_request', detail, details);
export const validationFailed = (detail: string, details?: unknown) =>
  new AppError(400, 'validation_failed', detail, details);
export const unauthorized = (detail = 'Missing or invalid credentials') =>
  new AppError(401, 'unauthorized', detail);
export const forbidden = (detail = 'Insufficient scope') =>
  new AppError(403, 'forbidden', detail);
export const notFound = (detail = 'Resource not found') => new AppError(404, 'not_found', detail);
export const conflict = (detail: string) => new AppError(409, 'conflict', detail);
export const idempotencyConflict = (detail: string) =>
  new AppError(409, 'idempotency_conflict', detail);
export const unprocessable = (detail: string) => new AppError(422, 'unprocessable', detail);
export const notReady = (detail = 'Service is not ready') =>
  new AppError(503, 'not_ready', detail);
export const internal = (detail = 'Internal server error') =>
  new AppError(500, 'internal_error', detail);

export interface PgError {
  code?: string;
  detail?: string;
  constraint?: string;
}

export function isPgError(err: unknown): err is PgError {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as PgError).code;
  // SQLSTATEs are five alphanumerics (23505, 23P01). Fastify's own error codes
  // look like FST_ERR_VALIDATION and must not be mistaken for database errors.
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

/** Maps SQLSTATE codes to HTTP semantics, as described in the API contract. */
export function fromPgError(err: PgError): AppError {
  switch (err.code) {
    case '23505':
      return conflict(err.detail ?? `Unique constraint violated${err.constraint ? `: ${err.constraint}` : ''}`);
    case '23503':
      return unprocessable(err.detail ?? 'Referenced resource does not exist');
    case '23514':
      return conflict(err.detail ?? 'Constraint violated');
    default:
      return internal();
  }
}
