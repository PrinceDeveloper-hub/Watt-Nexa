import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, deviceCredentials, deviceEvents, devicePairings, devices, homes } from '@wattnexa/database';
import { devicePairSchema, deviceUpdateSchema } from '@wattnexa/shared';
import { bodyOf, validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { accessibleDevices, requireDeviceAccess, requireHomeAccess } from '../lib/ownership';
import { asyncHandler, created, ok } from '../utils/http';
import { newId, randomToken, sha256 } from '../utils/crypto';
import { badRequest, forbidden } from '../utils/errors';
import { auditFromRequest } from '../lib/audit';
import { deviceSensorCapabilities, latestReading, recordDeviceEvent } from '../services/telemetry';
import { emitToHome } from '../services/realtime';
import { publishCommand } from '../integrations/mqtt';
import { env } from '../config';

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

const PAIRING_TTL_MS = 30 * 60 * 1000;

devicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const homeId = typeof req.query.homeId === 'string' ? req.query.homeId : undefined;
    const rows = await accessibleDevices(req.auth!.userId, homeId);
    const withReadings = await Promise.all(
      rows.map(async (device) => ({ ...device, latestReading: await latestReading(device.id) })),
    );
    return ok(res, withReadings);
  }),
);

/** Create a pairing window for an unprovisioned device. */
devicesRouter.post(
  '/pairing',
  validate({ body: z.object({ homeId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { homeId } = bodyOf<{ homeId: string }>(req);
    const home = await requireHomeAccess(req.auth!.userId, homeId);

    // Ambiguous 8-char code; expires quickly and is single-use.
    const code = `WNX-${randomToken(3).toUpperCase()}`;
    await db.insert(devicePairings).values({
      id: newId(),
      code,
      claimedBy: req.auth!.userId,
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
    });
    await auditFromRequest(req, { action: 'device.pairing_created', resourceType: 'home', resourceId: home.id });
    return created(res, {
      code,
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
      homeId,
      instructions: 'Enter this code on the device, or scan the QR code shown in the app.',
    });
  }),
);

/** Complete pairing: binds a hardware serial to the account. */
devicesRouter.post(
  '/pair',
  validate({ body: devicePairSchema }),
  asyncHandler(async (req, res) => {
    const input = bodyOf<{ code: string; homeId: string; name?: string; serial?: string }>(req);
    const home = await requireHomeAccess(req.auth!.userId, input.homeId);

    const [pairing] = await db
      .select()
      .from(devicePairings)
      .where(eq(devicePairings.code, input.code.trim().toUpperCase()))
      .limit(1);
    if (!pairing) throw badRequest('That pairing code is not recognised', undefined, 'PAIRING_INVALID');
    if (pairing.claimedAt) throw badRequest('That pairing code has already been used', undefined, 'PAIRING_USED');
    if (pairing.expiresAt.getTime() < Date.now()) {
      throw badRequest('That pairing code has expired', undefined, 'PAIRING_EXPIRED');
    }
    if (pairing.claimedBy && pairing.claimedBy !== req.auth!.userId) {
      throw forbidden('That pairing code belongs to another account');
    }

    // The serial printed on the unit identifies the physical hardware; a
    // generated one would make the device impossible to recognise later.
    const suppliedSerial = input.serial?.trim().toUpperCase();
    let existing: typeof devices.$inferSelect | undefined;
    if (suppliedSerial) {
      [existing] = await db
        .select()
        .from(devices)
        .where(eq(devices.serial, suppliedSerial))
        .limit(1);

      if (existing && !existing.deletedAt) {
        throw badRequest('That serial is already registered to a device', undefined, 'SERIAL_IN_USE');
      }
      // A removed device keeps its serial so history stays attributable; the
      // same owner may bring that hardware back, nobody else can.
      if (existing && existing.ownerId !== req.auth!.userId) {
        throw forbidden('That serial belongs to another account. Contact support to transfer it.');
      }
    }

    const serial = suppliedSerial ?? `WNX-ESP32-${randomToken(3).toUpperCase()}`;
    const deviceId = existing?.id ?? newId();
    const token = `wnx_dev_${randomToken(24)}`;

    if (existing) {
      await db
        .update(devices)
        .set({
          deletedAt: null,
          homeId: home.id,
          name: input.name ?? existing.name,
          // Never claim a device is connected just because it was paired.
          status: 'not_configured',
        })
        .where(eq(devices.id, deviceId));
    } else {
      await db.insert(devices).values({
        id: deviceId,
        homeId: home.id,
        ownerId: req.auth!.userId,
        name: input.name ?? 'WattNexa device',
        serial,
        status: 'not_configured',
      });
    }

    await recordDeviceEvent(
      deviceId,
      'paired',
      existing ? 'Re-paired to account, awaiting first reading' : 'Paired to account, awaiting first reading',
      { homeId: home.id, via: 'pairing-code' },
    );
    await db.insert(deviceCredentials).values({
      id: newId(),
      deviceId,
      tokenHash: sha256(token),
      label: 'Initial pairing',
    });
    await db
      .update(devicePairings)
      .set({ claimedAt: new Date(), deviceId, claimedBy: req.auth!.userId })
      .where(eq(devicePairings.id, pairing.id));

    await auditFromRequest(req, { action: 'device.paired', resourceType: 'device', resourceId: deviceId });
    return created(res, {
      device: { id: deviceId, name: input.name ?? 'WattNexa device', serial, status: 'not_configured' },
      // Shown exactly once; only the hash is stored.
      deviceToken: token,
      telemetryUrl: `${env.API_URL}/api/v1/telemetry`,
      telemetryTopic: `${env.MQTT_TOPIC_PREFIX}/devices/${serial}/telemetry`,
    });
  }),
);

devicesRouter.get(
  '/:deviceId',
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const [home] = await db.select().from(homes).where(eq(homes.id, device.homeId)).limit(1);
    const readings = await latestReading(device.id);
    const sensors = await deviceSensorCapabilities(device.id);
    const events = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, device.id))
      .orderBy(desc(deviceEvents.occurredAt))
      .limit(25);
    const credentials = await db
      .select({
        id: deviceCredentials.id,
        label: deviceCredentials.label,
        lastUsedAt: deviceCredentials.lastUsedAt,
        revokedAt: deviceCredentials.revokedAt,
        createdAt: deviceCredentials.createdAt,
      })
      .from(deviceCredentials)
      .where(eq(deviceCredentials.deviceId, device.id));
    return ok(res, { ...device, home, latestReading: readings, sensors, events, credentials });
  }),
);

/** Connection timeline shown on the device page. */
devicesRouter.get(
  '/:deviceId/events',
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const limit = Math.min(Number(req.query.limit ?? 30) || 30, 100);
    const rows = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, device.id))
      .orderBy(desc(deviceEvents.occurredAt))
      .limit(limit);
    return ok(res, rows);
  }),
);

const COMMANDS = ['identify', 'reboot', 'sync_time', 'set_interval'] as const;

/** Downlink over the commands topic. Honest 503 when MQTT is not configured. */
devicesRouter.post(
  '/:deviceId/commands',
  validate({
    body: z.object({
      command: z.enum(COMMANDS),
      payload: z.record(z.unknown()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const input = bodyOf<{ command: (typeof COMMANDS)[number]; payload?: Record<string, unknown> }>(req);

    const sent = publishCommand(device.serial, {
      command: input.command,
      ...(input.payload ?? {}),
      issuedAt: new Date().toISOString(),
      commandId: newId(),
    });

    if (!sent) {
      throw badRequest(
        'MQTT is not configured, so commands cannot be delivered to devices.',
        undefined,
        'MQTT_DISABLED',
      );
    }

    await auditFromRequest(req, {
      action: 'device.command_sent',
      resourceType: 'device',
      resourceId: device.id,
      metadata: { command: input.command },
    });
    return ok(res, { queued: true, command: input.command });
  }),
);

devicesRouter.patch(
  '/:deviceId',
  validate({ body: deviceUpdateSchema }),
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const input = bodyOf<{ name?: string; room?: string | null; homeId?: string }>(req);
    if (Object.keys(input).length === 0) throw badRequest('Nothing to update');
    if (input.homeId && input.homeId !== device.homeId) {
      await requireHomeAccess(req.auth!.userId, input.homeId);
    }
    await db
      .update(devices)
      .set({ name: input.name, room: input.room, ...(input.homeId ? { homeId: input.homeId } : {}) })
      .where(eq(devices.id, device.id));
    const [updated] = await db.select().from(devices).where(eq(devices.id, device.id)).limit(1);
    return ok(res, updated);
  }),
);

devicesRouter.post(
  '/:deviceId/credentials',
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const token = `wnx_dev_${randomToken(24)}`;
    await db.insert(deviceCredentials).values({
      id: newId(),
      deviceId: device.id,
      tokenHash: sha256(token),
      label: `Rotated ${new Date().toISOString().slice(0, 10)}`,
    });
    await recordDeviceEvent(device.id, 'credential_issued', 'New device token issued');
    await auditFromRequest(req, { action: 'device.credential_created', resourceType: 'device', resourceId: device.id });
    return created(res, { token });
  }),
);

devicesRouter.delete(
  '/:deviceId/credentials/:credentialId',
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    await db
      .update(deviceCredentials)
      .set({ revokedAt: new Date() })
      .where(and(eq(deviceCredentials.id, req.params.credentialId as string), eq(deviceCredentials.deviceId, device.id)));
    await recordDeviceEvent(device.id, 'credential_revoked', 'Device token revoked');
    await auditFromRequest(req, { action: 'device.credential_revoked', resourceType: 'device', resourceId: device.id });
    return ok(res, { revoked: true });
  }),
);

devicesRouter.delete(
  '/:deviceId',
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    await recordDeviceEvent(device.id, 'disconnected', 'Device removed from the account');
    await db.update(devices).set({ deletedAt: new Date(), status: 'offline' }).where(eq(devices.id, device.id));
    await db.update(deviceCredentials).set({ revokedAt: new Date() }).where(eq(deviceCredentials.deviceId, device.id));
    emitToHome(device.homeId, 'device:removed', { deviceId: device.id });
    await auditFromRequest(req, { action: 'device.removed', resourceType: 'device', resourceId: device.id });
    return ok(res, { removed: true });
  }),
);

devicesRouter.get(
  '/:deviceId/activity',
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const rows = await db
      .select({
        id: deviceCredentials.id,
        action: deviceCredentials.label,
        at: deviceCredentials.lastUsedAt,
      })
      .from(deviceCredentials)
      .where(and(eq(deviceCredentials.deviceId, device.id), isNull(deviceCredentials.revokedAt)))
      .orderBy(desc(deviceCredentials.lastUsedAt))
      .limit(20);
    return ok(res, rows);
  }),
);
