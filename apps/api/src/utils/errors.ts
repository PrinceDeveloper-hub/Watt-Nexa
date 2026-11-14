export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found', code = 'NOT_FOUND') =>
  new AppError(404, code, message);

export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);

export const tooManyRequests = (message = 'Too many requests') =>
  new AppError(429, 'RATE_LIMITED', message);

export const badGateway = (message = 'Upstream service failed') =>
  new AppError(502, 'BAD_GATEWAY', message);
