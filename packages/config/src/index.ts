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

/** Empty strings in .env mean "not set" rather than an invalid URL. */
const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value))
  .pipe(z.string().url().optional());

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

  // Database connection details (preferred over DATABASE_URL when all are set).
  DB_HOST: z.string().trim().optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_USER: z.string().trim().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().trim().optional(),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z.string().default('false').pipe(booleanish),
  /**
   * 'lax' for same-site deployments (local, or web + api on one domain).
   * 'none' is required when the web app and API live on different sites
   * (e.g. Vercel frontend + VPS API); it forces Secure cookies.
   */
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
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
  /** Override for gateways, proxies and the local mock used in verification. */
  OPENAI_BASE_URL: optionalUrl,
  ANTHROPIC_BASE_URL: optionalUrl,
  /** Hard ceiling per provider request; on timeout WattBot answers from data alone. */
  WATTBOT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  /** Prior messages sent as context. Older turns stay in the database. */
  WATTBOT_CONTEXT_MESSAGES: z.coerce.number().int().min(0).max(40).default(10),
  WATTBOT_MAX_TOKENS: z.coerce.number().int().min(100).max(4000).default(700),
  WATTBOT_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),
  /** Semantic retrieval is optional; lexical retrieval always remains. */
  WATTBOT_EMBEDDING_PROVIDER: z.enum(['none', 'openai']).default('none'),
  WATTBOT_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  WATTBOT_RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.28),

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
