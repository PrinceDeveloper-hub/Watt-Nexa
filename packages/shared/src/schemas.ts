import { z } from 'zod';

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO-8601 timestamp',
});

const optionalMeasure = z
  .union([z.coerce.number(), z.null()])
  .optional()
  .transform((value) => (value === undefined ? null : value));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(false),
});

export const verifyEmailSchema = z.object({
  code: z.string().trim().length(6, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(10),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().length(3).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  sortBy: z.string().trim().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const homeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['home', 'apartment', 'office', 'shop', 'other']).default('home'),
  address: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).default('India'),
  timezone: z.string().trim().max(64).default('Asia/Kolkata'),
});

export const deviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  room: z.string().trim().max(80).nullable().optional(),
  homeId: z.string().uuid().optional(),
});

export const devicePairSchema = z.object({
  code: z.string().trim().min(4).max(32),
  homeId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  /** Serial printed on the unit; required to recognise the device later. */
  serial: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits and dashes only')
    .optional(),
});

export const telemetryPayloadSchema = z.object({
  voltage: optionalMeasure,
  current: optionalMeasure,
  active_power: optionalMeasure,
  apparent_power: optionalMeasure,
  power_factor: optionalMeasure,
  energy_kwh: optionalMeasure,
  temperature: optionalMeasure,
  frequency: optionalMeasure,
  signal_strength: optionalMeasure,
  device_status: z.enum(['online', 'connecting', 'offline', 'error']).optional(),
  firmware_version: z.string().max(40).optional(),
  /** Idempotency key so a redelivered MQTT message is stored once. */
  message_id: z.string().trim().min(1).max(64).optional(),
  timestamp: isoDateTime.optional(),
  /** Rejects payloads that carry no measurement at all. */
}).refine(
  (value) =>
    [
      value.voltage,
      value.current,
      value.active_power,
      value.apparent_power,
      value.power_factor,
      value.energy_kwh,
      value.temperature,
      value.frequency,
      value.signal_strength,
    ].some((measurement) => measurement != null),
  { message: 'Telemetry must include at least one measurement' },
);

export const tariffSlabSchema = z.object({
  minKwh: z.coerce.number().min(0),
  maxKwh: z.coerce.number().min(0).nullable(),
  ratePerKwh: z.coerce.number().min(0),
});

export const tariffSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  currency: z.string().trim().length(3).default('INR'),
  fixedCharge: z.coerce.number().min(0).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  slabs: z.array(tariffSlabSchema).min(1, 'At least one tariff slab is required'),
});

export const applianceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40),
  brand: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  installationDate: z.string().trim().optional(),
  ratedPowerW: z.coerce.number().min(0).max(100_000).optional(),
  estimatedHoursPerDay: z.coerce.number().min(0).max(24).default(1),
  isMeasured: z.boolean().default(false),
  homeId: z.string().uuid(),
});

export const alertThresholdsSchema = z.object({
  powerW: z.coerce.number().min(0).nullable().optional(),
  temperatureC: z.coerce.number().nullable().optional(),
  dailyKwh: z.coerce.number().min(0).nullable().optional(),
  monthlyKwh: z.coerce.number().min(0).nullable().optional(),
  billAmount: z.coerce.number().min(0).nullable().optional(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
});

export const wattbotPageSchema = z.enum([
  'dashboard',
  'energy',
  'devices',
  'billing',
  'alerts',
  'settings',
  'admin',
  'other',
]);

export type WattbotPage = z.infer<typeof wattbotPageSchema>;

/** Only the current screen name is sent; no readings or page contents. */
export const wattbotContextSchema = z.object({
  page: wattbotPageSchema.optional(),
});

export type WattbotContext = z.infer<typeof wattbotContextSchema>;

export const wattbotMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  context: wattbotContextSchema.optional(),
});

export const dateRangeSchema = z.object({
  range: z
    .enum([
      'today',
      'yesterday',
      'last_7_days',
      'last_30_days',
      'last_90_days',
      'this_month',
      'previous_month',
      'custom',
    ])
    .default('last_7_days'),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  bucket: z.enum(['hour', 'day', 'month']).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TariffFormInput = z.infer<typeof tariffSchema>;
export type HomeInput = z.infer<typeof homeSchema>;
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;
