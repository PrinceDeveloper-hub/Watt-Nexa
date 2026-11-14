import mqtt, { type MqttClient } from 'mqtt';
import { z } from 'zod';
import { db, devices } from '@wattnexa/database';
import { and, eq, isNull } from 'drizzle-orm';
import { telemetryPayloadSchema } from '@wattnexa/shared';
import { env } from '../config';
import { logger } from '../lib/logger';
import { applyDeviceStatus, ingestReading, recordDeviceEvent } from '../services/telemetry';
import { runAlertChecks } from '../services/alerts-engine';

/**
 * Topic contract (MQTT_USERNAME/PASSWORD authenticate the API to the broker):
 *
 *   <prefix>/devices/<serial>/telemetry   device → API, QoS 1, JSON reading
 *   <prefix>/devices/<serial>/status      device → API, retained LWT: online/offline/error
 *   <prefix>/devices/<serial>/commands    API → device, JSON command
 *
 * The short form `<prefix>/<serial>/telemetry` is still accepted so firmware
 * flashed before this contract existed keeps reporting.
 */
let client: MqttClient | null = null;

/** Status messages carry no measurements, so they have their own contract. */
const statusPayloadSchema = z.object({
  status: z.enum(['online', 'offline', 'connecting', 'error']),
  reason: z.string().max(240).optional(),
  firmware_version: z.string().max(40).optional(),
  signal_strength: z.coerce.number().optional(),
});

const commandTopic = (serial: string) => `${env.MQTT_TOPIC_PREFIX}/devices/${serial}/commands`;

export function mqttEnabled(): boolean {
  return env.MQTT_ENABLED && client !== null;
}

/** Returns false when MQTT is off, so callers can answer honestly. */
export function publishCommand(serial: string, command: Record<string, unknown>): boolean {
  if (!client?.connected) {
    logger.warn({ serial }, 'Command not sent: MQTT is not connected');
    return false;
  }
  client.publish(commandTopic(serial), JSON.stringify(command), { qos: 1 });
  return true;
}

/** Serial sits immediately before the final topic segment. */
function serialFromTopic(topic: string): string | null {
  const parts = topic.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  return parts[parts.length - 2] ?? null;
}

export function startMqtt(): () => void {
  if (!env.MQTT_ENABLED) {
    logger.info('MQTT disabled (set MQTT_ENABLED=true to connect a broker)');
    return () => undefined;
  }

  client = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clientId: `wattnexa-api-${process.pid}`,
  });

  const topics = [
    `${env.MQTT_TOPIC_PREFIX}/+/telemetry`,
    `${env.MQTT_TOPIC_PREFIX}/+/status`,
    `${env.MQTT_TOPIC_PREFIX}/devices/+/telemetry`,
    `${env.MQTT_TOPIC_PREFIX}/devices/+/status`,
  ];

  client.on('connect', () => {
    logger.info({ url: env.MQTT_URL, topics }, 'MQTT connected');
    client?.subscribe(topics, { qos: 1 }, (error) => {
      if (error) logger.error({ err: error }, 'MQTT subscribe failed');
    });
  });

  client.on('reconnect', () => logger.info('MQTT reconnecting'));
  client.on('close', () => logger.warn('MQTT connection closed'));
  client.on('error', (error) => logger.warn({ err: error }, 'MQTT error'));

  client.on('message', (topic, buffer) => {
    void handleMqttMessage(topic, buffer).catch((error) => {
      // Never log the payload: it can carry location-revealing signal data.
      logger.warn({ err: error, topic }, 'Failed to process MQTT message');
    });
  });

  return () => {
    client?.end(true);
    client = null;
  };
}

async function findDevice(serial: string) {
  const [device] = await db
    .select({ id: devices.id, homeId: devices.homeId, ownerId: devices.ownerId, status: devices.status })
    .from(devices)
    .where(and(eq(devices.serial, serial), isNull(devices.deletedAt)))
    .limit(1);
  return device;
}

/** Exported so the broker-facing contract can be tested without a broker. */
export async function handleMqttMessage(topic: string, buffer: Buffer): Promise<void> {
  const serial = serialFromTopic(topic);
  if (!serial) return;
  const kind = topic.endsWith('/status') ? 'status' : topic.endsWith('/telemetry') ? 'telemetry' : null;
  if (!kind) return;

  const device = await findDevice(serial);
  if (!device) {
    // Unauthorised identity: the serial is not registered or was removed.
    logger.warn({ serial, kind }, 'MQTT message from unknown device serial rejected');
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(buffer.toString('utf8'));
  } catch {
    await recordDeviceEvent(device.id, 'telemetry_rejected', 'Malformed JSON payload', { topic });
    logger.warn({ serial, kind }, 'Malformed MQTT payload rejected');
    return;
  }

  if (kind === 'status') {
    const parsed = statusPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      await recordDeviceEvent(device.id, 'telemetry_rejected', 'Invalid status payload', { topic });
      logger.warn({ serial }, 'Invalid MQTT status payload rejected');
      return;
    }
    if (parsed.data.firmware_version || parsed.data.signal_strength != null) {
      await db
        .update(devices)
        .set({
          ...(parsed.data.firmware_version ? { firmwareVersion: parsed.data.firmware_version.slice(0, 40) } : {}),
          ...(parsed.data.signal_strength != null
            ? { signalStrength: Math.round(parsed.data.signal_strength) }
            : {}),
        })
        .where(eq(devices.id, device.id));
    }

    await applyDeviceStatus(
      { deviceId: device.id, homeId: device.homeId, ownerId: device.ownerId },
      parsed.data.status,
      {
        reason: parsed.data.reason ?? 'Device published a status update',
        transport: 'mqtt',
      },
    );
    return;
  }

  const parsed = telemetryPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    await recordDeviceEvent(device.id, 'telemetry_rejected', 'Schema validation failed', {
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    logger.warn({ serial, issues: parsed.error.issues.length }, 'Invalid telemetry payload rejected');
    return;
  }

  const result = await ingestReading({
    deviceId: device.id,
    homeId: device.homeId,
    payload: parsed.data,
    source: 'hardware',
    transport: 'mqtt',
  });

  if (result.duplicate) return;

  await runAlertChecks({
    deviceId: device.id,
    homeId: device.homeId,
    ownerId: device.ownerId,
    sample: result.sample,
  });
}

