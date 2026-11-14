import { db, devices } from '@wattnexa/database';
import { isNull } from 'drizzle-orm';
import { markStaleDevicesOffline } from '../services/alerts-engine';
import { rollupHour } from '../services/telemetry';
import { logger } from '../lib/logger';

async function rollupRecentHours(): Promise<void> {
  const rows = await db
    .select({ id: devices.id, homeId: devices.homeId })
    .from(devices)
    .where(isNull(devices.deletedAt))
    .limit(200);

  const now = new Date();
  for (const device of rows) {
    for (let hoursAgo = 2; hoursAgo >= 0; hoursAgo -= 1) {
      const hour = new Date(now.getTime() - hoursAgo * 3_600_000);
      await rollupHour(device.id, device.homeId, hour);
    }
  }
}

/**
 * In-process scheduling. Deliberately dependency-free: at larger scale this
 * becomes a queue worker rather than an interval.
 */
export function startScheduler(): () => void {
  const offline = setInterval(() => {
    markStaleDevicesOffline().catch((error) => logger.error({ err: error }, 'Offline sweep failed'));
  }, 60_000);

  const rollups = setInterval(() => {
    rollupRecentHours().catch((error) => logger.error({ err: error }, 'Rollup failed'));
  }, 5 * 60_000);

  logger.info('Scheduler started (offline sweep 60s, hourly rollup 5m)');

  return () => {
    clearInterval(offline);
    clearInterval(rollups);
  };
}
