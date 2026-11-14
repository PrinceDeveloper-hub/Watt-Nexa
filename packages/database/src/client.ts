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

/** Resolve the database connection from DB_* (preferred) or DATABASE_URL. */
export function resolveDatabaseConfig(): ParsedDatabaseUrl {
  const dbHost = env.DB_HOST;
  const dbPort = env.DB_PORT;
  const dbUser = env.DB_USER;
  const dbPassword = env.DB_PASSWORD;
  const dbName = env.DB_NAME;
  if (dbUser && dbPassword != null && dbName) {
    return {
      host: dbHost || '127.0.0.1',
      port: dbPort || 3307,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      charset: 'utf8mb4',
      timezone: 'Z',
    };
  }
  return parseDatabaseUrl(env.DATABASE_URL);
}

declare global {
  // eslint-disable-next-line no-var
  var __wattnexaPool: mysql.Pool | undefined;
}

/** Reuse the pool across hot reloads so tsx watch does not leak connections. */
export const dbConfig = resolveDatabaseConfig();

export const pool =
  globalThis.__wattnexaPool ??
  mysql.createPool({
    ...dbConfig,
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
