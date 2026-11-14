import pino from 'pino';
import { isProduction, isTest } from '../config';

export const logger = pino({
  level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[redacted]',
  },
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', singleLine: true },
        },
      }),
});
