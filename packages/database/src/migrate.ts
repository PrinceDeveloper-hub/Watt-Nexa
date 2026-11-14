import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { env } from '@wattnexa/config';
import mysql from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { closeDatabase, db, dbConfig } from './client';

/**
 * `drizzle-kit` assumes the database already exists. Creating it first makes
 * a fresh clone a single command away from a working setup.
 */
export async function ensureDatabase(): Promise<void> {
  const { host, port, user, password, database } = dbConfig;
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Refusing to create unsafe database name: ${database}`);
  }
  const connection = await mysql.createConnection({ host, port, user, password, timezone: 'Z' });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}

export async function runMigrations(): Promise<void> {
  await ensureDatabase();
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runMigrations()
    .then(() => {
      console.log('✓ Migrations applied');
    })
    .catch((error) => {
      console.error('✗ Migration failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabase();
    });
}
