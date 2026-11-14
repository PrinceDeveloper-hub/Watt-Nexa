import { closeDatabase, db } from './client';
import { sql } from 'drizzle-orm';

const TABLES = [
  'users',
  'homes',
  'household_members',
  'devices',
  'device_telemetry',
  'appliances',
  'appliance_usage',
  'alerts',
  'notifications',
  'automation_rules',
  'wattbot_conversations',
  'wattbot_messages',
  'subscriptions',
  'tariffs',
  'energy_aggregates',
];

async function main() {
  console.log('› Checking database connectivity…');
  const [ping] = await db.execute(sql`SELECT 1 AS ok`);
  console.log('  MariaDB: CONNECTED');

  console.log('› Row counts:');
  for (const table of TABLES) {
    try {
      const result = await db.execute(sql.raw(`SELECT COUNT(*) AS c FROM \`${table}\``));
      const rows = Array.isArray(result) ? result[0] : (result as { rows?: unknown[] }).rows;
      const count = (rows as Array<{ c: number }>)[0]?.c ?? 0;
      console.log(`  ${table.padEnd(28)} ${count}`);
    } catch (err) {
      console.log(`  ${table.padEnd(28)} ERR ${(err as Error).message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error('✗ Database check failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
