import { db, alerts, devices, notificationPreferences, notifications, users } from '@wattnexa/database';
import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import type { AlertType, TelemetrySample } from '@wattnexa/types';
import { newId } from '../utils/crypto';
import { logger } from '../lib/logger';
import { sendAlertEmail } from '../lib/mailer';
import { emitToUser } from './realtime';
import { applyDeviceStatus } from './telemetry';
import { buildWattbotInsight, notificationActions, notificationCategory } from './notification-view';
import { env } from '../config';

interface AlertDraft {
  userId: string;
  homeId: string;
  deviceId?: string | null;
  type: AlertType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

const SUPPRESSION_MS = 30 * 60 * 1000;

/** Avoids alert storms: the same alert type is suppressed for 30 minutes.
 * For device-specific alerts, also checks the device ID to allow different devices
 * to trigger independently while suppressing repeated alerts for the same device. */
async function recentlyRaised(
  userId: string,
  type: AlertType,
  deviceId?: string | null
): Promise<boolean> {
  const conditions = [eq(alerts.userId, userId), eq(alerts.type, type), gte(alerts.createdAt, new Date(Date.now() - SUPPRESSION_MS))];
  if (deviceId) {
    conditions.push(eq(alerts.deviceId, deviceId));
  }
  const [row] = await db.select({ id: alerts.id }).from(alerts).where(and(...conditions)).limit(1);
  return Boolean(row);
}

export async function createAlert(draft: AlertDraft): Promise<void> {
  const alertId = newId();
  // Grounded, deterministic WattBot advice is attached once, when the alert is
  // created — not generated again for every telemetry reading.
  const insight = buildWattbotInsight(draft.type, draft.metadata);
  const metadata: Record<string, unknown> = {
    ...(draft.metadata ?? {}),
    ...(insight ? { wattbotInsight: insight } : {}),
  };
  const category = notificationCategory(draft.type, metadata);
  const actions = notificationActions(draft.type, {
    deviceId: draft.deviceId,
    hasInsight: Boolean(insight),
  });

  await db.insert(alerts).values({
    id: alertId,
    userId: draft.userId,
    homeId: draft.homeId,
    deviceId: draft.deviceId ?? null,
    type: draft.type,
    severity: draft.severity,
    title: draft.title,
    message: draft.message,
    metadata,
  });

  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, draft.userId))
    .limit(1);

  const notificationId = newId();
  await db.insert(notifications).values({
    id: notificationId,
    userId: draft.userId,
    alertId,
    channel: 'in_app',
    title: draft.title,
    body: draft.message,
  });

  const payload = {
    id: alertId,
    type: draft.type,
    severity: draft.severity,
    title: draft.title,
    message: draft.message,
    createdAt: new Date().toISOString(),
  };
  emitToUser(draft.userId, 'alert:new', payload);
  emitToUser(draft.userId, 'notification:new', {
    id: notificationId,
    alertId,
    deviceId: draft.deviceId ?? null,
    title: draft.title,
    body: draft.message,
    severity: draft.severity,
    type: draft.type,
    category,
    actions,
    metadata,
    createdAt: payload.createdAt,
  });

  if (prefs?.emailEnabled) {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, draft.userId), isNull(users.deletedAt)))
      .limit(1);
    if (user) await sendAlertEmail(user.email, draft.title, draft.message);
  }
}

export async function runAlertChecks(input: {
  deviceId: string;
  homeId: string;
  ownerId: string;
  sample: TelemetrySample;
}): Promise<void> {
  try {
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, input.ownerId))
      .limit(1);
    if (!prefs) return;

    const { sample } = input;

    if (prefs.powerThresholdW != null && sample.activePower != null && sample.activePower > prefs.powerThresholdW) {
      if (!(await recentlyRaised(input.ownerId, 'high_power', input.deviceId))) {
        await createAlert({
          userId: input.ownerId,
          homeId: input.homeId,
          deviceId: input.deviceId,
          type: 'high_power',
          severity: 'warning',
          title: 'Power threshold exceeded',
          message: `Live draw reached ${sample.activePower.toFixed(0)} W, above your ${prefs.powerThresholdW.toFixed(0)} W threshold.`,
          metadata: { activePowerW: sample.activePower, thresholdW: prefs.powerThresholdW },
        });
      }
    }

    if (
      prefs.temperatureThresholdC != null &&
      sample.temperature != null &&
      sample.temperature > prefs.temperatureThresholdC
    ) {
      if (!(await recentlyRaised(input.ownerId, 'high_temperature', input.deviceId))) {
        await createAlert({
          userId: input.ownerId,
          homeId: input.homeId,
          deviceId: input.deviceId,
          type: 'high_temperature',
          severity: 'critical',
          title: 'Device temperature is high',
          message: `The device reported ${sample.temperature.toFixed(1)} °C, above your ${prefs.temperatureThresholdC.toFixed(0)} °C limit.`,
          metadata: { temperatureC: sample.temperature, thresholdC: prefs.temperatureThresholdC },
        });
      }
    }

    if (sample.source === 'hardware' && sample.activePower != null && sample.activePower > 8000) {
      if (!(await recentlyRaised(input.ownerId, 'unusual_consumption', input.deviceId))) {
        await createAlert({
          userId: input.ownerId,
          homeId: input.homeId,
          deviceId: input.deviceId,
          type: 'unusual_consumption',
          severity: 'critical',
          title: 'Unusually high load detected',
          message: `${(sample.activePower / 1000).toFixed(1)} kW is far above your typical peak. Check for a fault or a large appliance left running.`,
          metadata: { activePowerW: sample.activePower },
        });
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Alert evaluation failed');
  }
}

/** Marks devices as offline when they stop reporting. */
export async function markStaleDevicesOffline(): Promise<void> {
  const cutoff = new Date(Date.now() - env.OFFLINE_THRESHOLD_SECONDS * 1000);
  const stale = await db
    .select({ id: devices.id, homeId: devices.homeId, ownerId: devices.ownerId, name: devices.name })
    .from(devices)
    .where(and(eq(devices.status, 'online'), lt(devices.lastSeenAt, cutoff), isNull(devices.deletedAt)));

  for (const device of stale) {
    await applyDeviceStatus(
      { deviceId: device.id, homeId: device.homeId, ownerId: device.ownerId },
      'offline',
      {
        reason: `No telemetry for ${env.OFFLINE_THRESHOLD_SECONDS}s`,
      },
    );
    if (!(await recentlyRaised(device.ownerId, 'device_offline', device.id))) {
      await createAlert({
        userId: device.ownerId,
        homeId: device.homeId,
        deviceId: device.id,
        type: 'device_offline',
        severity: 'warning',
        title: `${device.name} is offline`,
        message: 'The device has not reported any readings recently. Check its power supply and Wi-Fi connection.',
      });
    }
  }
}

export async function markDeviceOnline(deviceId: string, ownerId: string, homeId: string, name: string) {
  const [device] = await db.select({ status: devices.status }).from(devices).where(eq(devices.id, deviceId)).limit(1);
  if (device && device.status !== 'online') {
    await applyDeviceStatus({ deviceId, homeId, ownerId }, 'online', { reason: 'Device came back online' });
    await createAlert({
      userId: ownerId,
      homeId,
      deviceId,
      type: 'device_online',
      severity: 'info',
      title: `${name} is back online`,
      message: 'Telemetry has resumed.',
    });
  }
}
