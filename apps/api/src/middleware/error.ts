import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config';
import { logger } from '../lib/logger';
import { AppError } from '../utils/errors';

interface MysqlError {
  code?: string;
  sqlMessage?: string;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}`));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const mysqlError = error as MysqlError;
  if (mysqlError?.code === 'ER_DUP_ENTRY') {
    res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE', message: 'That record already exists' },
    });
    return;
  }
  if (mysqlError?.code === 'ER_NO_REFERENCED_ROW_2') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' },
    });
    return;
  }

  logger.error({ err: error, path: req.originalUrl, method: req.method }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side',
      ...(isProduction ? {} : { details: error instanceof Error ? error.message : String(error) }),
    },
  });
}
