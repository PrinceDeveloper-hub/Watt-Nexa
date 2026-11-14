import { db, deviceTelemetry, devices, energyAggregates } from '@wattnexa/database';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { TelemetrySample, TelemetrySource } from '@wattnexa/types';
import { aggregateSamples, bucketStart, derivePowerFactor } from '@wattnexa/shared';
import { env } from '../config';
import { logger } from '../lib/logger';
import { emitToHome } from './realtime';

export interface IngestInput {
  deviceId: string;
  homeId: string;
  payload: {
    voltage?: number | null;
    current?: number | null;
    active_power?: number | null;
    apparent_power?: number | null;
    power_factor?: number | null;
    energy_kwh?: number | null;
    temperature?: number | null;
    frequency?: number | null;
    signal_strength?: number | null;
    device_status?: 'online' | 'offline' | 'error';
    firmware_version?: string;
    timestamp?: string;
  };
  source: TelemetrySource;
}

export interface IngestResult {
  sample: TelemetrySample;
  deviceStatus: string;
}

const numeric = (value: number | null | undefined): number | null =>
  value == null || !Number.isFinite(value) ? null : value;

/**
 * Validate ranges rather than trusting the device. A bad CT calibration can
 * otherwise poison history and every derived chart.
 */
function sanitise(payload: IngestInput['payload']) {
  const clamp = (value: number | null | undefined, min: number, max: number) =>
    value == null ? null : Math.min(max, Math.max(min, value));

  const voltage = clamp(numeric(payload.voltage), 0, 600);
  const current = clamp(numeric(payload.current), 0, 200);
  const activePower = clamp(numeric(payload.active_power), 0, 120_000);
  const apparentPower = clamp(numeric(payload.apparent_power), 0, 120_000);
  const powerFactor =
    numeric(payload.power_factor) ?? derivePowerFactor(activePower, apparentPower);
  const temperature = clamp(numeric(payload.temperature), -40, 150);
  const frequency = clamp(numeric(payload.frequency), 40, 70);
  const energyKwh = numeric(payload.energy_kwh);
  const signalStrength =
    payload.signal_strength == null ? null : Math.round(clamp(payload.signal_strength, -120, 0) as number);

  return { voltage, current, activePower, apparentPower, powerFactor, temperature, frequency, energyKwh, signalStrength };
}

export async function ingestReading(input: IngestInput): Promise<IngestResult> {
  const values = sanitise(input.payload);
  const recordedAt = input.payload.timestamp ? new Date(input.payload.timestamp) : new Date();
  const safeRecordedAt = Number.isNaN(recordedAt.getTime()) || recordedAt.getTime() > Date.now() + 300_000
    ? new Date()
    : recordedAt;

  const [inserted] = await db.insert(deviceTelemetry).values({
    deviceId: input.deviceId,
    recordedAt: safeRecordedAt,
    voltage: values.voltage,
    current: values.current,
    activePower: values.activePower,
    apparentPower: values.apparentPower,
    powerFactor: values.powerFactor,
    energyKwh: values.energyKwh,
    temperature: values.temperature,
    frequency: values.frequency,
    signalStrength: values.signalStrength,
    source: input.source,
  });

  const nextStatus = input.payload.device_status ?? 'online';
  await db
    .update(devices)
    .set({
      status: nextStatus === 'offline' ? 'offline' : nextStatus === 'error' ? 'error' : 'online',
      lastSeenAt: new Date(),
      lastReadingAt: safeRecordedAt,
      signalStrength: values.signalStrength,
      ...(input.payload.firmware_version ? { firmwareVersion: input.payload.firmware_version.slice(0, 40) } : {}),
    })
    .where(eq(devices.id, input.deviceId));

  const sample: TelemetrySample = {
    id: inserted.insertId,
    deviceId: input.deviceId,
    recordedAt: safeRecordedAt.toISOString(),
    voltage: values.voltage,
    current: values.current,
    activePower: values.activePower,
    apparentPower: values.apparentPower,
    powerFactor: values.powerFactor,
    energyKwh: values.energyKwh,
    temperature: values.temperature,
    frequency: values.frequency,
    signalStrength: values.signalStrength,
    source: input.source,
  };

  emitToHome(input.homeId, 'telemetry:new', sample);
  emitToHome(input.homeId, 'device:status', {
    deviceId: input.deviceId,
    status: nextStatus,
    lastSeenAt: new Date().toISOString(),
  });

  return { sample, deviceStatus: nextStatus };
}

export async function latestReading(deviceId: string): Promise<TelemetrySample | null> {
  const [row] = await db
    .select()
    .from(deviceTelemetry)
    .where(eq(deviceTelemetry.deviceId, deviceId))
    .orderBy(desc(deviceTelemetry.recordedAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.deviceId,
    recordedAt: row.recordedAt.toISOString(),
    voltage: row.voltage,
    current: row.current,
    activePower: row.activePower,
    apparentPower: row.apparentPower,
    powerFactor: row.powerFactor,
    energyKwh: row.energyKwh,
    temperature: row.temperature,
    frequency: row.frequency,
    signalStrength: row.signalStrength,
    source: row.source,
  };
}

const rowToSample = (row: typeof deviceTelemetry.$inferSelect): TelemetrySample => ({
  id: row.id,
  deviceId: row.deviceId,
  recordedAt: row.recordedAt.toISOString(),
  voltage: row.voltage,
  current: row.current,
  activePower: row.activePower,
  apparentPower: row.apparentPower,
  powerFactor: row.powerFactor,
  energyKwh: row.energyKwh,
  temperature: row.temperature,
  frequency: row.frequency,
  signalStrength: row.signalStrength,
  source: row.source,
});

/**
 * Recompute one hourly aggregate. Idempotent: the bucket row is replaced, so
 * the scheduler can safely retry after a restart.
 */
export async function rollupHour(deviceId: string, homeId: string, hour: Date): Promise<void> {
  const start = bucketStart(hour, 'hour');
  const end = new Date(start.getTime() + 3_600_000);
  const rows = await db
    .select()
    .from(deviceTelemetry)
    .where(
      and(
        eq(deviceTelemetry.deviceId, deviceId),
        gte(deviceTelemetry.recordedAt, start),
        lt(deviceTelemetry.recordedAt, end),
      ),
    );
  if (rows.length === 0) return;

  const samples = rows.map(rowToSample);
  const [point] = aggregateSamples(samples, 'hour', { intervalSeconds: 3600 });
  if (!point) return;

  const source: TelemetrySource = samples.every((s) => s.source === 'simulated') ? 'simulated' : 'hardware';

  await db
    .insert(energyAggregates)
    .values({
      homeId,
      deviceId,
      bucket: 'hour',
      bucketStart: start,
      energyKwh: point.energyKwh,
      peakPowerW: point.peakPowerW,
      averagePowerW: point.averagePowerW,
      sampleCount: point.samples,
      source,
    })
    .onDuplicateKeyUpdate({
      set: {
        energyKwh: point.energyKwh,
        peakPowerW: point.peakPowerW,
        averagePowerW: point.averagePowerW,
        sampleCount: point.samples,
      },
    });

  logger.debug({ deviceId, hour: start.toISOString() }, 'Rolled up hourly aggregate');
}

export const sensorMode = env.SENSOR_MODE;
export const aggregateForChart = aggregateSamples;
