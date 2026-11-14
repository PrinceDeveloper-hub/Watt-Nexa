import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { announcements, blogPosts, db, faqs, subscriptionPlans } from '@wattnexa/database';
import { sendMail } from '../lib/mailer';
import { env } from '../config';
import { asyncHandler, ok } from '../utils/http';
import { validate, bodyOf } from '../middleware/validate';
import { notFound } from '../utils/errors';
import { authLimiter } from '../middleware/rate-limit';

export const publicRouter = Router();

publicRouter.get(
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

publicRouter.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(faqs)
      .where(eq(faqs.isPublished, true))
      .orderBy(faqs.sortOrder);
    return ok(res, rows);
  }),
);

publicRouter.get(
  '/blog',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        title: blogPosts.title,
        excerpt: blogPosts.excerpt,
        publishedAt: blogPosts.publishedAt,
      })
      .from(blogPosts)
      .where(and(eq(blogPosts.status, 'published'), isNull(blogPosts.deletedAt)))
      .orderBy(desc(blogPosts.publishedAt));
    return ok(res, rows);
  }),
);

publicRouter.get(
  '/blog/:slug',
  asyncHandler(async (req, res) => {
    const [post] = await db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.slug, req.params.slug as string), eq(blogPosts.status, 'published')))
      .limit(1);
    if (!post) throw notFound('Article not found', 'POST_NOT_FOUND');
    return ok(res, post);
  }),
);

publicRouter.get(
  '/announcements',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(announcements)
      .where(eq(announcements.isActive, true))
      .orderBy(desc(announcements.publishedAt));
    return ok(res, rows);
  }),
);

publicRouter.post(
  '/contact',
  authLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80),
      email: z.string().trim().email(),
      topic: z.enum(['sales', 'support', 'partnership', 'other']).default('other'),
      message: z.string().trim().min(10).max(4000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<{ name: string; email: string; topic: string; message: string }>(req);
    await sendMail({
      to: env.SMTP_FROM.includes('<') ? env.SMTP_FROM.replace(/.*<|>.*/g, '') : env.SMTP_FROM,
      subject: `[WattNexa contact] ${input.topic} — ${input.name}`,
      text: `From: ${input.name} <${input.email}>\nTopic: ${input.topic}\n\n${input.message}`,
    });
    return ok(res, { received: true });
  }),
);
