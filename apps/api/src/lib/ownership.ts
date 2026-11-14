import { db, devices, homes, householdMembers } from '@wattnexa/database';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { forbidden, notFound } from '../utils/errors';

/** Every home the user owns or is an active member of. */
export async function accessibleHomeIds(userId: string): Promise<string[]> {
  const owned = await db
    .select({ id: homes.id })
    .from(homes)
    .where(and(eq(homes.ownerId, userId), isNull(homes.deletedAt)));

  const shared = await db
    .select({ id: householdMembers.homeId })
    .from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.status, 'active')));

  return [...new Set([...owned.map((h) => h.id), ...shared.map((s) => s.id)])];
}

export type HomeRecord = typeof homes.$inferSelect;

export async function requireHomeAccess(userId: string, homeId: string): Promise<HomeRecord> {
  const [home] = await db
    .select()
    .from(homes)
    .where(and(eq(homes.id, homeId), isNull(homes.deletedAt)))
    .limit(1);
  if (!home) throw notFound('Home not found', 'HOME_NOT_FOUND');
  if (home.ownerId === userId) return home;

  const [member] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.homeId, homeId),
        eq(householdMembers.userId, userId),
        eq(householdMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!member) throw forbidden('You do not have access to this home');
  return home;
}

export type DeviceRecord = typeof devices.$inferSelect;

export async function requireDeviceAccess(userId: string, deviceId: string): Promise<DeviceRecord> {
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), isNull(devices.deletedAt)))
    .limit(1);
  if (!device) throw notFound('Device not found', 'DEVICE_NOT_FOUND');
  if (device.ownerId === userId) return device;

  const homeIds = await accessibleHomeIds(userId);
  if (!homeIds.includes(device.homeId)) throw forbidden('You do not have access to this device');
  return device;
}

/** Devices the user can see, optionally scoped to one home. */
export async function accessibleDevices(userId: string, homeId?: string) {
  const homeIds = homeId ? [await requireHomeAccess(userId, homeId).then((h) => h.id)] : await accessibleHomeIds(userId);
  if (homeIds.length === 0) return [];
  return db
    .select()
    .from(devices)
    .where(and(inArray(devices.homeId, homeIds), isNull(devices.deletedAt)))
    .orderBy(devices.createdAt);
}
