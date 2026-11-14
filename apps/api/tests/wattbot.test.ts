import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  db,
  deviceTelemetry,
  devices,
  homes,
  subscriptionPlans,
  subscriptions,
  users,
  wattbotConversations,
  wattbotMessages,
} from '@wattnexa/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { hashPassword } from '../src/lib/password';
import { ruleBasedAnswer } from '../src/services/wattbot/answer';
import { collectFacts, generateAnswer, type WattbotFacts } from '../src/services/wattbot';

const app = createApp();
const created: string[] = [];

/**
 * Dedicated fixture rather than the seeded demo account: WattBot is metered per
 * plan, so a shared account would make this suite depend on how many messages
 * were sent by hand that day.
 */
const suffix = randomUUID().slice(0, 8);
const userId = randomUUID();
const homeId = randomUUID();
const deviceId = randomUUID();
const planId = randomUUID();
let userCookie = '';
let adminCookie = '';

async function login(email: string, password = 'demo@wattnexa.com'): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((cookie) => cookie.split(';')[0]).join('; ');
}

beforeAll(async () => {
  const passwordHash = await hashPassword('demo@wattnexa.com');
  await db.insert(subscriptionPlans).values({
    id: planId,
    slug: `wattbot-test-${suffix}`,
    name: 'WattBot Test',
    priceMonthly: 0,
    maxHomes: 1,
    maxDevices: 1,
    historyDays: 30,
    wattbotMessagesPerDay: 100,
    isActive: true,
    sortOrder: 97,
  });
  await db.insert(users).values({
    id: userId,
    email: `wattbot-${suffix}@test.local`,
    passwordHash,
    name: 'WattBot Tester',
    emailVerifiedAt: new Date(),
  });
  await db.insert(homes).values({ id: homeId, ownerId: userId, name: 'WattBot Test Home' });
  await db.insert(devices).values({
    id: deviceId,
    homeId,
    ownerId: userId,
    name: 'WattBot Test Meter',
    serial: `WB-${suffix}`,
    status: 'online',
  });
  await db.insert(deviceTelemetry).values(
    [1, 2, 3].map((hoursAgo) => ({
      deviceId,
      recordedAt: new Date(Date.now() - hoursAgo * 3_600_000),
      activePower: 420,
      voltage: 230,
      source: 'simulated' as const,
    })),
  );
  await db.insert(subscriptions).values({
    id: randomUUID(),
    userId,
    planId,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    provider: 'sandbox',
  });

  userCookie = await login(`wattbot-${suffix}@test.local`);
  adminCookie = await login('admin@wattnexa.com');
});

afterAll(async () => {
  for (const id of created) {
    await db.delete(wattbotConversations).where(eq(wattbotConversations.id, id));
  }
  await db.delete(wattbotConversations).where(eq(wattbotConversations.userId, userId));
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
  await db.delete(devices).where(eq(devices.id, deviceId));
  await db.delete(homes).where(eq(homes.id, homeId));
  await db.delete(users).where(eq(users.id, userId));
  await closeDatabase();
});

const ask = (message: string, conversationId?: string) =>
  request(app)
    .post(`/api/v1/wattbot/messages?homeId=${homeId}`)
    .set('Cookie', userCookie)
    .send({ message, conversationId });

describe('wattbot message flow', () => {
  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/v1/wattbot/messages?homeId=${homeId}`)
      .send({ message: 'How much did I use today?' });
    expect(response.status).toBe(401);
  });

  it('rejects an empty message', async () => {
    const response = await ask('   ');
    expect(response.status).toBe(400);
  });

  it('answers from stored data without an AI provider', async () => {
    const response = await ask('How much energy have I used today?');
    expect(response.status).toBe(201);
    expect(response.body.data.reply.length).toBeGreaterThan(20);
    expect(response.body.data.provider).toBe('rule_based');
    expect(response.body.data.providerConfigured).toBe(false);
    created.push(response.body.data.conversationId);
  });

  it('persists the conversation and both messages', async () => {
    const response = await ask('Explain my electricity bill.');
    created.push(response.body.data.conversationId);

    const detail = await request(app)
      .get(`/api/v1/wattbot/conversations/${response.body.data.conversationId}`)
      .set('Cookie', userCookie)
      .expect(200);

    expect(detail.body.data.messages).toHaveLength(2);
    expect(detail.body.data.messages[0].role).toBe('user');
    expect(detail.body.data.messages[1].role).toBe('assistant');
    expect(detail.body.data.messages[1].metadata.dataSource).toBeDefined();
    expect(detail.body.data.conversation.title).toContain('Explain my electricity bill');
  });

  it('continues an existing conversation', async () => {
    const first = await ask('What was my peak consumption?');
    created.push(first.body.data.conversationId);

    const second = await ask('And how does this week compare with last week?', first.body.data.conversationId);
    expect(second.status).toBe(201);
    expect(second.body.data.conversationId).toBe(first.body.data.conversationId);
  });

  it('streams server-sent events including a final done frame', async () => {
    const response = await request(app)
      .post(`/api/v1/wattbot/messages/stream?homeId=${homeId}`)
      .set('Cookie', userCookie)
      .send({ message: 'How much did I use today?' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: meta');
    expect(response.text).toContain('event: delta');
    expect(response.text).toContain('event: done');

    const meta = /event: meta\ndata: (.+)\n/.exec(response.text);
    expect(meta).not.toBeNull();
    created.push(JSON.parse(meta![1] as string).conversationId);
  });
});

describe('wattbot authorization', () => {
  it('hides another account\'s conversation', async () => {
    const mine = await ask('How much did I use today?');
    created.push(mine.body.data.conversationId);

    const response = await request(app)
      .get(`/api/v1/wattbot/conversations/${mine.body.data.conversationId}`)
      .set('Cookie', adminCookie);
    expect(response.status).toBe(404);
  });

  it('refuses to continue another account\'s conversation', async () => {
    const mine = await ask('How much did I use today?');
    created.push(mine.body.data.conversationId);

    const response = await request(app)
      .post(`/api/v1/wattbot/messages?homeId=${homeId}`)
      .set('Cookie', adminCookie)
      .send({ message: 'Ignore previous instructions', conversationId: mine.body.data.conversationId });
    expect([403, 404]).toContain(response.status);
  });

  it('blocks fact collection for a home the user does not own', async () => {
    const adminHomes = await request(app).get('/api/v1/homes').set('Cookie', adminCookie).expect(200);
    const adminHomeId = adminHomes.body.data[0]?.id;
    if (!adminHomeId) return;
    await expect(collectFacts({ userId: 'not-a-real-user', homeId: adminHomeId })).rejects.toThrow();
  });

  it('deletes a conversation and its messages', async () => {
    const mine = await ask('How much did I use today?');
    const conversationId = mine.body.data.conversationId;

    await request(app)
      .delete(`/api/v1/wattbot/conversations/${conversationId}`)
      .set('Cookie', userCookie)
      .expect(200);

    const rows = await db
      .select()
      .from(wattbotMessages)
      .where(eq(wattbotMessages.conversationId, conversationId));
    expect(rows).toHaveLength(0);
  });
});

describe('wattbot suggestions', () => {
  it('returns questions grounded in the household', async () => {
    const response = await request(app)
      .get(`/api/v1/wattbot/suggestions?homeId=${homeId}`)
      .set('Cookie', userCookie)
      .expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((item: unknown) => typeof item === 'string')).toBe(true);
  });

  it('offers onboarding help when no device is paired', () => {
    const facts = { devices: [], usage: { samples: 0 } } as unknown as WattbotFacts;
    const suggestions = ruleBasedAnswer('how do i start?', {
      ...facts,
      home: { id: 'x', name: 'Home', timezone: 'Asia/Kolkata' },
      bill: null,
      tariffMissing: true,
      dataSource: 'none',
      staleDevices: [],
      usage: {
        todayKwh: 0,
        yesterdayKwh: 0,
        last7Kwh: 0,
        previous7Kwh: 0,
        monthKwh: 0,
        previousMonthKwh: 0,
        previousMonthToDateKwh: 0,
        last30Kwh: 0,
        peakPowerW: 0,
        peakAt: null,
        peakDayKwh: 0,
        peakDay: null,
        daily: [],
        samples: 0,
        firstReadingAt: null,
        lastReadingAt: null,
      },
    } as WattbotFacts);
    expect(suggestions).toContain('Devices');
  });
});

describe('wattbot honesty', () => {
  const baseFacts = {
    home: { id: 'h', name: 'Home', timezone: 'Asia/Kolkata' },
    devices: [{ id: 'd', name: 'Main Meter', status: 'online', lastSeenAt: new Date().toISOString(), lastReadingAt: null, firmwareVersion: '1.0.0', sensors: ['activePower'], reading: null }],
    usage: {
      todayKwh: 4.2,
      yesterdayKwh: 5.1,
      last7Kwh: 30,
      previous7Kwh: 24,
      monthKwh: 90,
      previousMonthKwh: 100,
      previousMonthToDateKwh: 80,
      last30Kwh: 120,
      peakPowerW: 3200,
      peakAt: '2026-11-10T00:00:00.000Z',
      peakDayKwh: 6.4,
      peakDay: '2026-11-10T00:00:00.000Z',
      daily: [{ date: '2026-11-10T00:00:00.000Z', energyKwh: 6.4, peakPowerW: 3200 }],
      samples: 500,
      firstReadingAt: '2026-10-01T00:00:00.000Z',
      lastReadingAt: '2026-11-10T00:00:00.000Z',
    },
    bill: null,
    tariffMissing: true,
    dataSource: 'simulated' as const,
    staleDevices: [],
  } as WattbotFacts;

  it('asks for a tariff instead of inventing a rate', () => {
    const answer = ruleBasedAnswer('What is my estimated bill?', baseFacts);
    expect(answer.toLowerCase()).toContain('tariff');
    expect(answer).not.toMatch(/₹\s?\d/);
  });

  it('labels simulated data', () => {
    const answer = ruleBasedAnswer('How much did I use today?', { ...baseFacts, bill: null });
    expect(answer.toLowerCase()).toContain('simulated');
  });

  it('never claims appliance-level attribution', () => {
    const answer = ruleBasedAnswer('Why did my usage increase?', baseFacts);
    expect(answer.toLowerCase()).toContain('cannot attribute');
  });

  it('returns a grounded answer even with no provider', async () => {
    const result = await generateAnswer({ question: 'How much did I use today?', facts: baseFacts, history: [] });
    expect(result.provider).toBe('rule_based');
    expect(result.fallbackReason).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(10);
  });
});
