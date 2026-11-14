import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  db,
  homes,
  subscriptionPlans,
  subscriptions,
  users,
  wattbotConversations,
} from '@wattnexa/database';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { hashPassword } from '../src/lib/password';
import { getWattbotQuota } from '../src/services/wattbot/quota';

const app = createApp();
const suffix = randomUUID().slice(0, 8);

const quotaUserId = randomUUID();
const freeUserId = randomUUID();
const planId = randomUUID();
const homeId = randomUUID();
const freeHomeId = randomUUID();

let quotaCookie = '';
let freeCookie = '';

const ask = (message: string, cookie = quotaCookie) =>
  request(app).post(`/api/v1/wattbot/messages?homeId=${homeId}`).set('Cookie', cookie).send({ message });

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((cookie) => cookie.split(';')[0]).join('; ');
}

async function conversationCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: wattbotConversations.id })
    .from(wattbotConversations)
    .where(eq(wattbotConversations.userId, userId));
  return rows.length;
}

beforeAll(async () => {
  const passwordHash = await hashPassword('WattNexa@123');

  await db.insert(subscriptionPlans).values({
    id: planId,
    slug: `quota-test-${suffix}`,
    name: 'Quota Test',
    description: 'One WattBot message per day',
    priceMonthly: 0,
    maxHomes: 1,
    maxDevices: 1,
    historyDays: 30,
    wattbotMessagesPerDay: 1,
    isActive: true,
    sortOrder: 99,
  });

  await db.insert(users).values([
    {
      id: quotaUserId,
      email: `quota-${suffix}@test.local`,
      passwordHash,
      name: 'Quota User',
      emailVerifiedAt: new Date(),
    },
    {
      id: freeUserId,
      email: `quota-free-${suffix}@test.local`,
      passwordHash,
      name: 'No Plan User',
      emailVerifiedAt: new Date(),
    },
  ]);

  await db.insert(homes).values([
    { id: homeId, ownerId: quotaUserId, name: 'Quota Home' },
    { id: freeHomeId, ownerId: freeUserId, name: 'Free Home' },
  ]);

  await db.insert(subscriptions).values({
    id: randomUUID(),
    userId: quotaUserId,
    planId,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    provider: 'sandbox',
  });

  quotaCookie = await login(`quota-${suffix}@test.local`, 'WattNexa@123');
  freeCookie = await login(`quota-free-${suffix}@test.local`, 'WattNexa@123');
});

afterAll(async () => {
  await db.delete(wattbotConversations).where(eq(wattbotConversations.userId, quotaUserId));
  await db.delete(subscriptions).where(and(eq(subscriptions.userId, quotaUserId), eq(subscriptions.planId, planId)));
  await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
  await db.delete(homes).where(eq(homes.id, homeId));
  await db.delete(homes).where(eq(homes.id, freeHomeId));
  await db.delete(users).where(eq(users.id, quotaUserId));
  await db.delete(users).where(eq(users.id, freeUserId));
  await closeDatabase();
});

describe('wattbot quota', () => {
  it('reports the plan limit and the remaining allowance', async () => {
    const response = await request(app).get('/api/v1/wattbot/status').set('Cookie', quotaCookie).expect(200);

    expect(response.body.data.quota).toMatchObject({
      planSlug: `quota-test-${suffix}`,
      limitPerDay: 1,
      usedToday: 0,
      remainingToday: 1,
      included: true,
    });
    expect(new Date(response.body.data.quota.resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('consumes the allowance and reports the new balance', async () => {
    const response = await ask('How much did I use today?');
    expect(response.status).toBe(201);
    expect(response.body.data.quota).toMatchObject({ usedToday: 1, remainingToday: 0 });
  });

  it('counts questions, not assistant replies', async () => {
    const quota = await getWattbotQuota(quotaUserId);
    expect(quota.usedToday).toBe(1);
  });

  it('rejects the next message with 429 and does not create a conversation', async () => {
    const before = await conversationCount(quotaUserId);
    const response = await ask('And what about this week?');

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('WATTBOT_QUOTA_EXCEEDED');
    expect(response.body.error.details).toMatchObject({ limitPerDay: 1, remainingToday: 0 });
    expect(await conversationCount(quotaUserId)).toBe(before);
  });

  it('blocks the streaming endpoint as well', async () => {
    const response = await request(app)
      .post(`/api/v1/wattbot/messages/stream?homeId=${homeId}`)
      .set('Cookie', quotaCookie)
      .send({ message: 'Streaming past the quota' });

    expect(response.status).toBe(429);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.error.code).toBe('WATTBOT_QUOTA_EXCEEDED');
  });

  it('treats a zero limit as "not in plan" rather than unlimited', async () => {
    await db.update(subscriptionPlans).set({ wattbotMessagesPerDay: 0 }).where(eq(subscriptionPlans.id, planId));

    const response = await ask('Any question');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WATTBOT_NOT_IN_PLAN');
    expect(response.body.error.details.planName).toBe('Quota Test');

    await db.update(subscriptionPlans).set({ wattbotMessagesPerDay: 1 }).where(eq(subscriptionPlans.id, planId));
  });

  it('falls back to the free plan for an account with no subscription', async () => {
    const response = await request(app)
      .post(`/api/v1/wattbot/messages?homeId=${freeHomeId}`)
      .set('Cookie', freeCookie)
      .send({ message: 'How much did I use today?' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WATTBOT_NOT_IN_PLAN');
    expect(response.body.error.details).toMatchObject({ planSlug: 'free', included: false });
  });
});
