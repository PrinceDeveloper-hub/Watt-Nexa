import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Walk up from the current working directory and load the first .env found.
 * Allows `pnpm --filter @wattnexa/api dev` (cwd=apps/api) to pick up the
 * monorepo root .env without duplicating files per app.
 */
function loadEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnvFile();

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const booleanish = z
  .string()
  .transform((value) => value.toLowerCase() === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173').transform(csv),

  DATABASE_URL: z
    .string()
    .default('mysql://wattnexa:wattnexa@localhost:3306/wattnexa'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z.string().default('false').pipe(booleanish),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('WattNexa <no-reply@wattnexa.local>'),

  MQTT_ENABLED: z.string().default('false').pipe(booleanish),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('wattnexa'),

  SENSOR_MODE: z.enum(['simulated', 'hardware']).default('simulated'),
  OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(120),

  WATTBOT_PROVIDER: z.enum(['none', 'openai', 'anthropic']).default('none'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-latest'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Where the server says "WattNexa" lives — used for emails and reports. */
export const brand = {
  name: 'WattNexa',
  tagline: 'Know exactly where your electricity bill is going.',
} as const;
