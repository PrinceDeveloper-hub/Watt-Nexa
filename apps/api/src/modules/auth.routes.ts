import { Router } from 'express';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { PublicUser } from '@wattnexa/types';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@wattnexa/shared';
import { db, emailVerifications, passwordResets, userSessions, users } from '@wattnexa/database';
import { appConfig, isProduction } from '../config';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  clearAuthCookies,
  createSession,
  revokeAllSessions,
  revokeSessionById,
  revokeSessionByToken,
  rotateSession,
  setAuthCookies,
  signAccessToken,
} from '../lib/tokens';
import { sendPasswordReset, sendVerificationCode } from '../lib/mailer';
import { auditFromRequest, recordAudit } from '../lib/audit';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rate-limit';
import { validate, bodyOf } from '../middleware/validate';
import { ok, created, asyncHandler } from '../utils/http';
import { newId, randomNumericCode, randomToken, sha256 } from '../utils/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../utils/errors';
import { provisionNewAccount } from '../services/accounts';

type UserRow = typeof users.$inferSelect;

const toPublicUser = (user: UserRow): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  emailVerified: user.emailVerifiedAt !== null,
  timezone: user.timezone,
  currency: user.currency,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt.toISOString(),
});

const verifyByEmailSchema = verifyEmailSchema.extend({ email: z.string().trim().toLowerCase().email() });
const CODE_TTL_MS = 15 * 60 * 1000;

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof registerSchema>>(req);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) throw conflict('An account with that email already exists', 'EMAIL_TAKEN');

    const userId = newId();
    await db.insert(users).values({
      id: userId,
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    });

    await provisionNewAccount(userId, input.name);

    const code = randomNumericCode();
    await db.insert(emailVerifications).values({
      id: newId(),
      userId,
      codeHash: sha256(code),
      purpose: 'email_verify',
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    await sendVerificationCode(input.email, code);
    await recordAudit({ actorId: userId, action: 'auth.register', resourceType: 'user', resourceId: userId, ipAddress: req.ip });

    return created(res, {
      requiresVerification: true,
      email: input.email,
      // Development affordance so the flow is usable without SMTP.
      ...(isProduction ? {} : { devCode: code }),
    });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof loginSchema>>(req);
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);

    // Constant-ish work whether or not the account exists.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const valid = await verifyPassword(input.password, hash);
    if (!user || !valid) throw unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
    if (user.isSuspended) throw forbidden('This account is suspended');

    if (!user.emailVerifiedAt) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in', {
        email: user.email,
      });
    }

    const session = await createSession(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      rememberMe: input.remember,
    });
    setAuthCookies(res, session);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await recordAudit({ actorId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id, ipAddress: req.ip });

    return ok(res, {
      user: toPublicUser(user),
      accessToken: session.accessToken,
      expiresIn: appConfig.accessTokenTtlSeconds,
    });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[appConfig.cookies.refresh];
    if (typeof token !== 'string' || !token) throw unauthorized('No refresh token', 'NO_SESSION');
    const rotated = await rotateSession(token);
    if (!rotated) {
      clearAuthCookies(res);
      throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');
    }
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, rotated.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user || user.isSuspended) {
      clearAuthCookies(res);
      throw unauthorized('Session is no longer valid', 'SESSION_INVALID');
    }
    const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: rotated.sessionId });
    setAuthCookies(res, {
      accessToken,
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.refreshExpiresAt,
    });
    return ok(res, { user: toPublicUser(user), accessToken, expiresIn: appConfig.accessTokenTtlSeconds });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[appConfig.cookies.refresh];
    if (typeof token === 'string' && token) await revokeSessionByToken(token);
    clearAuthCookies(res);
    return ok(res, { loggedOut: true });
  }),
);

authRouter.post(
  '/verify-email',
  authLimiter,
  validate({ body: verifyByEmailSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof verifyByEmailSchema>>(req);
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw notFound('Account not found', 'ACCOUNT_NOT_FOUND');
    if (user.emailVerifiedAt) return ok(res, { verified: true, alreadyVerified: true });

    const [verification] = await db
      .select()
      .from(emailVerifications)
      .where(
        and(
          eq(emailVerifications.userId, user.id),
          eq(emailVerifications.purpose, 'email_verify'),
          isNull(emailVerifications.consumedAt),
          gt(emailVerifications.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    if (!verification) throw badRequest('Code expired. Request a new one.', undefined, 'CODE_EXPIRED');
    if (verification.attempts >= 5) throw badRequest('Too many attempts. Request a new code.', undefined, 'CODE_LOCKED');

    if (verification.codeHash !== sha256(input.code)) {
      await db
        .update(emailVerifications)
        .set({ attempts: verification.attempts + 1 })
        .where(eq(emailVerifications.id, verification.id));
      throw badRequest('That code is not correct', undefined, 'CODE_INVALID');
    }

    await db.update(emailVerifications).set({ consumedAt: new Date() }).where(eq(emailVerifications.id, verification.id));
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));

    const session = await createSession(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setAuthCookies(res, session);
    return ok(res, { verified: true, user: toPublicUser({ ...user, emailVerifiedAt: new Date() }), accessToken: session.accessToken });
  }),
);

authRouter.post(
  '/resend-verification',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const { email } = bodyOf<{ email: string }>(req);
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    if (!user || user.emailVerifiedAt) {
      return ok(res, { sent: true });
    }
    const code = randomNumericCode();
    await db.insert(emailVerifications).values({
      id: newId(),
      userId: user.id,
      codeHash: sha256(code),
      purpose: 'email_verify',
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    await sendVerificationCode(user.email, code);
    return ok(res, { sent: true, ...(isProduction ? {} : { devCode: code }) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!user) throw unauthorized();
    return ok(res, toPublicUser(user));
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof updateProfileSchema>>(req);
    if (Object.keys(input).length === 0) throw badRequest('Nothing to update');
    await db.update(users).set(input).where(eq(users.id, req.auth!.userId));
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!user) throw unauthorized();
    return ok(res, toPublicUser(user));
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof changePasswordSchema>>(req);
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', undefined, 'PASSWORD_INCORRECT');
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword) })
      .where(eq(users.id, user.id));

    // Keep the current session, drop the rest.
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt)));
    await revokeSessionById(user.id, req.auth!.sessionId);
    await recordAudit({ actorId: user.id, action: 'auth.password_changed', resourceType: 'user', resourceId: user.id });
    clearAuthCookies(res);
    return ok(res, { changed: true, reauthenticate: true });
  }),
);

authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const { email } = bodyOf<{ email: string }>(req);
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    // Always report success so the endpoint cannot enumerate accounts.
    if (!user) return ok(res, { sent: true });

    const token = randomToken(32);
    await db.insert(passwordResets).values({
      id: newId(),
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    await sendPasswordReset(user.email, token);
    await recordAudit({ actorId: user.id, action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id });
    return ok(res, { sent: true, ...(isProduction ? {} : { devToken: token }) });
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof resetPasswordSchema>>(req);
    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, sha256(input.token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!reset) throw badRequest('This reset link is invalid or expired', undefined, 'RESET_INVALID');

    await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, reset.userId));
    await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
    await revokeAllSessions(reset.userId);
    clearAuthCookies(res);
    await recordAudit({ actorId: reset.userId, action: 'auth.password_reset', resourceType: 'user', resourceId: reset.userId });
    return ok(res, { reset: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, req.auth!.userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userSessions.lastUsedAt));
    return ok(
      res,
      rows.map((row) => ({
        id: row.id,
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        rememberMe: row.rememberMe,
        lastUsedAt: row.lastUsedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        current: row.id === req.auth!.sessionId,
      })),
    );
  }),
);

authRouter.delete(
  '/sessions/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSessionById(req.auth!.userId, req.params.sessionId as string);
    return ok(res, { revoked: true });
  }),
);

authRouter.get(
  '/login-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, req.auth!.userId))
      .orderBy(desc(userSessions.createdAt))
      .limit(20);
    return ok(
      res,
      rows.map((row) => ({
        id: row.id,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })),
    );
  }),
);

authRouter.delete(
  '/account',
  requireAuth,
  validate({ body: z.object({ password: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const { password } = bodyOf<{ password: string }>(req);
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw badRequest('Password is incorrect', undefined, 'PASSWORD_INCORRECT');
    }
    // Soft delete + detach the email so the address can be reused.
    await db
      .update(users)
      .set({
        deletedAt: new Date(),
        email: `deleted_${user.id}@wattnexa.invalid`,
        name: 'Deleted account',
        isSuspended: true,
      })
      .where(eq(users.id, user.id));
    await revokeAllSessions(user.id);
    clearAuthCookies(res);
    await auditFromRequest(req, { action: 'auth.account_deleted', resourceType: 'user', resourceId: user.id });
    return ok(res, { deleted: true });
  }),
);
