import { Router } from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, devices, homes, householdMembers } from '@wattnexa/database';
import { homeSchema } from '@wattnexa/shared';
import { requireAuth } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { asyncHandler, created, ok } from '../utils/http';
import { accessibleHomeIds, requireHomeAccess } from '../lib/ownership';
import { newId } from '../utils/crypto';
import { badRequest, forbidden } from '../utils/errors';
import { auditFromRequest } from '../lib/audit';

export const homesRouter = Router();
homesRouter.use(requireAuth);

homesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const ids = await accessibleHomeIds(req.auth!.userId);
    if (ids.length === 0) return ok(res, []);
    const rows = await db
      .select()
      .from(homes)
      .where(and(inArray(homes.id, ids), isNull(homes.deletedAt)));
    const deviceRows = await db
      .select({ id: devices.id, homeId: devices.homeId, name: devices.name, status: devices.status })
      .from(devices)
      .where(and(inArray(devices.homeId, ids), isNull(devices.deletedAt)));
    return ok(
      res,
      rows.map((home) => ({
        ...home,
        devices: deviceRows.filter((device) => device.homeId === home.id),
      })),
    );
  }),
);

homesRouter.post(
  '/',
  validate({ body: homeSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof homeSchema>>(req);
    const homeId = newId();
    await db.insert(homes).values({ id: homeId, ownerId: req.auth!.userId, ...input });
    await db.insert(householdMembers).values({
      id: newId(),
      homeId,
      userId: req.auth!.userId,
      role: 'owner',
      status: 'active',
    });
    await auditFromRequest(req, { action: 'home.created', resourceType: 'home', resourceId: homeId });
    const [home] = await db.select().from(homes).where(eq(homes.id, homeId)).limit(1);
    return created(res, home);
  }),
);

homesRouter.get(
  '/:homeId',
  asyncHandler(async (req, res) => {
    const home = await requireHomeAccess(req.auth!.userId, req.params.homeId as string);
    const members = await db.select().from(householdMembers).where(eq(householdMembers.homeId, home.id));
    const deviceRows = await db
      .select({ id: devices.id, name: devices.name, status: devices.status, room: devices.room })
      .from(devices)
      .where(and(eq(devices.homeId, home.id), isNull(devices.deletedAt)));
    return ok(res, { ...home, members, devices: deviceRows });
  }),
);

homesRouter.patch(
  '/:homeId',
  validate({ body: homeSchema.partial() }),
  asyncHandler(async (req, res) => {
    const home = await requireHomeAccess(req.auth!.userId, req.params.homeId as string);
    if (home.ownerId !== req.auth!.userId) throw forbidden('Only the owner can edit this household');
    const input = bodyOf<Partial<z.infer<typeof homeSchema>>>(req);
    if (Object.keys(input).length === 0) throw badRequest('Nothing to update');
    await db.update(homes).set(input).where(eq(homes.id, home.id));
    const [updated] = await db.select().from(homes).where(eq(homes.id, home.id)).limit(1);
    return ok(res, updated);
  }),
);

homesRouter.delete(
  '/:homeId',
  asyncHandler(async (req, res) => {
    const home = await requireHomeAccess(req.auth!.userId, req.params.homeId as string);
    if (home.ownerId !== req.auth!.userId) throw forbidden('Only the owner can remove this household');
    const all = await accessibleHomeIds(req.auth!.userId);
    if (all.length <= 1) throw badRequest('Keep at least one household on the account');
    await db.update(homes).set({ deletedAt: new Date() }).where(eq(homes.id, home.id));
    await auditFromRequest(req, { action: 'home.deleted', resourceType: 'home', resourceId: home.id });
    return ok(res, { removed: true });
  }),
);

homesRouter.post(
  '/:homeId/members',
  validate({ body: z.object({ email: z.string().email(), role: z.enum(['admin', 'viewer']).default('viewer') }) }),
  asyncHandler(async (req, res) => {
    const home = await requireHomeAccess(req.auth!.userId, req.params.homeId as string);
    if (home.ownerId !== req.auth!.userId) throw forbidden('Only the owner can invite members');
    const input = bodyOf<{ email: string; role: 'admin' | 'viewer' }>(req);
    const memberId = newId();
    await db.insert(householdMembers).values({
      id: memberId,
      homeId: home.id,
      invitedEmail: input.email.toLowerCase(),
      role: input.role,
      status: 'invited',
    });
    return created(res, { id: memberId, email: input.email, role: input.role, status: 'invited' });
  }),
);
