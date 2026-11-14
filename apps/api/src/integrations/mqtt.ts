import mqtt, { type MqttClient } from 'mqtt';
import { db, devices } from '@wattnexa/database';
import { and, eq, isNull } from 'drizzle-orm';
import { env } from '../config';
import { logger } from '../lib/logger';
import { ingestReading } from '../services/telemetry';
import { runAlertChecks } from '../services/alerts-engine';

const telemetrySchemaKeys = [
  'voltage',
  'current',
  'active_power',
  'apparent_power',
  'power_factor',
  'energy_kwh',
  'temperature',
  'frequency',
  'signal_strength',
] as const;

/**
 * Topic contract: `<prefix>/<device-serial>/telemetry` with a JSON payload.
 * The serial identifies the device; the payload never carries credentials.
 */
export function startMqtt(): () => void {
  if (!env.MQTT_ENABLED) {
    logger.info('MQTT disabled (set MQTT_ENABLED=true to connect a broker)');
    return () => undefined;
  }

  const client: MqttClient = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    reconnectPeriod: 5_000,
    clientId: `wattnexa-api-${process.pid}`,
  });

  const topic = `${env.MQTT_TOPIC_PREFIX}/+/telemetry`;

  client.on('connect', () => {
    logger.info({ url: env.MQTT_URL, topic }, 'MQTT connected');
    client.subscribe(topic, (error) => {
      if (error) logger.error({ err: error }, 'MQTT subscribe failed');
    });
  });

  client.on('error', (error) => logger.warn({ err: error }, 'MQTT error'));

  client.on('message', async (receivedTopic, buffer) => {
    try {
      const serial = receivedTopic.split('/')[1];
      if (!serial) return;
      const [device] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.serial, serial), isNull(devices.deletedAt)))
        .limit(1);
      if (!device) {
        logger.warn({ serial }, 'Telemetry from unknown device serial');
        return;
      }

      const raw = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
      const payload: Record<string, unknown> = {};
      for (const key of telemetrySchemaKeys) {
        if (typeof raw[key] === 'number') payload[key] = raw[key];
      }
      if (typeof raw.timestamp === 'string') payload.timestamp = raw.timestamp;
      if (typeof raw.firmware_version === 'string') payload.firmware_version = raw.firmware_version;

      const result = await ingestReading({
        deviceId: device.id,
        homeId: device.homeId,
        payload,
        source: 'hardware',
      });
      await runAlertChecks({
        deviceId: device.id,
        homeId: device.homeId,
        ownerId: device.ownerId,
        sample: result.sample,
      });
    } catch (error) {
      logger.warn({ err: error, topic: receivedTopic }, 'Failed to process MQTT telemetry');
    }
  });

  return () => {
    client.end(true);
  };
}
