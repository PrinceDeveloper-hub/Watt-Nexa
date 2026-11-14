import { Router } from 'express';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  alerts,
  automationRules,
  notificationPreferences,
  notifications,
} from '@wattnexa/database';
import { alertThresholdsSchema } from '@wattnexa/shared';
import { requireAuth } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { asyncHandler, created, ok } from '../utils/http';
import { resolveHome } from '../lib/home-scope';
import { newId } from '../utils/crypto';
import { notFound } from '../utils/errors';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit ?? 50) || 50);
    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.userId, req.auth!.userId))
      .orderBy(desc(alerts.createdAt))
      .limit(limit);
    return ok(res, rows);
  }),
);

alertsRouter.post(
  '/:alertId/acknowledge',
  asyncHandler(async (req, res) => {
    await db
      .update(alerts)
      .set({ acknowledgedAt: new Date() })
      .where(and(eq(alerts.id, req.params.alertId as string), eq(alerts.userId, req.auth!.userId)));
    return ok(res, { acknowledged: true });
  }),
);

alertsRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: notifications.id,
        alertId: notifications.alertId,
        title: notifications.title,
        body: notifications.body,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        alertType: alerts.type,
        severity: alerts.severity,
        metadata: alerts.metadata,
        deviceId: alerts.deviceId,
      })
      .from(notifications)
      .leftJoin(alerts, eq(notifications.alertId, alerts.id))
      .where(eq(notifications.userId, req.auth!.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [unreadResult] = await db
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, req.auth!.userId), isNull(notifications.readAt)));
    return ok(res, { items: rows, unread: Number(unreadResult?.unread ?? 0) });
  }),
);

alertsRouter.post(
  '/notifications/:notificationId/read',
  asyncHandler(async (req, res) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, req.params.notificationId as string), eq(notifications.userId, req.auth!.userId)));
    return ok(res, { read: true });
  }),
);

alertsRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, req.auth!.userId), isNull(notifications.readAt)));
    return ok(res, { read: true });
  }),
);

alertsRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, req.auth!.userId))
      .limit(1);
    return ok(res, prefs ?? { userId: req.auth!.userId });
  }),
);

alertsRouter.put(
  '/preferences',
  validate({ body: alertThresholdsSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof alertThresholdsSchema>>(req);
    const values = {
      userId: req.auth!.userId,
      emailEnabled: input.emailEnabled ?? true,
      pushEnabled: input.pushEnabled ?? false,
      powerThresholdW: input.powerW ?? null,
      temperatureThresholdC: input.temperatureC ?? null,
      dailyKwhThreshold: input.dailyKwh ?? null,
      monthlyKwhThreshold: input.monthlyKwh ?? null,
      billThreshold: input.billAmount ?? null,
      updatedAt: new Date(),
    };
    await db
      .insert(notificationPreferences)
      .values(values)
      .onDuplicateKeyUpdate({ set: values });
    return ok(res, values);
  }),
);

const ruleSchema = z.object({
  homeId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  triggerType: z.enum(['power_above', 'temperature_above', 'device_offline', 'daily_summary', 'monthly_usage_above']),
  threshold: z.coerce.number().min(0).nullable().optional(),
  actionType: z.enum(['notify', 'email', 'summary']).default('notify'),
  message: z.string().max(240).optional(),
  isActive: z.boolean().default(true),
});

alertsRouter.get(
  '/automations',
  asyncHandler(async (req, res) => {
    const homeId = await resolveHome(req.query as Record<string, unknown>, req.auth!.userId);
    const rows = await db.select().from(automationRules).where(eq(automationRules.homeId, homeId));
    return ok(res, rows);
  }),
);

alertsRouter.post(
  '/automations',
  validate({ body: ruleSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof ruleSchema>>(req);
    await resolveHome({ homeId: input.homeId }, req.auth!.userId);
    const ruleId = newId();
    await db.insert(automationRules).values({
      id: ruleId,
      homeId: input.homeId,
      userId: req.auth!.userId,
      name: input.name,
      triggerType: input.triggerType,
      threshold: input.threshold ?? null,
      actionType: input.actionType,
      message: input.message,
      isActive: input.isActive,
    });
    return created(res, { id: ruleId });
  }),
);

alertsRouter.patch(
  '/automations/:ruleId',
  validate({ body: ruleSchema.partial().omit({ homeId: true }) }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<Partial<z.infer<typeof ruleSchema>>>(req);
    const [rule] = await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, req.params.ruleId as string), eq(automationRules.userId, req.auth!.userId)))
      .limit(1);
    if (!rule) throw notFound('Automation not found', 'RULE_NOT_FOUND');
    await db.update(automationRules).set(input).where(eq(automationRules.id, rule.id));
    return ok(res, { updated: true });
  }),
);

alertsRouter.delete(
  '/automations/:ruleId',
  asyncHandler(async (req, res) => {
    await db
      .delete(automationRules)
      .where(and(eq(automationRules.id, req.params.ruleId as string), eq(automationRules.userId, req.auth!.userId)));
    return ok(res, { removed: true });
  }),
);
