import { Router } from 'express';
import { and, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  alerts,
  auditLogs,
  db,
  devices,
  energyAggregates,
  homes,
  subscriptionPlans,
  subscriptions,
  users,
} from '@wattnexa/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { ADMIN_ROLES } from '../config';
import { asyncHandler, ok, paginated, parsePagination } from '../utils/http';
import { notFound } from '../utils/errors';
import { recordAudit } from '../lib/audit';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(...ADMIN_ROLES));

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [[userCount], [deviceCount], [homeCount], [alertCount]] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(devices),
      db.select({ value: count() }).from(homes),
      db.select({ value: count() }).from(alerts),
    ]);

    const statusRows = await db
      .select({ status: devices.status, value: count() })
      .from(devices)
      .groupBy(devices.status);

    const planRows = await db
      .select({ plan: subscriptionPlans.name, value: count() })
      .from(subscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
      .groupBy(subscriptionPlans.name);

    const [energyRow] = await db
      .select({ total: sql<number>`COALESCE(SUM(${energyAggregates.energyKwh}), 0)` })
      .from(energyAggregates)
      .where(eq(energyAggregates.bucket, 'day'));

    const recent = await db
      .select({ id: alerts.id, title: alerts.title, severity: alerts.severity, createdAt: alerts.createdAt })
      .from(alerts)
      .orderBy(desc(alerts.createdAt))
      .limit(8);

    return ok(res, {
      users: userCount?.value ?? 0,
      devices: deviceCount?.value ?? 0,
      homes: homeCount?.value ?? 0,
      alerts: alertCount?.value ?? 0,
      deviceStatus: statusRows.map((row) => ({ status: row.status, count: row.value })),
      planDistribution: planRows.map((row) => ({ plan: row.plan, count: row.value })),
      monitoredEnergyKwh: Number(energyRow?.total ?? 0),
      recentAlerts: recent,
    });
  }),
);

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const p = parsePagination(req.query as Record<string, unknown>);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const where = search
      ? or(like(users.email, `%${search}%`), like(users.name, `%${search}%`))
      : undefined;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isSuspended: users.isSuspended,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(p.limit)
      .offset(p.offset);

    const [total] = await db.select({ value: count() }).from(users).where(where);
    return ok(res, paginated(rows, total?.value ?? 0, p));
  }),
);

adminRouter.patch(
  '/users/:userId',
  validate({
    body: z.object({
      role: z.enum(['user', 'admin', 'super_admin', 'support_agent']).optional(),
      isSuspended: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<{ role?: 'user' | 'admin' | 'super_admin' | 'support_agent'; isSuspended?: boolean }>(req);
    const userId = req.params.userId as string;

    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw notFound('User not found', 'USER_NOT_FOUND');
    if (target.role === 'super_admin' && req.auth!.role !== 'super_admin') {
      throw notFound('User not found', 'USER_NOT_FOUND');
    }

    await db.update(users).set(input).where(eq(users.id, userId));
    await recordAudit({
      actorId: req.auth!.userId,
      action: input.role ? 'admin.role_changed' : 'admin.suspension_changed',
      resourceType: 'user',
      resourceId: userId,
      metadata: input,
      ipAddress: req.ip,
    });
    return ok(res, { updated: true });
  }),
);

adminRouter.get(
  '/devices',
  asyncHandler(async (req, res) => {
    const p = parsePagination(req.query as Record<string, unknown>);
    const rows = await db
      .select({
        id: devices.id,
        name: devices.name,
        serial: devices.serial,
        status: devices.status,
        firmwareVersion: devices.firmwareVersion,
        lastSeenAt: devices.lastSeenAt,
        ownerId: devices.ownerId,
      })
      .from(devices)
      .orderBy(desc(devices.createdAt))
      .limit(p.limit)
      .offset(p.offset);
    const [total] = await db.select({ value: count() }).from(devices);
    return ok(res, paginated(rows, total?.value ?? 0, p));
  }),
);

adminRouter.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const p = parsePagination(req.query as Record<string, unknown>);
    const rows = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(p.limit)
      .offset(p.offset);
    const [total] = await db.select({ value: count() }).from(auditLogs);
    return ok(res, paginated(rows, total?.value ?? 0, p));
  }),
);

adminRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder);
    return ok(res, rows);
  }),
);

adminRouter.patch(
  '/plans/:planId',
  validate({
    body: z.object({
      priceMonthly: z.coerce.number().min(0).optional(),
      maxHomes: z.coerce.number().int().min(1).optional(),
      maxDevices: z.coerce.number().int().min(1).optional(),
      historyDays: z.coerce.number().int().min(1).optional(),
      wattbotMessagesPerDay: z.coerce.number().int().min(0).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<Record<string, unknown>>(req);
    await db.update(subscriptionPlans).set(input).where(eq(subscriptionPlans.id, req.params.planId as string));
    await recordAudit({
      actorId: req.auth!.userId,
      action: 'admin.plan_updated',
      resourceType: 'subscription_plan',
      resourceId: req.params.planId as string,
      metadata: input,
      ipAddress: req.ip,
    });
    return ok(res, { updated: true });
  }),
);

adminRouter.get(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId as string;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
    const userHomes = await db.select().from(homes).where(and(eq(homes.ownerId, userId)));
    const userDevices = await db.select().from(devices).where(eq(devices.ownerId, userId));
    const { passwordHash: _omit, ...safe } = user;
    return ok(res, { ...safe, homes: userHomes, devices: userDevices });
  }),
);
