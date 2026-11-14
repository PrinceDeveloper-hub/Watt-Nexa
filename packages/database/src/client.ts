import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { env } from '@wattnexa/config';
import * as schema from './schema';

export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  charset: 'utf8mb4';
  timezone: 'Z';
}

/** Parse DATABASE_URL into explicit mysql2 options (URI support varies). */
export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'wattnexa',
    charset: 'utf8mb4',
    timezone: 'Z',
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __wattnexaPool: mysql.Pool | undefined;
}

/** Reuse the pool across hot reloads so tsx watch does not leak connections. */
export const pool =
  globalThis.__wattnexaPool ??
  mysql.createPool({
    ...parseDatabaseUrl(env.DATABASE_URL),
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });

if (env.NODE_ENV !== 'production') {
  globalThis.__wattnexaPool = pool;
}

export const db = drizzle(pool, { schema, mode: 'default' });

export type Database = typeof db;
export { schema };

export async function checkDatabase(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
