import { db, deviceEvents, deviceTelemetry, devices, energyAggregates } from '@wattnexa/database';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { DeviceEventType, DeviceStatus, SensorCapability, TelemetrySample, TelemetrySource } from '@wattnexa/types';
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
    device_status?: 'online' | 'connecting' | 'offline' | 'error';
    firmware_version?: string;
    message_id?: string;
    timestamp?: string;
  };
  source: TelemetrySource;
  /** Where the reading arrived from; recorded on connection events. */
  transport?: 'http' | 'mqtt';
}

export interface IngestResult {
  sample: TelemetrySample;
  deviceStatus: DeviceStatus;
  /** True when an identical message had already been stored. */
  duplicate: boolean;
  statusChanged: boolean;
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
  messageId: row.messageId,
  source: row.source,
});

/** Append-only connection/lifecycle log. Never throws into the ingest path. */
export async function recordDeviceEvent(
  deviceId: string,
  type: DeviceEventType,
  message?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(deviceEvents).values({
      deviceId,
      type,
      message: message?.slice(0, 240) ?? null,
      metadata: metadata ?? null,
    });
  } catch (error) {
    logger.warn({ err: error, deviceId, type }, 'Could not record device event');
  }
}

/**
 * Single place that mutates device status, so history and realtime stay in
 * sync with the column. Returns true when the status actually changed.
 */
export async function applyDeviceStatus(
  input: { deviceId: string; homeId: string; ownerId?: string },
  next: DeviceStatus,
  context: { reason: string; transport?: 'http' | 'mqtt'; firstContact?: boolean },
): Promise<boolean> {
  const [device] = await db
    .select({ status: devices.status, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.id, input.deviceId))
    .limit(1);
  if (!device) return false;

  const previous = device.status as DeviceStatus;
  if (previous === next) return false;

  await db.update(devices).set({ status: next }).where(eq(devices.id, input.deviceId));

  const eventType: DeviceEventType =
    next === 'online'
      ? device.lastSeenAt
        ? 'reconnected'
        : 'connected'
      : next === 'offline'
        ? 'disconnected'
        : next === 'error'
          ? 'error'
          : 'status_changed';

  await recordDeviceEvent(input.deviceId, eventType, context.reason.slice(0, 240), {
    from: previous,
    to: next,
    transport: context.transport ?? null,
  });

  emitToHome(input.homeId, 'device:status', {
    deviceId: input.deviceId,
    status: next,
    previousStatus: previous,
    at: new Date().toISOString(),
  });

  return true;
}

export async function ingestReading(input: IngestInput): Promise<IngestResult> {
  const values = sanitise(input.payload);
  const supplied = input.payload.message_id?.trim();

  // A device clock that is wildly ahead would otherwise create future buckets.
  const parsed = input.payload.timestamp ? new Date(input.payload.timestamp) : new Date();
  const recordedAt =
    Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 300_000 ? new Date() : parsed;

  // Firmware that cannot supply a message id still gets redelivery protection:
  // the same device timestamp is treated as the same reading.
  if (!supplied) {
    const [recent] = await db
      .select()
      .from(deviceTelemetry)
      .where(and(eq(deviceTelemetry.deviceId, input.deviceId), eq(deviceTelemetry.recordedAt, recordedAt)))
      .limit(1);
    if (recent) {
      return {
        sample: rowToSample(recent),
        deviceStatus: 'online',
        duplicate: true,
        statusChanged: false,
      };
    }
  }

  let insertedId: number | undefined;
  try {
    const [result] = await db.insert(deviceTelemetry).values({
      deviceId: input.deviceId,
      recordedAt,
      voltage: values.voltage,
      current: values.current,
      activePower: values.activePower,
      apparentPower: values.apparentPower,
      powerFactor: values.powerFactor,
      energyKwh: values.energyKwh,
      temperature: values.temperature,
      frequency: values.frequency,
      signalStrength: values.signalStrength,
      messageId: supplied ?? null,
      source: input.source,
    });
    insertedId = result.insertId;
  } catch (error) {
    // Unique (device_id, message_id): the broker redelivered a stored message.
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      const [existing] = supplied
        ? await db
            .select()
            .from(deviceTelemetry)
            .where(and(eq(deviceTelemetry.deviceId, input.deviceId), eq(deviceTelemetry.messageId, supplied)))
            .limit(1)
        : [];
      if (existing) {
        logger.debug({ deviceId: input.deviceId, messageId: supplied }, 'Duplicate telemetry ignored');
        return { sample: rowToSample(existing), deviceStatus: 'online', duplicate: true, statusChanged: false };
      }
    }
    throw error;
  }

  if (insertedId === undefined) throw new Error('Telemetry insert returned no id');
  const sample: TelemetrySample = {
    id: insertedId,
    deviceId: input.deviceId,
    recordedAt: recordedAt.toISOString(),
    voltage: values.voltage,
    current: values.current,
    activePower: values.activePower,
    apparentPower: values.apparentPower,
    powerFactor: values.powerFactor,
    energyKwh: values.energyKwh,
    temperature: values.temperature,
    frequency: values.frequency,
    signalStrength: values.signalStrength,
    messageId: supplied ?? null,
    source: input.source,
  };

  const requested = input.payload.device_status;
  const nextStatus: DeviceStatus =
    requested === 'error' ? 'error' : requested === 'offline' ? 'offline' : requested === 'connecting' ? 'connecting' : 'online';

  const statusChanged = await applyDeviceStatus(
    { deviceId: input.deviceId, homeId: input.homeId },
    nextStatus,
    {
      reason:
        nextStatus === 'error'
          ? 'Device reported an error state'
          : nextStatus === 'connecting'
            ? 'Device reported a connection handshake'
            : 'Telemetry received',
      transport: input.transport ?? 'http',
    },
  );

  await db
    .update(devices)
    .set({
      lastSeenAt: new Date(),
      lastReadingAt: recordedAt,
      signalStrength: values.signalStrength,
      ...(input.payload.firmware_version ? { firmwareVersion: input.payload.firmware_version.slice(0, 40) } : {}),
    })
    .where(eq(devices.id, input.deviceId));

  emitToHome(input.homeId, 'telemetry:new', sample);

  return { sample, deviceStatus: nextStatus, duplicate: false, statusChanged };
}

export async function latestReading(deviceId: string): Promise<TelemetrySample | null> {
  const [row] = await db
    .select()
    .from(deviceTelemetry)
    .where(eq(deviceTelemetry.deviceId, deviceId))
    .orderBy(desc(deviceTelemetry.recordedAt))
    .limit(1);
  return row ? rowToSample(row) : null;
}

/**
 * What the hardware actually measures. Derived from the last 20 readings, so a
 * device that never reports temperature is displayed without it instead of
 * being shown a fabricated 0 °C.
 */
export function sensorCapabilities(samples: TelemetrySample[]): SensorCapability[] {
  const keys: SensorCapability['key'][] = [
    'voltage',
    'current',
    'activePower',
    'apparentPower',
    'powerFactor',
    'energyKwh',
    'temperature',
    'frequency',
    'signalStrength',
  ];
  return keys.map((key) => ({
    key,
    available: samples.some((sample) => sample[key] != null),
  }));
}

export async function deviceSensorCapabilities(deviceId: string): Promise<SensorCapability[]> {
  const rows = await db
    .select()
    .from(deviceTelemetry)
    .where(eq(deviceTelemetry.deviceId, deviceId))
    .orderBy(desc(deviceTelemetry.recordedAt))
    .limit(20);
  return sensorCapabilities(rows.map(rowToSample));
}

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
