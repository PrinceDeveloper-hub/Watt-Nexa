import { Router } from 'express';
import { isProduction } from '../config';
import { outbox, outboxEnabled } from '../lib/mailer';
import { asyncHandler, ok } from '../utils/http';
import { notFound } from '../utils/errors';

export const devRouter = Router();

/**
 * Development-only email capture. When SMTP is configured, real mail is sent
 * and nothing is exposed here.
 */
devRouter.get(
  '/outbox',
  asyncHandler(async (_req, res) => {
    if (isProduction || !outboxEnabled) throw notFound();
    return ok(res, outbox.slice().reverse());
  }),
);
