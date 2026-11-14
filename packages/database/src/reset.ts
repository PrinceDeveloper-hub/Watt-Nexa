import { env } from '@wattnexa/config';
import mysql from 'mysql2/promise';
import { closeDatabase, parseDatabaseUrl } from './client';
import { ensureDatabase, runMigrations } from './migrate';
import { seed } from './seed';

/**
 * Drops every table in the configured database, re-applies migrations and
 * reseeds. Local development only.
 */
export async function resetDatabase(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a production database');
  }
  const { host, port, user, password, database } = parseDatabaseUrl(env.DATABASE_URL);
  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    timezone: 'Z',
  });
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
    const key = `Tables_in_${database}`;
    const tables = rows
      .map((row) => (row[key] ?? Object.values(row)[0]) as string | undefined)
      .filter((name): name is string => Boolean(name));

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }
  await ensureDatabase();
  await runMigrations();
  await seed();
}

resetDatabase()
  .then(() => console.log('✓ Database reset'))
  .catch((error) => {
    console.error('✗ Reset failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
