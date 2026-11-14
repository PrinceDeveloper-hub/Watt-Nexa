import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { badRequest } from '../utils/errors';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const validated: NonNullable<Request['validated']> = {};
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        next(
          badRequest(
            'Request validation failed',
            result.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
            'VALIDATION_ERROR',
          ),
        );
        return;
      }
      validated[key] = result.data;
      // Express 5 makes req.query read-only, so keep parsed values on
      // req.validated and read from there.
    }
    req.validated = validated;
    next();
  };
}

/** Typed accessors for validated request data. */
export const bodyOf = <T>(req: Request): T => req.validated?.body as T;
export const queryOf = <T>(req: Request): T => req.validated?.query as T;
export const paramsOf = <T>(req: Request): T => (req.validated?.params ?? req.params) as T;
