import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@wattnexa/types';
import { db, users } from '@wattnexa/database';
import { and, eq, isNull } from 'drizzle-orm';
import { appConfig } from '../config';
import { verifyAccessToken } from '../lib/tokens';
import { forbidden, unauthorized } from '../utils/errors';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.cookies?.[appConfig.cookies.access];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : null;
}

/**
 * Verifies the access token and re-reads the user so suspensions and role
 * changes take effect immediately rather than at token expiry.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized();
    const payload = verifyAccessToken(token);
    if (!payload) throw unauthorized('Session expired or invalid', 'INVALID_TOKEN');

    const [user] = await db
      .select({ id: users.id, role: users.role, suspended: users.isSuspended })
      .from(users)
      .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
      .limit(1);

    if (!user) throw unauthorized('Account no longer exists', 'INVALID_TOKEN');
    if (user.suspended) throw forbidden('This account is suspended');

    req.auth = { userId: user.id, role: user.role, sessionId: payload.sid };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(forbidden('Your role does not permit this action'));
      return;
    }
    next();
  };
}
