import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { checkDatabase } from '@wattnexa/database';
import { apiLimiter } from './middleware/rate-limit';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiRouter } from './routes';
import { appConfig, env, isProduction } from './config';
import { logger } from './lib/logger';
import { openApiDocument } from './openapi';
import { isAllowedOrigin } from './lib/origin';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        const allowed = isAllowedOrigin(origin);
        return callback(allowed ? null : new Error('Origin not allowed'), allowed);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(compression());
  app.use(csrfProtection);
  if (!isProduction) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  }

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime(), version: '1.0.0' } });
  });

  app.get('/health/ready', async (_req, res) => {
    const dbUp = await checkDatabase();
    res.status(dbUp ? 200 : 503).json({
      success: dbUp,
      data: { database: dbUp ? 'connected' : 'unavailable' },
    });
  });

  // Aliases under /api for clients that expect the documented paths.
  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime(), version: '1.0.0' } });
  });
  app.get('/api/health/database', async (_req, res) => {
    const dbUp = await checkDatabase();
    res.status(dbUp ? 200 : 503).json({
      success: dbUp,
      data: { database: dbUp ? 'connected' : 'unavailable' },
    });
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument as unknown as Record<string, unknown>, {
    customSiteTitle: 'WattNexa API',
  }));
  app.get('/docs.json', (_req, res) => res.json(openApiDocument));

  app.use(appConfig.apiPrefix, apiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
