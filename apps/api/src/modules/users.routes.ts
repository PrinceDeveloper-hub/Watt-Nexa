import { Router } from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, householdMembers, users } from '@wattnexa/database';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ok } from '../utils/http';
import { accessibleHomeIds } from '../lib/ownership';
import { notFound } from '../utils/errors';

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** People the caller shares at least one household with. */
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const homeIds = await accessibleHomeIds(req.auth!.userId);
    if (homeIds.length === 0) return ok(res, []);
    const members = await db
      .select({
        homeId: householdMembers.homeId,
        role: householdMembers.role,
        status: householdMembers.status,
        userId: householdMembers.userId,
        invitedEmail: householdMembers.invitedEmail,
      })
      .from(householdMembers)
      .where(inArray(householdMembers.homeId, homeIds));

    const userIds = members.map((m) => m.userId).filter((id): id is string => Boolean(id));
    const profiles = userIds.length
      ? await db
          .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
          .from(users)
          .where(and(inArray(users.id, userIds), isNull(users.deletedAt)))
      : [];

    return ok(
      res,
      members.map((member) => ({
        homeId: member.homeId,
        role: member.role,
        status: member.status,
        profile: profiles.find((profile) => profile.id === member.userId) ?? null,
        invitedEmail: member.invitedEmail,
      })),
    );
  }),
);

usersRouter.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const homeIds = await accessibleHomeIds(req.auth!.userId);
    const [membership] = homeIds.length
      ? await db
          .select({ id: householdMembers.id })
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.userId, req.params.userId as string),
              inArray(householdMembers.homeId, homeIds),
            ),
          )
          .limit(1)
      : [];
    if (!membership && req.params.userId !== req.auth!.userId) {
      throw notFound('User not found', 'USER_NOT_FOUND');
    }
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.params.userId as string))
      .limit(1);
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    return ok(res, user);
  }),
);
