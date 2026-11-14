import { Router } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, devices, wattbotConversations, wattbotMessages } from '@wattnexa/database';
import { resolveRange, wattbotMessageSchema } from '@wattnexa/shared';
import type { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { asyncHandler, created, ok } from '../utils/http';
import { resolveHome } from '../lib/home-scope';
import { accessibleDevices } from '../lib/ownership';
import { activeTariff, buildInsights, energySeries, energyTotal, estimateBill } from '../services/energy';
import { latestReading } from '../services/telemetry';
import { askWattbot, type WattbotContext } from '../services/wattbot';
import { newId } from '../utils/crypto';
import { notFound } from '../utils/errors';
import { env } from '../config';

export const wattbotRouter = Router();
wattbotRouter.use(requireAuth);

async function buildContext(userId: string, userName: string, homeId: string): Promise<WattbotContext> {
  const deviceRows = await accessibleDevices(userId, homeId);
  const ids = deviceRows.map((d) => d.id);
  const now = new Date();
  const today = resolveRange('today');
  const month = resolveRange('this_month');
  const previousMonth = resolveRange('previous_month');
  const week = resolveRange('last_7_days');

  const [todayKwh, monthKwh, previousMonthKwh, series, bill, tariff] = await Promise.all([
    energyTotal(ids, today.from, now),
    energyTotal(ids, month.from, now),
    energyTotal(ids, previousMonth.from, previousMonth.to),
    energySeries(ids, week.from, week.to, 'day'),
    estimateBill(homeId, ids, month.from, now, now),
    activeTariff(homeId),
  ]);

  const peakPowerW = series.reduce((max, point) => Math.max(max, point.peakPowerW), 0);
  const insights = buildInsights({
    currentKwh: series.reduce((sum, p) => sum + p.energyKwh, 0),
    previousKwh: previousMonthKwh,
    peakPowerW,
    baseLoadW: series.length ? Math.min(...series.map((p) => p.averagePowerW).filter((p) => p > 0)) || 0 : 0,
    dailyThresholdKwh: null,
  });

  const device = deviceRows[0];
  const reading = device ? await latestReading(device.id) : null;

  return {
    userName,
    todayKwh,
    monthKwh,
    previousMonthKwh,
    peakPowerW,
    monthToDateCost: bill.breakdown.total,
    projectedMonthlyCost: bill.projection.projectedTotal,
    currency: tariff?.currency ?? 'INR',
    tariffName: tariff?.name ?? null,
    deviceName: device?.name ?? null,
    deviceStatus: device?.status ?? null,
    topInsight: insights[0] ? `${insights[0].title}: ${insights[0].description}` : null,
    simulated: reading?.source === 'simulated',
  };
}

wattbotRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(wattbotConversations)
      .where(eq(wattbotConversations.userId, req.auth!.userId))
      .orderBy(desc(wattbotConversations.updatedAt));
    return ok(res, rows);
  }),
);

wattbotRouter.get(
  '/conversations/:conversationId',
  asyncHandler(async (req, res) => {
    const [conversation] = await db
      .select()
      .from(wattbotConversations)
      .where(
        and(
          eq(wattbotConversations.id, req.params.conversationId as string),
          eq(wattbotConversations.userId, req.auth!.userId),
        ),
      )
      .limit(1);
    if (!conversation) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    const messages = await db
      .select()
      .from(wattbotMessages)
      .where(eq(wattbotMessages.conversationId, conversation.id))
      .orderBy(asc(wattbotMessages.createdAt));
    return ok(res, { conversation, messages });
  }),
);

wattbotRouter.post(
  '/messages',
  validate({ body: wattbotMessageSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof wattbotMessageSchema>>(req);
    const userId = req.auth!.userId;
    const homeId = await resolveHome(req.query as Record<string, unknown>, userId);

    let conversationId = input.conversationId;
    if (conversationId) {
      const [existing] = await db
        .select({ id: wattbotConversations.id })
        .from(wattbotConversations)
        .where(and(eq(wattbotConversations.id, conversationId), eq(wattbotConversations.userId, userId)))
        .limit(1);
      if (!existing) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    } else {
      conversationId = newId();
      await db.insert(wattbotConversations).values({
        id: conversationId,
        userId,
        title: input.message.slice(0, 70),
      });
    }

    const history = await db
      .select({ role: wattbotMessages.role, content: wattbotMessages.content })
      .from(wattbotMessages)
      .where(eq(wattbotMessages.conversationId, conversationId))
      .orderBy(asc(wattbotMessages.createdAt));

    const [userRecord] = await db
      .select({ name: devices.name })
      .from(devices)
      .where(eq(devices.ownerId, userId))
      .limit(1);

    const context = await buildContext(userId, userRecord?.name ?? 'there', homeId);
    const reply = await askWattbot(input.message, context, history);

    await db.insert(wattbotMessages).values([
      { id: newId(), conversationId, role: 'user', content: input.message, provider: 'rule_based' },
      { id: newId(), conversationId, role: 'assistant', content: reply.content, provider: reply.provider },
    ]);
    await db
      .update(wattbotConversations)
      .set({ updatedAt: new Date() })
      .where(eq(wattbotConversations.id, conversationId));

    return created(res, {
      conversationId,
      reply: reply.content,
      provider: reply.provider,
      providerConfigured: env.WATTBOT_PROVIDER !== 'none',
      context: {
        todayKwh: context.todayKwh,
        monthKwh: context.monthKwh,
        simulated: context.simulated,
      },
    });
  }),
);

wattbotRouter.delete(
  '/conversations/:conversationId',
  asyncHandler(async (req, res) => {
    await db
      .delete(wattbotConversations)
      .where(
        and(
          eq(wattbotConversations.id, req.params.conversationId as string),
          eq(wattbotConversations.userId, req.auth!.userId),
        ),
      );
    return ok(res, { cleared: true });
  }),
);

wattbotRouter.get(
  '/suggestions',
  asyncHandler(async (_req, res) =>
    ok(res, [
      'Why is my electricity bill increasing?',
      'How much electricity did I use today?',
      'What was my peak consumption this week?',
      'Compare this month with last month.',
      'How can I reduce my electricity expenses?',
    ]),
  ),
);
