import { Router } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { db, users, wattbotConversations, wattbotMessages } from '@wattnexa/database';
import { wattbotMessageSchema } from '@wattnexa/shared';
import type { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { wattbotLimiter } from '../middleware/rate-limit';
import { asyncHandler, created, ok } from '../utils/http';
import { resolveHome } from '../lib/home-scope';
import { newId } from '../utils/crypto';
import { notFound } from '../utils/errors';
import { logger } from '../lib/logger';
import {
  collectFacts,
  dailySeriesForScope,
  generateAnswer,
  providerStatus,
  type WattbotFacts,
} from '../services/wattbot';
import { assertWattbotQuota, getWattbotQuota, type WattbotQuota } from '../services/wattbot/quota';
import { parseDateRange } from '../services/wattbot/daterange';

export const wattbotRouter = Router();
wattbotRouter.use(requireAuth);

const HISTORY_LIMIT = 200;

async function userName(userId: string): Promise<string> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name?.split(' ')[0] ?? 'there';
}

/** Contextual starter questions, derived from what the household actually has. */
export function buildSuggestions(facts: WattbotFacts): string[] {
  if (facts.devices.length === 0) {
    return [
      'How do I connect my first device?',
      'What hardware do I need to measure my home?',
      'What will WattNexa be able to tell me?',
    ];
  }
  if (facts.usage.samples === 0) {
    return [
      'My device is paired but not reporting — what should I check?',
      'Which measurements does my device support?',
    ];
  }
  if (facts.tariffMissing) {
    return [
      'How do I set up my electricity tariff?',
      'How much energy have I used today?',
      'What was my peak consumption this week?',
    ];
  }

  const questions: string[] = ['How much energy have I used today?', 'Explain my estimated electricity bill.'];
  if (facts.usage.peakDay) {
    questions.push(`Why did I use ${facts.usage.peakDayKwh.toFixed(1)} kWh on ${facts.usage.peakDay.slice(5, 10)}?`);
  }
  if (facts.usage.previous7Kwh > 0) questions.push('Compare this week with last week.');
  if (facts.staleDevices.length) questions.push('Why is my device offline?');
  questions.push('What can I do to reduce my consumption?');
  return questions.slice(0, 5);
}

async function assertConversation(userId: string, conversationId: string) {
  const [row] = await db
    .select()
    .from(wattbotConversations)
    .where(and(eq(wattbotConversations.id, conversationId), eq(wattbotConversations.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
  return row;
}

wattbotRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: wattbotConversations.id,
        title: wattbotConversations.title,
        createdAt: wattbotConversations.createdAt,
        updatedAt: wattbotConversations.updatedAt,
      })
      .from(wattbotConversations)
      .where(eq(wattbotConversations.userId, req.auth!.userId))
      .orderBy(desc(wattbotConversations.updatedAt))
      .limit(50);
    return ok(res, rows);
  }),
);

wattbotRouter.get(
  '/conversations/:conversationId',
  asyncHandler(async (req, res) => {
    const conversation = await assertConversation(req.auth!.userId, req.params.conversationId as string);
    const limit = Math.min(Number(req.query.limit ?? HISTORY_LIMIT) || HISTORY_LIMIT, HISTORY_LIMIT);
    const rows = await db
      .select()
      .from(wattbotMessages)
      .where(eq(wattbotMessages.conversationId, conversation.id))
      .orderBy(asc(wattbotMessages.createdAt))
      .limit(limit);
    return ok(res, { conversation, messages: rows });
  }),
);

wattbotRouter.delete(
  '/conversations/:conversationId',
  asyncHandler(async (req, res) => {
    const conversation = await assertConversation(req.auth!.userId, req.params.conversationId as string);
    await db.delete(wattbotConversations).where(eq(wattbotConversations.id, conversation.id));
    return ok(res, { cleared: true });
  }),
);

wattbotRouter.get(
  '/status',
  asyncHandler(async (req, res) =>
    ok(res, { ...providerStatus(), quota: await getWattbotQuota(req.auth!.userId) }),
  ),
);

wattbotRouter.get(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const homeId = await resolveHome(req.query as Record<string, unknown>, userId);
    const facts = await collectFacts({ userId, homeId });
    return ok(res, buildSuggestions(facts));
  }),
);

/** Daily series for the small in-chat chart. Same scoping as everything else. */
wattbotRouter.get(
  '/series',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const homeId = await resolveHome(req.query as Record<string, unknown>, userId);
    const days = req.query.days === '30' ? 30 : 7;
    return ok(res, await dailySeriesForScope({ userId, homeId }, days));
  }),
);

interface PreparedTurn {
  conversationId: string;
  facts: WattbotFacts;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  quota: WattbotQuota;
}

/**
 * Shared turn setup: ownership, history window, facts. Runs before any SSE
 * headers so a failure can still be a normal JSON error.
 */
async function prepareTurn(
  req: Request,
  message: string,
  requestedConversationId?: string,
): Promise<PreparedTurn> {
  const userId = req.auth!.userId;
  const homeId = await resolveHome(req.query as Record<string, unknown>, userId);

  // Rejects before a conversation row or a provider call exists.
  const quota = await assertWattbotQuota(userId);

  let conversationId = requestedConversationId;
  if (conversationId) {
    await assertConversation(userId, conversationId);
  } else {
    conversationId = newId();
    const name = await userName(userId);
    await db.insert(wattbotConversations).values({
      id: conversationId,
      userId,
      // Title from the opening question; the greeting is not part of it.
      title: message.length > 68 ? `${message.slice(0, 65)}…` : message || `Chat with ${name}`,
    });
  }

  const history = await db
    .select({ role: wattbotMessages.role, content: wattbotMessages.content })
    .from(wattbotMessages)
    .where(eq(wattbotMessages.conversationId, conversationId))
    .orderBy(desc(wattbotMessages.createdAt))
    .limit(20);
  history.reverse();

  // An explicit window in the question becomes a bounded, validated UTC range.
  const facts = await collectFacts({ userId, homeId }, { customRange: parseDateRange(message) });
  return { conversationId, facts, history, quota };
}

async function persistTurn(
  conversationId: string,
  question: string,
  result: {
    content: string;
    provider: string;
    model: string | null;
    fallbackReason: string | null;
    latencyMs: number;
    knowledgeSources?: string[];
  },
  extra: Record<string, unknown> = {},
) {
  const assistantId = newId();
  // Explicit, distinct timestamps: a single multi-row insert would otherwise
  // share one createdAt and the transcript order would be arbitrary.
  const answeredAt = new Date();
  const askedAt = new Date(answeredAt.getTime() - 1);
  await db.insert(wattbotMessages).values([
    {
      id: newId(),
      conversationId,
      role: 'user',
      content: question,
      provider: 'rule_based',
      createdAt: askedAt,
    },
    {
      id: assistantId,
      conversationId,
      role: 'assistant',
      content: result.content,
      provider: result.provider,
      createdAt: answeredAt,
      metadata: {
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackReason: result.fallbackReason,
        knowledgeSources: result.knowledgeSources ?? [],
        ...extra,
      },
    },
  ]);
  await db.update(wattbotConversations).set({ updatedAt: new Date() }).where(eq(wattbotConversations.id, conversationId));
  return assistantId;
}

wattbotRouter.post(
  '/messages',
  wattbotLimiter,
  validate({ body: wattbotMessageSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof wattbotMessageSchema>>(req);
    const turn = await prepareTurn(req, input.message, input.conversationId);

    const result = await generateAnswer({ question: input.message, facts: turn.facts, history: turn.history });
    const messageId = await persistTurn(turn.conversationId, input.message, result, {
      dataSource: turn.facts.dataSource,
    });

    return created(res, {
      conversationId: turn.conversationId,
      messageId,
      quota: await getWattbotQuota(req.auth!.userId),
      reply: result.content,
      provider: result.provider,
      model: result.model,
      fallbackReason: result.fallbackReason,
      knowledgeSources: result.knowledgeSources,
      providerConfigured: providerStatus().configured,
      suggestions: buildSuggestions(turn.facts),
      context: {
        todayKwh: turn.facts.usage.todayKwh,
        monthKwh: turn.facts.usage.monthKwh,
        simulated: turn.facts.dataSource === 'simulated',
      },
    });
  }),
);

function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Streaming variant. Providers stream tokens; the deterministic fallback sends
 * its full answer as one delta so the client has a single code path.
 */
wattbotRouter.post(
  '/messages/stream',
  wattbotLimiter,
  validate({ body: wattbotMessageSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<z.infer<typeof wattbotMessageSchema>>(req);
    const turn = await prepareTurn(req, input.message, input.conversationId);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abort = new AbortController();
    req.on('close', () => abort.abort());

    const status = providerStatus();
    sseWrite(res, 'meta', {
      conversationId: turn.conversationId,
      provider: status.provider,
      model: status.model,
      providerConfigured: status.configured,
      notice: status.reason,
      suggestions: buildSuggestions(turn.facts),
      quota: turn.quota,
      context: {
        todayKwh: turn.facts.usage.todayKwh,
        monthKwh: turn.facts.usage.monthKwh,
        simulated: turn.facts.dataSource === 'simulated',
        billTotal: turn.facts.bill?.total ?? null,
      },
    });

    try {
      const result = await generateAnswer({
        question: input.message,
        facts: turn.facts,
        history: turn.history,
        signal: abort.signal,
        onDelta: (text) => {
          if (!abort.signal.aborted) sseWrite(res, 'delta', { text });
        },
      });

      if (abort.signal.aborted) {
        res.end();
        return;
      }

      const messageId = await persistTurn(turn.conversationId, input.message, result, {
        dataSource: turn.facts.dataSource,
        streamed: true,
      });

      sseWrite(res, 'done', {
        messageId,
        quota: await getWattbotQuota(req.auth!.userId),
        conversationId: turn.conversationId,
        provider: result.provider,
        model: result.model,
        fallbackReason: result.fallbackReason,
        knowledgeSources: result.knowledgeSources,
        context: {
          todayKwh: turn.facts.usage.todayKwh,
          monthKwh: turn.facts.usage.monthKwh,
          simulated: turn.facts.dataSource === 'simulated',
          billTotal: turn.facts.bill?.total ?? null,
        },
      });
    } catch (error) {
      logger.warn({ err: error }, 'WattBot stream failed');
      if (!abort.signal.aborted) {
        sseWrite(res, 'error', {
          code: 'WATTBOT_FAILED',
          message: 'WattBot could not finish that answer. Please try again.',
        });
      }
    } finally {
      res.end();
    }
  }),
);
