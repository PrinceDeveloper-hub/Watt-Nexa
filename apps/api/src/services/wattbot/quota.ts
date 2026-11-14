import { and, count, desc, eq, gte } from 'drizzle-orm';
import {
  db,
  subscriptionPlans,
  subscriptions,
  wattbotConversations,
  wattbotMessages,
} from '@wattnexa/database';
import { resolveRange } from '@wattnexa/shared';
import { AppError } from '../../utils/errors';

/**
 * WattBot is a paid feature in the plan catalogue: Free = 0 messages/day,
 * Plus = 20, Pro = 100. A limit of 0 therefore means "not included", not
 * "unlimited" — the UI offers an upgrade instead of an empty chat.
 */
export interface WattbotQuota {
  planSlug: string | null;
  planName: string;
  limitPerDay: number;
  usedToday: number;
  remainingToday: number;
  /** Midnight UTC, matching how the rest of the product buckets days. */
  resetAt: string;
  included: boolean;
}

type PlanRow = typeof subscriptionPlans.$inferSelect;

async function planForUser(userId: string): Promise<PlanRow | null> {
  const [active] = await db
    .select({ plan: subscriptionPlans })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  if (active) return active.plan;

  // No subscription on record: fall back to the entry plan, which is what a
  // new account is provisioned with, rather than silently granting Pro.
  const [free] = await db
    .select()
    .from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.slug, 'free'), eq(subscriptionPlans.isActive, true)))
    .limit(1);
  return free ?? null;
}

async function usedToday(userId: string, from: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(wattbotMessages)
    .innerJoin(wattbotConversations, eq(wattbotMessages.conversationId, wattbotConversations.id))
    .where(
      and(
        eq(wattbotConversations.userId, userId),
        // Only questions count; assistant replies are free.
        eq(wattbotMessages.role, 'user'),
        gte(wattbotMessages.createdAt, from),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function getWattbotQuota(userId: string): Promise<WattbotQuota> {
  const day = resolveRange('today');
  const [plan, used] = await Promise.all([planForUser(userId), usedToday(userId, day.from)]);

  const limitPerDay = plan?.wattbotMessagesPerDay ?? 0;
  return {
    planSlug: plan?.slug ?? null,
    planName: plan?.name ?? 'Free',
    limitPerDay,
    usedToday: used,
    remainingToday: Math.max(0, limitPerDay - used),
    resetAt: day.to.toISOString(),
    included: limitPerDay > 0,
  };
}

/**
 * Checked immediately before a conversation turn is created, so a blocked
 * request costs one count query and never calls a paid provider.
 */
export async function assertWattbotQuota(userId: string): Promise<WattbotQuota> {
  const quota = await getWattbotQuota(userId);

  if (!quota.included) {
    throw new AppError(
      403,
      'WATTBOT_NOT_IN_PLAN',
      `WattBot is not included in the ${quota.planName} plan. Upgrade to Plus or Pro to use it.`,
      quota,
    );
  }

  if (quota.remainingToday <= 0) {
    throw new AppError(
      429,
      'WATTBOT_QUOTA_EXCEEDED',
      `You have used all ${quota.limitPerDay} WattBot messages for today. The limit resets at 00:00 UTC.`,
      quota,
    );
  }

  return quota;
}
