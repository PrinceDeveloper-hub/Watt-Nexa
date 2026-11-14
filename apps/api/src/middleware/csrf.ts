import type { NextFunction, Request, Response } from 'express';
import { env } from '../config';
import { forbidden } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Session cookies use SameSite=Lax, which blocks cross-site form posts. As a
 * second layer, state-changing requests that carry a browser Origin must come
 * from a known good origin. Requests without Origin (curl, device hardware)
 * are not cookie-authenticated and are unaffected.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  const allowed = new Set([...env.CORS_ORIGINS, env.WEB_URL]);
  if (!allowed.has(origin)) {
    next(forbidden('Cross-origin request blocked'));
    return;
  }
  next();
}
