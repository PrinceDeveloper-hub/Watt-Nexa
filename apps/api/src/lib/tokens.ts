import type { Role } from '@wattnexa/types';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { db, userSessions } from '@wattnexa/database';
import { and, eq, isNull } from 'drizzle-orm';
import { appConfig, env, isProduction } from '../config';
import { newId, randomToken, sha256 } from '../utils/crypto';

export interface AccessPayload {
  sub: string;
  role: Role;
  sid: string;
  typ: 'access';
}

export function signAccessToken(payload: Omit<AccessPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: appConfig.accessTokenTtlSeconds,
  });
}

export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded === 'string' || decoded.typ !== 'access') return null;
    return decoded as unknown as AccessPayload;
  } catch {
    return null;
  }
}

// SameSite=None is only valid together with Secure, and is required when the
// web app and API are served from different sites (Vercel + VPS).
const sameSite = env.COOKIE_SAME_SITE;
const baseCookie: CookieOptions = {
  httpOnly: true,
  sameSite,
  secure: sameSite === 'none' ? true : isProduction || env.COOKIE_SECURE,
  path: '/',
};

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  res.cookie(appConfig.cookies.access, tokens.accessToken, {
    ...baseCookie,
    maxAge: appConfig.accessTokenTtlSeconds * 1000,
  });
  res.cookie(appConfig.cookies.refresh, tokens.refreshToken, {
    ...baseCookie,
    maxAge: Math.max(0, tokens.refreshExpiresAt.getTime() - Date.now()),
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(appConfig.cookies.access, baseCookie);
  res.clearCookie(appConfig.cookies.refresh, baseCookie);
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  refreshExpiresAt: Date;
}

export async function createSession(
  user: { id: string; role: Role },
  meta: { userAgent?: string; ipAddress?: string; rememberMe?: boolean },
): Promise<IssuedSession> {
  const rememberMe = meta.rememberMe ?? false;
  const refreshToken = randomToken(48);
  const sessionId = newId();
  const ttlMs =
    (rememberMe ? env.REFRESH_TOKEN_TTL_DAYS : 1) * 24 * 60 * 60 * 1000;
  const refreshExpiresAt = new Date(Date.now() + ttlMs);

  await db.insert(userSessions).values({
    id: sessionId,
    userId: user.id,
    tokenHash: sha256(refreshToken),
    userAgent: meta.userAgent?.slice(0, 500),
    ipAddress: meta.ipAddress?.slice(0, 60),
    rememberMe,
    expiresAt: refreshExpiresAt,
  });

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, sid: sessionId }),
    refreshToken,
    sessionId,
    refreshExpiresAt,
  };
}

export interface RotatedSession {
  userId: string;
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Rotate a refresh token. Reuse of a revoked token revokes the session. */
export async function rotateSession(refreshToken: string): Promise<RotatedSession | null> {
  const hash = sha256(refreshToken);
  const [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.tokenHash, hash), isNull(userSessions.revokedAt)))
    .limit(1);

  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const nextToken = randomToken(48);
  const refreshExpiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await db
    .update(userSessions)
    .set({ tokenHash: sha256(nextToken), lastUsedAt: new Date(), expiresAt: refreshExpiresAt })
    .where(eq(userSessions.id, session.id));

  return {
    userId: session.userId,
    sessionId: session.id,
    refreshToken: nextToken,
    refreshExpiresAt,
  };
}

export async function revokeSessionByToken(refreshToken: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.tokenHash, sha256(refreshToken)));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
}
