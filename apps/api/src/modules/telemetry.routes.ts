import { Router } from 'express';
import { z } from 'zod';
import { telemetryPayloadSchema } from '@wattnexa/shared';
import { db, devices } from '@wattnexa/database';
import { eq } from 'drizzle-orm';
import { requireDevice } from '../middleware/device-auth';
import { requireAuth } from '../middleware/auth';
import { bodyOf, validate } from '../middleware/validate';
import { telemetryLimiter } from '../middleware/rate-limit';
import { asyncHandler, created, ok } from '../utils/http';
import { applyDeviceStatus, ingestReading } from '../services/telemetry';
import { requireDeviceAccess } from '../lib/ownership';
import { emitToHome } from '../services/realtime';
import { runAlertChecks } from '../services/alerts-engine';

export const telemetryRouter = Router();

/**
 * Hardware ingest. Authenticated by the per-device bearer token, never by a
 * shared secret. The device id comes from the credential, not the body.
 */
telemetryRouter.post(
  '/',
  telemetryLimiter,
  requireDevice,
  validate({ body: telemetryPayloadSchema }),
  asyncHandler(async (req, res) => {
    const device = req.device!;
    const payload = bodyOf<Parameters<typeof ingestReading>[0]['payload']>(req);

    const result = await ingestReading({
      deviceId: device.id,
      homeId: device.homeId,
      payload,
      source: 'hardware',
    });

    // Alert evaluation is intentionally off the request path's critical work,
    // but awaited so tests observe it deterministically.
    await runAlertChecks({
      deviceId: device.id,
      homeId: device.homeId,
      ownerId: device.ownerId,
      sample: result.sample,
    });

    return created(res, {
      accepted: true,
      duplicate: result.duplicate,
      recordedAt: result.sample.recordedAt,
      deviceStatus: result.deviceStatus,
    });
  }),
);

/**
 * Status-only heartbeat for firmware that cannot attach a measurement
 * (for example while it waits for the CT clamp). It never writes a reading.
 */
telemetryRouter.post(
  '/status',
  telemetryLimiter,
  requireDevice,
  validate({
    body: z.object({
      status: z.enum(['online', 'connecting', 'offline', 'error']),
      reason: z.string().max(200).optional(),
      firmware_version: z.string().max(40).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const device = req.device!;
    const input = bodyOf<{ status: 'online' | 'connecting' | 'offline' | 'error'; reason?: string }>(req);
    await applyDeviceStatus({ deviceId: device.id, homeId: device.homeId, ownerId: device.ownerId }, input.status, {
      reason: input.reason ?? 'Device heartbeat',
      transport: 'http',
    });
    return ok(res, { status: input.status });
  }),
);

/** Authenticated users can inject one clearly-labelled simulated reading. */
telemetryRouter.post(
  '/simulate',
  requireAuth,
  validate({ body: z.object({ deviceId: z.string().uuid() }).passthrough() }),
  asyncHandler(async (req, res) => {
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : '';
    const device = await requireDeviceAccess(req.auth!.userId, deviceId);

    const seed = Date.now() / 1000;
    const base = 180 + (Math.sin(seed / 60) + 1) * 320;
    const activePower = Number(base.toFixed(1));
    const voltage = Number((229 + Math.sin(seed / 30) * 4).toFixed(1));

    const result = await ingestReading({
      deviceId: device.id,
      homeId: device.homeId,
      payload: {
        voltage,
        current: Number((activePower / voltage).toFixed(3)),
        active_power: activePower,
        apparent_power: Number((activePower / 0.95).toFixed(1)),
        power_factor: 0.95,
        temperature: Number((31 + Math.random() * 3).toFixed(1)),
        frequency: 50,
        signal_strength: -62,
        device_status: 'online',
      },
      source: 'simulated',
    });

    emitToHome(device.homeId, 'telemetry:simulated', result.sample);
    return created(res, result.sample);
  }),
);

/** Lightweight liveness probe used by the device page. */
telemetryRouter.get(
  '/:deviceId/latest',
  requireAuth,
  asyncHandler(async (req, res) => {
    const device = await requireDeviceAccess(req.auth!.userId, req.params.deviceId as string);
    const [row] = await db.select().from(devices).where(eq(devices.id, device.id)).limit(1);
    return ok(res, { status: row?.status ?? 'offline', lastSeenAt: row?.lastSeenAt ?? null });
  }),
);
