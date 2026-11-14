/**
 * Development telemetry simulator.
 *
 * Emits realistic hourly-profile readings for every registered device and
 * always stores them with source='simulated', so they can never be mistaken
 * for hardware measurements.
 *
 *   pnpm simulate            # every 5 seconds
 *   pnpm simulate -- --fast  # every 2 seconds
 */
import { db, devices, closeDatabase } from '@wattnexa/database';
import { isNull } from 'drizzle-orm';
import { ingestReading } from '../src/services/telemetry';
import { env } from '../src/config';

const FAST = process.argv.includes('--fast');
const intervalMs = FAST ? 2_000 : 5_000;

function loadWatts(hour: number, weekend: boolean): number {
  let watts = 95;
  if (hour < 5) watts += 25;
  if (hour >= 6 && hour < 9) watts += 420;
  if (hour >= 9 && hour < 13) watts += 160;
  if (hour >= 13 && hour < 17) watts += 780;
  if (hour >= 17 && hour < 18) watts += 300;
  if (hour >= 18 && hour < 22.5) watts += 1050;
  if (hour >= 22.5) watts += 240;
  if (weekend) watts *= 1.14;
  return watts * (0.9 + Math.random() * 0.2);
}

async function tick(): Promise<void> {
  const rows = await db.select().from(devices).where(isNull(devices.deletedAt));
  if (rows.length === 0) {
    console.log('No devices found. Run pnpm db:seed first.');
    return;
  }

  const local = new Date(Date.now() + 5.5 * 3_600_000);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const weekend = local.getUTCDay() === 0 || local.getUTCDay() === 6;

  for (const device of rows) {
    const activePower = Number(loadWatts(hour, weekend).toFixed(1));
    const voltage = Number((229 + (Math.random() - 0.5) * 7).toFixed(1));
    const powerFactor = Number((0.93 + Math.random() * 0.05).toFixed(2));

    await ingestReading({
      deviceId: device.id,
      homeId: device.homeId,
      payload: {
        voltage,
        current: Number((activePower / voltage).toFixed(3)),
        active_power: activePower,
        apparent_power: Number((activePower / powerFactor).toFixed(1)),
        power_factor: powerFactor,
        temperature: Number((30 + Math.random() * 4).toFixed(1)),
        frequency: Number((49.9 + Math.random() * 0.15).toFixed(2)),
        signal_strength: Math.round(-58 - Math.random() * 10),
        device_status: 'online',
        firmware_version: device.firmwareVersion ?? '1.4.2',
      },
      source: 'simulated',
    });
  }

  console.log(`[simulated] ${rows.length} device(s) · ${(loadWatts(hour, weekend) / 1000).toFixed(2)} kW`);
}

async function main(): Promise<void> {
  if (env.SENSOR_MODE !== 'simulated') {
    console.warn('SENSOR_MODE is not "simulated". Readings will still be stored as simulated.');
  }
  console.log(`WattNexa simulator running every ${intervalMs / 1000}s. Ctrl+C to stop.`);
  await tick();
  const timer = setInterval(() => {
    tick().catch((error) => console.error('Simulator tick failed', error));
  }, intervalMs);

  const stop = () => {
    clearInterval(timer);
    void closeDatabase().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase();
  process.exit(1);
});
