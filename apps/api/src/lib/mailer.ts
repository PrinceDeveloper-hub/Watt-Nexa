import nodemailer, { type Transporter } from 'nodemailer';
import { brand, env, isProduction } from '../config';
import { logger } from './logger';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

/** Development-only capture so flows are testable without SMTP. */
export const outbox: OutboundEmail[] = [];

let transporter: Transporter | null = null;
if (env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

export async function sendMail(input: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const record: OutboundEmail = {
    to: input.to,
    subject: input.subject,
    text: input.text,
    sentAt: new Date().toISOString(),
  };
  if (outbox.length >= 100) outbox.shift();
  outbox.push(record);

  if (!transporter) {
    logger.info({ to: input.to, subject: input.subject }, 'Email captured locally (no SMTP configured)');
    return;
  }
  try {
    await transporter.sendMail({ from: env.SMTP_FROM, ...input });
  } catch (error) {
    logger.error({ err: error, to: input.to }, 'Email delivery failed');
  }
}

export const sendVerificationCode = (to: string, code: string): Promise<void> =>
  sendMail({
    to,
    subject: `${brand.name} verification code: ${code}`,
    text: `Your ${brand.name} verification code is ${code}. It expires in 15 minutes.\n\n${brand.tagline}`,
  });

export const sendPasswordReset = (to: string, token: string): Promise<void> => {
  const link = `${env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    subject: `Reset your ${brand.name} password`,
    text: `Reset your password using this link (valid 30 minutes):\n${link}\n\nIf you did not request this, ignore this email.`,
  });
};

export const sendAlertEmail = (to: string, title: string, message: string): Promise<void> =>
  sendMail({ to, subject: `${brand.name}: ${title}`, text: `${message}\n\n— ${brand.name}` });

/** Only expose the dev outbox when emails cannot actually be delivered. */
export const outboxEnabled = !isProduction && !env.SMTP_HOST;
