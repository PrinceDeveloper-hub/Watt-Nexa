import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from the package directory; the shared .env lives at the
// monorepo root.
loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'mysql',
  verbose: true,
  strict: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://wattnexa:wattnexa@localhost:3306/wattnexa',
  },
});
