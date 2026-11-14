import type { NextFunction, Request, Response } from 'express';
import { db, deviceCredentials, devices } from '@wattnexa/database';
import { and, eq, isNull } from 'drizzle-orm';
import { sha256 } from '../utils/crypto';
import { unauthorized } from '../utils/errors';

export interface DeviceContext {
  id: string;
  homeId: string;
  ownerId: string;
}

export async function requireDevice(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Device token missing', 'DEVICE_TOKEN_MISSING');
    const token = header.slice(7).trim();
    if (!token.startsWith('wnx_dev_')) throw unauthorized('Malformed device token', 'DEVICE_TOKEN_INVALID');

    const [row] = await db
      .select({
        credentialId: deviceCredentials.id,
        revokedAt: deviceCredentials.revokedAt,
        expiresAt: deviceCredentials.expiresAt,
        deviceId: devices.id,
        homeId: devices.homeId,
        ownerId: devices.ownerId,
        deletedAt: devices.deletedAt,
      })
      .from(deviceCredentials)
      .innerJoin(devices, eq(deviceCredentials.deviceId, devices.id))
      .where(and(eq(deviceCredentials.tokenHash, sha256(token)), isNull(deviceCredentials.revokedAt)))
      .limit(1);

    if (!row || row.deletedAt) throw unauthorized('Unknown device', 'DEVICE_UNAUTHORIZED');
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Device credential expired', 'DEVICE_TOKEN_EXPIRED');
    }

    req.device = { id: row.deviceId, homeId: row.homeId, ownerId: row.ownerId };
    await db
      .update(deviceCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(deviceCredentials.id, row.credentialId));
    next();
  } catch (error) {
    next(error);
  }
}
