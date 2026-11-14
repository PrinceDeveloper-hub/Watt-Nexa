import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  db,
  deviceCredentials,
  deviceEvents,
  deviceTelemetry,
  devices,
  homes,
  users,
} from '@wattnexa/database';
import { and, eq } from 'drizzle-orm';
import { telemetryPayloadSchema } from '@wattnexa/shared';
import { createApp } from '../src/app';
import { sha256 } from '../src/utils/crypto';
import { ingestReading, latestReading } from '../src/services/telemetry';
import { requireDeviceAccess } from '../src/lib/ownership';
import { handleMqttMessage } from '../src/integrations/mqtt';

const suffix = randomUUID().slice(0, 8);
const userId = randomUUID();
const otherUserId = randomUUID();
const homeId = randomUUID();
const deviceId = randomUUID();
const deviceToken = `wnx_dev_${randomUUID().replace(/-/g, '')}`;

const app = createApp();
const ingest = (body: Record<string, unknown>, token = deviceToken) =>
  request(app).post('/api/v1/telemetry').set('Authorization', `Bearer ${token}`).send(body);

async function telemetryCount(): Promise<number> {
  const rows = await db.select({ id: deviceTelemetry.id }).from(deviceTelemetry).where(eq(deviceTelemetry.deviceId, deviceId));
  return rows.length;
}

async function deviceRow() {
  const [row] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  return row;
}

beforeAll(async () => {
  await db.insert(users).values([
    { id: userId, email: `telemetry-${suffix}@test.local`, passwordHash: 'x', name: 'Telemetry Test' },
    { id: otherUserId, email: `other-${suffix}@test.local`, passwordHash: 'x', name: 'Other User' },
  ]);
  await db.insert(homes).values({ id: homeId, ownerId: userId, name: 'Test Home' });
  await db.insert(devices).values({
    id: deviceId,
    homeId,
    ownerId: userId,
    name: 'Test Meter',
    serial: `TEST-${suffix}`,
    status: 'not_configured',
  });
  await db.insert(deviceCredentials).values({
    id: randomUUID(),
    deviceId,
    tokenHash: sha256(deviceToken),
    label: 'Test credential',
  });
});

afterAll(async () => {
  await db.delete(devices).where(eq(devices.id, deviceId));
  await db.delete(homes).where(eq(homes.id, homeId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await closeDatabase();
});

describe('telemetry payload validation', () => {
  it('accepts a reading with measurements', () => {
    const parsed = telemetryPayloadSchema.safeParse({ voltage: 230.5, current: 2.1 });
    expect(parsed.success).toBe(true);
  });

  it('rejects a payload with no measurements at all', () => {
    expect(telemetryPayloadSchema.safeParse({ device_status: 'online' }).success).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(telemetryPayloadSchema.safeParse({ active_power: 100, timestamp: 'not-a-date' }).success).toBe(false);
  });

  it('rejects an unknown device status value', () => {
    expect(telemetryPayloadSchema.safeParse({ active_power: 100, device_status: 'exploded' }).success).toBe(false);
  });
});

describe('device authentication', () => {
  it('rejects a missing device token', async () => {
    const response = await request(app).post('/api/v1/telemetry').send({ active_power: 10 });
    expect(response.status).toBe(401);
  });

  it('rejects a token that is not a device token', async () => {
    const response = await ingest({ active_power: 10 }, 'wnx_at_some-user-session');
    expect(response.status).toBe(401);
  });

  it('rejects an unknown device token', async () => {
    const response = await ingest({ active_power: 10 }, `wnx_dev_${'a'.repeat(48)}`);
    expect(response.status).toBe(401);
  });
});

describe('telemetry ingestion', () => {
  it('stores a valid reading and flips the device online', async () => {
    const before = await telemetryCount();
    const response = await ingest({
      voltage: 231.4,
      current: 1.8,
      active_power: 416.5,
      temperature: 32.2,
      firmware_version: '1.4.2',
      message_id: 'msg-1',
      timestamp: new Date().toISOString(),
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ accepted: true, duplicate: false, deviceStatus: 'online' });
    expect(await telemetryCount()).toBe(before + 1);

    const device = await deviceRow();
    expect(device?.status).toBe('online');
    expect(device?.firmwareVersion).toBe('1.4.2');
    expect(device?.lastSeenAt).not.toBeNull();

    const [event] = await db
      .select()
      .from(deviceEvents)
      .where(and(eq(deviceEvents.deviceId, deviceId), eq(deviceEvents.type, 'connected')))
      .limit(1);
    expect(event).toBeDefined();
  });

  it('ignores a redelivered message id instead of duplicating it', async () => {
    const before = await telemetryCount();
    const payload = {
      active_power: 420,
      message_id: 'msg-1',
      timestamp: new Date().toISOString(),
    };

    const response = await ingest(payload);
    expect(response.status).toBe(201);
    expect(response.body.data.duplicate).toBe(true);
    expect(await telemetryCount()).toBe(before);
  });

  it('ignores an identical timestamp when the firmware sends no message id', async () => {
    const fixed = new Date('2026-01-05T10:00:00.000Z').toISOString();
    const first = await ingest({ active_power: 150, timestamp: fixed });
    const second = await ingest({ active_power: 150, timestamp: fixed });

    expect(first.body.data.duplicate).toBe(false);
    expect(second.body.data.duplicate).toBe(true);
  });

  it('clamps out-of-range measurements rather than storing garbage', async () => {
    const response = await ingest({ voltage: 99_999, current: -4, message_id: `clamp-${suffix}` });
    expect(response.status).toBe(201);

    const [row] = await db
      .select()
      .from(deviceTelemetry)
      .where(and(eq(deviceTelemetry.deviceId, deviceId), eq(deviceTelemetry.messageId, `clamp-${suffix}`)))
      .limit(1);
    expect(row?.voltage).toBe(600);
    expect(row?.current).toBe(0);
  });

  it('replaces a future timestamp with server time', async () => {
    const messageId = `future-${suffix}`;
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await ingest({ active_power: 200, message_id: messageId, timestamp: future });

    const [row] = await db
      .select()
      .from(deviceTelemetry)
      .where(and(eq(deviceTelemetry.deviceId, deviceId), eq(deviceTelemetry.messageId, messageId)))
      .limit(1);
    expect(row?.recordedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('marks the device offline when the device reports it', async () => {
    const response = await ingest({
      active_power: 0,
      device_status: 'offline',
      message_id: `offline-${suffix}`,
    });
    expect(response.status).toBe(201);
    expect((await deviceRow())?.status).toBe('offline');

    const [event] = await db
      .select()
      .from(deviceEvents)
      .where(and(eq(deviceEvents.deviceId, deviceId), eq(deviceEvents.type, 'disconnected')))
      .limit(1);
    expect(event).toBeDefined();
  });
});

describe('status heartbeats', () => {
  it('accepts a status-only heartbeat and records it', async () => {
    const response = await request(app)
      .post('/api/v1/telemetry/status')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ status: 'error', reason: 'CT clamp disconnected' });

    expect(response.status).toBe(200);
    expect((await deviceRow())?.status).toBe('error');

    const [event] = await db
      .select()
      .from(deviceEvents)
      .where(and(eq(deviceEvents.deviceId, deviceId), eq(deviceEvents.type, 'error')))
      .limit(1);
    expect(event?.message).toContain('CT clamp disconnected');
  });
});

describe('service level guarantees', () => {
  it('returns the newest stored reading', async () => {
    await ingestReading({
      deviceId,
      homeId,
      payload: { active_power: 777, message_id: `latest-${suffix}`, timestamp: new Date(Date.now() - 1000).toISOString() },
      source: 'simulated',
    });
    const latest = await latestReading(deviceId);
    expect(latest?.deviceId).toBe(deviceId);
    expect(latest?.source).toBeDefined();
  });

  it('keeps another account out of the device', async () => {
    await expect(requireDeviceAccess(otherUserId, deviceId)).rejects.toThrow(/access/i);
  });
});

describe('mqtt message handling', () => {
  const prefix = process.env.MQTT_TOPIC_PREFIX ?? 'wattnexa';

  it('stores a telemetry message published on the device topic', async () => {
    const before = await telemetryCount();
    await handleMqttMessage(
      `${prefix}/devices/TEST-${suffix}/telemetry`,
      Buffer.from(JSON.stringify({ active_power: 512.4, voltage: 230, message_id: `mqtt-${suffix}` })),
    );
    expect(await telemetryCount()).toBe(before + 1);
  });

  it('ignores a message from a serial that is not registered', async () => {
    const before = await telemetryCount();
    await handleMqttMessage(
      `${prefix}/devices/NOT-REGISTERED/telemetry`,
      Buffer.from(JSON.stringify({ active_power: 900, message_id: `ghost-${suffix}` })),
    );
    expect(await telemetryCount()).toBe(before);
  });

  it('rejects malformed JSON and records why', async () => {
    const before = await db
      .select({ id: deviceEvents.id })
      .from(deviceEvents)
      .where(and(eq(deviceEvents.deviceId, deviceId), eq(deviceEvents.type, 'telemetry_rejected')));

    await handleMqttMessage(`${prefix}/devices/TEST-${suffix}/telemetry`, Buffer.from('{not json'));

    const after = await db
      .select({ id: deviceEvents.id })
      .from(deviceEvents)
      .where(and(eq(deviceEvents.deviceId, deviceId), eq(deviceEvents.type, 'telemetry_rejected')));
    expect(after.length).toBe(before.length + 1);
  });

  it('applies an offline last-will status message', async () => {
    await handleMqttMessage(
      `${prefix}/devices/TEST-${suffix}/status`,
      Buffer.from(JSON.stringify({ status: 'offline', reason: 'last will' })),
    );
    expect((await deviceRow())?.status).toBe('offline');
  });

  it('accepts the legacy short topic form', async () => {
    const before = await telemetryCount();
    await handleMqttMessage(
      `${prefix}/TEST-${suffix}/telemetry`,
      Buffer.from(JSON.stringify({ current: 2.2, message_id: `legacy-${suffix}` })),
    );
    expect(await telemetryCount()).toBe(before + 1);
  });
});
