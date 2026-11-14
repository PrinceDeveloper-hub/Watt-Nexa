import {
  bigint,
  boolean,
  char,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { softDelete, timestamps } from './_columns';
import { users } from './core';

export const homes = mysqlTable(
  'homes',
  {
    id: char('id', { length: 36 }).primaryKey(),
    ownerId: char('owner_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    type: mysqlEnum('type', ['home', 'apartment', 'office', 'shop', 'other'])
      .notNull()
      .default('home'),
    address: varchar('address', { length: 240 }),
    city: varchar('city', { length: 80 }),
    region: varchar('region', { length: 80 }),
    country: varchar('country', { length: 80 }).notNull().default('India'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [index('idx_homes_owner').on(table.ownerId)],
);

export const householdMembers = mysqlTable(
  'household_members',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    userId: char('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }),
    invitedEmail: varchar('invited_email', { length: 255 }),
    role: mysqlEnum('role', ['owner', 'admin', 'viewer']).notNull().default('viewer'),
    status: mysqlEnum('status', ['active', 'invited', 'revoked']).notNull().default('active'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_members_home_user').on(table.homeId, table.userId),
    index('idx_members_user').on(table.userId),
  ],
);

export const devices = mysqlTable(
  'devices',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    ownerId: char('owner_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    serial: varchar('serial', { length: 64 }).notNull(),
    model: varchar('model', { length: 64 }).notNull().default('WattNexa CT-1'),
    room: varchar('room', { length: 80 }),
    firmwareVersion: varchar('firmware_version', { length: 40 }),
    status: mysqlEnum('status', ['online', 'offline', 'pairing', 'error'])
      .notNull()
      .default('pairing'),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date', fsp: 3 }),
    lastReadingAt: timestamp('last_reading_at', { mode: 'date', fsp: 3 }),
    signalStrength: smallint('signal_strength'),
    pairingCode: varchar('pairing_code', { length: 32 }),
    pairingExpiresAt: timestamp('pairing_expires_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('uq_devices_serial').on(table.serial),
    uniqueIndex('uq_devices_pairing_code').on(table.pairingCode),
    index('idx_devices_home').on(table.homeId),
    index('idx_devices_owner').on(table.ownerId),
    index('idx_devices_status').on(table.status),
  ],
);

export const deviceCredentials = mysqlTable(
  'device_credentials',
  {
    id: char('id', { length: 36 }).primaryKey(),
    deviceId: char('device_id', { length: 36 })
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    label: varchar('label', { length: 80 }).notNull().default('Primary credential'),
    lastUsedAt: timestamp('last_used_at', { mode: 'date', fsp: 3 }),
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }),
    revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_device_credentials_token').on(table.tokenHash),
    index('idx_device_credentials_device').on(table.deviceId),
  ],
);

export const devicePairings = mysqlTable(
  'device_pairings',
  {
    id: char('id', { length: 36 }).primaryKey(),
    code: varchar('code', { length: 32 }).notNull(),
    claimedBy: char('claimed_by', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    deviceId: char('device_id', { length: 36 }).references(() => devices.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    claimedAt: timestamp('claimed_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_pairings_code').on(table.code)],
);

/**
 * Raw telemetry. Optionally-null measurement columns are genuinely
 * unavailable values (e.g. no voltage sensing) — never zero-filled.
 */
export const deviceTelemetry = mysqlTable(
  'device_telemetry',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    deviceId: char('device_id', { length: 36 })
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    recordedAt: timestamp('recorded_at', { mode: 'date', fsp: 3 }).notNull(),
    voltage: double('voltage'),
    current: double('current'),
    activePower: double('active_power'),
    apparentPower: double('apparent_power'),
    powerFactor: double('power_factor'),
    energyKwh: double('energy_kwh'),
    temperature: double('temperature'),
    frequency: double('frequency'),
    signalStrength: smallint('signal_strength'),
    source: mysqlEnum('source', ['hardware', 'simulated']).notNull().default('hardware'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_telemetry_device_time').on(table.deviceId, table.recordedAt),
    index('idx_telemetry_recorded').on(table.recordedAt),
  ],
);

export const energyAggregates = mysqlTable(
  'energy_aggregates',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    deviceId: char('device_id', { length: 36 })
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    bucket: mysqlEnum('bucket', ['hour', 'day', 'month']).notNull(),
    bucketStart: timestamp('bucket_start', { mode: 'date', fsp: 3 }).notNull(),
    energyKwh: double('energy_kwh').notNull().default(0),
    peakPowerW: double('peak_power_w').notNull().default(0),
    averagePowerW: double('average_power_w').notNull().default(0),
    sampleCount: int('sample_count').notNull().default(0),
    source: mysqlEnum('source', ['hardware', 'simulated']).notNull().default('hardware'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_aggregates_device_bucket').on(table.deviceId, table.bucket, table.bucketStart),
    index('idx_aggregates_home_bucket').on(table.homeId, table.bucket, table.bucketStart),
  ],
);

export const tariffs = mysqlTable(
  'tariffs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    provider: varchar('provider', { length: 120 }),
    region: varchar('region', { length: 120 }),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    fixedCharge: double('fixed_charge').notNull().default(0),
    taxPercent: double('tax_percent').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [index('idx_tariffs_home').on(table.homeId)],
);

export const tariffSlabs = mysqlTable(
  'tariff_slabs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    tariffId: char('tariff_id', { length: 36 })
      .notNull()
      .references(() => tariffs.id, { onDelete: 'cascade' }),
    minKwh: double('min_kwh').notNull().default(0),
    /** null = unbounded upper slab */
    maxKwh: double('max_kwh'),
    ratePerKwh: double('rate_per_kwh').notNull(),
    sortOrder: int('sort_order').notNull().default(0),
  },
  (table) => [index('idx_tariff_slabs_tariff').on(table.tariffId, table.sortOrder)],
);

export const electricityBills = mysqlTable(
  'electricity_bills',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    tariffId: char('tariff_id', { length: 36 }).references(() => tariffs.id, {
      onDelete: 'set null',
    }),
    periodStart: timestamp('period_start', { mode: 'date', fsp: 3 }).notNull(),
    periodEnd: timestamp('period_end', { mode: 'date', fsp: 3 }).notNull(),
    energyKwh: double('energy_kwh').notNull().default(0),
    estimatedCost: double('estimated_cost').notNull().default(0),
    actualCost: double('actual_cost'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    status: mysqlEnum('status', ['estimated', 'actual']).notNull().default('estimated'),
    breakdown: json('breakdown').$type<Record<string, unknown>>(),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [index('idx_bills_home_period').on(table.homeId, table.periodStart)],
);

export const appliances = mysqlTable(
  'appliances',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    ratedPowerW: double('rated_power_w').notNull().default(0),
    estimatedHoursPerDay: double('estimated_hours_per_day').notNull().default(0),
    /** true only when usage is backed by measured data */
    isMeasured: boolean('is_measured').notNull().default(false),
    ...timestamps,
    ...softDelete,
  },
  (table) => [index('idx_appliances_home').on(table.homeId)],
);

export const applianceUsage = mysqlTable(
  'appliance_usage',
  {
    id: char('id', { length: 36 }).primaryKey(),
    applianceId: char('appliance_id', { length: 36 })
      .notNull()
      .references(() => appliances.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { mode: 'date', fsp: 3 }).notNull(),
    periodEnd: timestamp('period_end', { mode: 'date', fsp: 3 }).notNull(),
    estimatedKwh: double('estimated_kwh').notNull().default(0),
    allocatedKwh: double('allocated_kwh'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_appliance_usage_period').on(table.applianceId, table.periodStart)],
);
