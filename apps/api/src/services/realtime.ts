import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { db, householdMembers, homes } from '@wattnexa/database';
import { and, eq, isNull } from 'drizzle-orm';
import { env } from '../config';
import { verifyAccessToken } from '../lib/tokens';
import { logger } from '../lib/logger';

let io: SocketServer | null = null;

interface SocketAuth {
  userId: string;
  role: string;
  homeIds: string[];
}

async function resolveHomes(userId: string): Promise<string[]> {
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

export function initRealtime(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    path: '/socket.io',
    cors: { origin: [...env.CORS_ORIGINS, env.WEB_URL], credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const cookies = socket.request.headers.cookie ?? '';
      const match = cookies.match(/(?:^|;\s*)wnx_at=([^;]+)/);
      const bearer = socket.handshake.auth?.token as string | undefined;
      const token = bearer ?? (match ? decodeURIComponent(match[1] as string) : null);
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      if (!payload) return next(new Error('unauthorized'));

      const homeIds = await resolveHomes(payload.sub);
      const auth: SocketAuth = { userId: payload.sub, role: payload.role, homeIds };
      socket.data.auth = auth;
      socket.join(`user:${payload.sub}`);
      for (const homeId of homeIds) socket.join(`home:${homeId}`);
      return next();
    } catch (error) {
      logger.warn({ err: error }, 'Socket authentication failed');
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth as SocketAuth | undefined;
    logger.debug({ userId: auth?.userId }, 'Socket connected');
    socket.on('disconnect', () => logger.debug({ userId: auth?.userId }, 'Socket disconnected'));
  });

  return io;
}

export function getIo(): SocketServer | null {
  return io;
}

/** Only authenticated sockets in the home's room receive readings. */
export function emitToHome(homeId: string, event: string, payload: unknown): void {
  io?.to(`home:${homeId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
