import { accessibleDevices, requireHomeAccess } from './ownership';
import { notFound } from '../utils/errors';

/** Resolve a home from a query/body, verifying the caller's access. */
export async function resolveHome(query: Record<string, unknown>, userId: string): Promise<string> {
  const homeId = typeof query.homeId === 'string' ? query.homeId : undefined;
  if (homeId) {
    await requireHomeAccess(userId, homeId);
    return homeId;
  }
  const [device] = await accessibleDevices(userId);
  if (!device) throw notFound('No household found for this account', 'NO_HOME');
  return device.homeId;
}
