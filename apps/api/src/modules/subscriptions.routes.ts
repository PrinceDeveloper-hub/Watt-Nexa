import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, invoices, subscriptionPlans, subscriptions } from '@wattnexa/database';
import { requireAuth } from '../middleware/auth';
import { validate, bodyOf } from '../middleware/validate';
import { asyncHandler, created, ok } from '../utils/http';
import { newId } from '../utils/crypto';
import { badRequest, notFound } from '../utils/errors';
import { auditFromRequest } from '../lib/audit';

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

async function currentSubscription(userId: string) {
  const [row] = await db
    .select({ subscription: subscriptions, plan: subscriptionPlans })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

subscriptionsRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(subscriptionPlans.sortOrder);
    return ok(res, rows);
  }),
);

subscriptionsRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    const row = await currentSubscription(req.auth!.userId);
    if (!row) return ok(res, null);
    return ok(res, {
      ...row.subscription,
      plan: row.plan,
      paymentProvider: 'sandbox',
      sandbox: true,
    });
  }),
);

/**
 * Plan changes are recorded against a sandbox provider. No payment is
 * captured and no invoice is marked paid unless a real gateway is wired in.
 */
subscriptionsRouter.post(
  '/change',
  validate({ body: z.object({ planSlug: z.string().trim().min(1) }) }),
  asyncHandler(async (req, res) => {
    const { planSlug } = bodyOf<{ planSlug: string }>(req);
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.slug, planSlug))
      .limit(1);
    if (!plan) throw notFound('Plan not found', 'PLAN_NOT_FOUND');

    const existing = await currentSubscription(req.auth!.userId);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    if (existing) {
      if (existing.plan.slug === plan.slug) throw badRequest('You are already on this plan');
      await db
        .update(subscriptions)
        .set({ planId: plan.id, currentPeriodStart: now, currentPeriodEnd: periodEnd })
        .where(eq(subscriptions.id, existing.subscription.id));
    } else {
      await db.insert(subscriptions).values({
        id: newId(),
        userId: req.auth!.userId,
        planId: plan.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        provider: 'sandbox',
      });
    }

    let invoiceId: string | null = null;
    if (plan.priceMonthly > 0) {
      invoiceId = newId();
      await db.insert(invoices).values({
        id: invoiceId,
        userId: req.auth!.userId,
        number: `WNX-${Date.now().toString(36).toUpperCase()}`,
        amount: plan.priceMonthly,
        currency: plan.currency,
        // Open, not paid: a sandbox change must not fake a captured payment.
        status: 'open',
        issuedAt: now,
      });
    }

    await auditFromRequest(req, {
      action: 'subscription.plan_changed',
      resourceType: 'subscription_plan',
      resourceId: plan.id,
      metadata: { sandbox: true, invoiceId },
    });

    return created(res, {
      plan: { slug: plan.slug, name: plan.name },
      invoiceId,
      sandbox: true,
      note: 'Sandbox mode: no payment was captured. Configure a payment provider to enable billing.',
    });
  }),
);

subscriptionsRouter.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, req.auth!.userId))
      .orderBy(desc(invoices.issuedAt));
    return ok(res, rows);
  }),
);
