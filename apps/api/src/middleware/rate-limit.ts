import rateLimit from 'express-rate-limit';
import { isTest } from '../config';

const skip = () => isTest;

/** Credential endpoints: tight limit to slow password guessing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
  },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 400,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
  },
});

/** Device telemetry can be chatty, but not unbounded. */
export const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => req.ip ?? 'unknown',
});
