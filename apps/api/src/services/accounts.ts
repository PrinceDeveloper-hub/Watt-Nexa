import {
  db,
  homes,
  householdMembers,
  notificationPreferences,
  subscriptionPlans,
  subscriptions,
} from '@wattnexa/database';
import { eq } from 'drizzle-orm';
import { newId } from '../utils/crypto';
import { logger } from '../lib/logger';

/**
 * A brand-new account should land on a usable dashboard rather than an
 * undefined state: one home, default alert preferences and the free plan.
 */
export async function provisionNewAccount(userId: string, displayName: string): Promise<void> {
  const homeId = newId();
  await db.insert(homes).values({
    id: homeId,
    ownerId: userId,
    name: 'My Home',
    type: 'home',
    country: 'India',
    timezone: 'Asia/Kolkata',
  });
  await db.insert(householdMembers).values({
    id: newId(),
    homeId,
    userId,
    role: 'owner',
    status: 'active',
  });
  await db.insert(notificationPreferences).values({ userId }).onDuplicateKeyUpdate({
    set: { updatedAt: new Date() },
  });

  const [freePlan] = await db
    .select({ id: subscriptionPlans.id, price: subscriptionPlans.priceMonthly })
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.slug, 'free'))
    .limit(1);

  if (!freePlan) {
    logger.warn('Free plan missing — run the seed script so new accounts get a plan');
    return;
  }

  const start = new Date();
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  await db.insert(subscriptions).values({
    id: newId(),
    userId,
    planId: freePlan.id,
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    provider: 'sandbox',
  });

  logger.debug({ userId, homeId, displayName }, 'Provisioned new account');
}
