import { createServer } from 'node:http';
import { checkDatabase, closeDatabase, dbConfig } from '@wattnexa/database';
import { createApp } from './app';
import { env, isProduction } from './config';
import { logger } from './lib/logger';
import { initRealtime } from './services/realtime';
import { startMqtt } from './integrations/mqtt';
import { startScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  const dbUp = await checkDatabase();
  if (!dbUp) {
    logger.error(
      `Database unreachable at ${dbConfig.host}:${dbConfig.port}. Start MariaDB (docker compose up -d mariadb) then run pnpm db:migrate && pnpm db:seed.`,
    );
    process.exitCode = 1;
    return;
  }

  const app = createApp();
  const server = createServer(app);
  initRealtime(server);
  const stopScheduler = startScheduler();
  const stopMqtt = startMqtt();

  server.listen(env.API_PORT, () => {
    logger.info(
      { port: env.API_PORT, mode: env.SENSOR_MODE, env: env.NODE_ENV, publicUrl: env.API_URL },
      `WattNexa API listening on port ${env.API_PORT}`,
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopScheduler();
    stopMqtt();
    server.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (!isProduction) {
    logger.info(`Docs: ${env.API_URL}/docs`);
  }
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal startup error');
  process.exit(1);
});
