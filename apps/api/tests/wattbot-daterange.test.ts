import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  db,
  devices,
  deviceTelemetry,
  homes,
  subscriptionPlans,
  subscriptions,
  users,
  wattbotConversations,
} from '@wattnexa/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { hashPassword } from '../src/lib/password';
import { parseDateRange } from '../src/services/wattbot/daterange';
import { collectFacts } from '../src/services/wattbot/tools';
import { ruleBasedAnswer } from '../src/services/wattbot/answer';

const app = createApp();
const NOW = new Date('2026-11-14T10:00:00Z');
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('date range parser', () => {
  it('reads an ISO range', () => {
    const parsed = parseDateRange('How much did I use between 2026-11-01 and 2026-11-07?', NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(iso(parsed.from)).toBe('2026-11-01');
    expect(iso(parsed.to)).toBe('2026-11-08');
  });

  it('reads month names without a year', () => {
    const parsed = parseDateRange('usage from march 1 to march 7', NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(iso(parsed.from)).toBe('2026-03-01');
    expect(iso(parsed.to)).toBe('2026-03-08');
  });

  it('reads a whole month', () => {
    const parsed = parseDateRange('March 2026 total', NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(iso(parsed.from)).toBe('2026-03-01');
    expect(iso(parsed.to)).toBe('2026-04-01');
  });

  it('reads a single day', () => {
    const parsed = parseDateRange('what did I use on 2026-11-08?', NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(iso(parsed.from)).toBe('2026-11-08');
    expect(iso(parsed.to)).toBe('2026-11-09');
  });

  it('reads a day span inside one month', () => {
    const parsed = parseDateRange('compare 1-7 march', NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(iso(parsed.from)).toBe('2026-03-01');
    expect(iso(parsed.to)).toBe('2026-03-08');
  });

  it('rejects a reversed range', () => {
    expect(parseDateRange('between 2026-11-07 and 2026-11-01', NOW).status).toBe('invalid');
  });

  it('rejects a range longer than a year', () => {
    expect(parseDateRange('between 2020-01-01 and 2022-01-01', NOW).status).toBe('too_long');
  });

  it('returns nothing when no dates are named', () => {
    expect(parseDateRange('How much did I use today?', NOW).status).toBe('none');
    expect(parseDateRange('What is my bill?', NOW).status).toBe('none');
  });

  it('rolls the year forward across new year', () => {
    const parsed = parseDateRange('dec 20 to jan 5', NOW);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(iso(parsed.from)).toBe('2025-12-20');
    expect(iso(parsed.to)).toBe('2026-01-06');
  });
});

describe('custom range end to end', () => {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const homeId = randomUUID();
  const deviceId = randomUUID();
  const planId = randomUUID();
  let cookie = '';

  // Fixed window with readings, three days long, well inside the seed range.
  const start = new Date(Date.UTC(2026, 10, 1));
  const end = new Date(Date.UTC(2026, 10, 4));

  beforeAll(async () => {
    await db.insert(subscriptionPlans).values({
      id: planId,
      slug: `range-test-${suffix}`,
      name: 'Range Test',
      priceMonthly: 0,
      maxHomes: 1,
      maxDevices: 1,
      historyDays: 365,
      wattbotMessagesPerDay: 100,
      isActive: true,
      sortOrder: 98,
    });

    await db.insert(users).values({
      id: userId,
      email: `range-${suffix}@test.local`,
      passwordHash: await hashPassword('WattNexa@123'),
      name: 'Range User',
      emailVerifiedAt: new Date(),
    });
    await db.insert(homes).values({ id: homeId, ownerId: userId, name: 'Range Home' });
    await db.insert(subscriptions).values({
      id: randomUUID(),
      userId,
      planId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      provider: 'sandbox',
    });
    await db.insert(devices).values({
      id: deviceId,
      homeId,
      ownerId: userId,
      name: 'Range Meter',
      serial: `RANGE-${suffix}`,
      status: 'online',
    });

    await db.insert(deviceTelemetry).values(
      [0, 1, 2].map((dayOffset) => ({
        deviceId,
        recordedAt: new Date(start.getTime() + dayOffset * 86_400_000 + 3 * 3_600_000),
        activePower: 1000,
        source: 'hardware' as const,
      })),
    );

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `range-${suffix}@test.local`, password: 'WattNexa@123' })
      .expect(200);
    const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
    cookie = (raw ?? []).map((value) => value.split(';')[0]).join('; ');
  });

  afterAll(async () => {
    await db.delete(wattbotConversations).where(eq(wattbotConversations.userId, userId));
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
    await db.delete(devices).where(eq(devices.id, deviceId));
    await db.delete(homes).where(eq(homes.id, homeId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDatabase();
  });

  it('collects totals for an arbitrary window', async () => {
    const parsed = parseDateRange('between 2026-11-01 and 2026-11-03', NOW);
    const facts = await collectFacts({ userId, homeId }, { customRange: parsed });

    expect(facts.custom).toBeDefined();
    if (!facts.custom || !facts.custom.ok) throw new Error('expected a valid custom range');
    expect(facts.custom.samples).toBe(3);
    expect(facts.custom.days).toBe(3);
    expect(facts.custom.energyKwh).toBeGreaterThan(0);
  });

  it('reports no data instead of 0 kWh for an empty window', async () => {
    const parsed = parseDateRange('between 2024-01-01 and 2024-01-05', NOW);
    const facts = await collectFacts({ userId, homeId }, { customRange: parsed });
    expect(facts.custom?.ok).toBe(true);

    const answer = ruleBasedAnswer('between 2024-01-01 and 2024-01-05', facts);
    expect(answer).toContain('No readings are stored');
  });

  it('answers a custom range through the API', async () => {
    const response = await request(app)
      .post(`/api/v1/wattbot/messages?homeId=${homeId}`)
      .set('Cookie', cookie)
      .send({ message: 'How much electricity did I use between 2026-11-01 and 2026-11-03?' })
      .expect(201);

    expect(response.body.data.reply).toContain('2026-11-01');
    expect(response.body.data.reply).toContain('kWh');
    expect(response.body.data.reply).toMatch(/Between/);
  });

  it('explains an over-long range instead of guessing', async () => {
    const answer = ruleBasedAnswer(
      'between 2020-01-01 and 2022-01-01',
      await collectFacts(
        { userId, homeId },
        { customRange: parseDateRange('between 2020-01-01 and 2022-01-01', NOW) },
      ),
    );
    expect(answer).toContain('366 days');
  });
});
