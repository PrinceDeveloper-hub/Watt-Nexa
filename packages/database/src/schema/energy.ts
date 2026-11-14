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
    /**
     * not_configured — paired but never reported; connecting — handshake seen,
     * no reading yet; online/offline/error are driven by real traffic only.
     */
    status: mysqlEnum('status', ['online', 'offline', 'connecting', 'not_configured', 'error'])
      .notNull()
      .default('not_configured'),
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
    /** Firmware-supplied idempotency key; MQTT QoS 1 may redeliver a message. */
    messageId: varchar('message_id', { length: 64 }),
    source: mysqlEnum('source', ['hardware', 'simulated']).notNull().default('hardware'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_telemetry_device_time').on(table.deviceId, table.recordedAt),
    index('idx_telemetry_recorded').on(table.recordedAt),
    // MySQL allows repeated NULLs, so devices without a message id still insert.
    uniqueIndex('uq_telemetry_device_message').on(table.deviceId, table.messageId),
  ],
);

/**
 * Connection and lifecycle history. Append-only: the device page shows it as
 * the connection timeline, so entries are never rewritten after the fact.
 */
export const deviceEvents = mysqlTable(
  'device_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    deviceId: char('device_id', { length: 36 })
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', [
      'paired',
      'connected',
      'reconnected',
      'disconnected',
      'error',
      'credential_issued',
      'credential_revoked',
      'telemetry_rejected',
      'status_changed',
    ]).notNull(),
    message: varchar('message', { length: 240 }),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_device_events_device_time').on(table.deviceId, table.occurredAt),
    index('idx_device_events_type').on(table.type),
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
    distributor: varchar('distributor', { length: 120 }),
    region: varchar('region', { length: 120 }),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    fixedCharge: double('fixed_charge').notNull().default(0),
    taxPercent: double('tax_percent').notNull().default(0),
    dutyRate: double('duty_rate').notNull().default(0),
    effectiveFrom: timestamp('effective_from', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { mode: 'date', fsp: 3 }),
    sourceReference: varchar('source_reference', { length: 255 }),
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
    fixedCharge: double('fixed_charge').notNull().default(0),
    duty: double('duty').notNull().default(0),
    rebate: double('rebate').notNull().default(0),
    distributor: varchar('distributor', { length: 120 }),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    status: mysqlEnum('status', ['estimated', 'actual']).notNull().default('estimated'),
    breakdown: json('breakdown').$type<Record<string, unknown>>(),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [index('idx_bills_home_period').on(table.homeId, table.periodStart)],
);

export const billCorrections = mysqlTable(
  'bill_corrections',
  {
    id: char('id', { length: 36 }).primaryKey(),
    billId: char('bill_id', { length: 36 })
      .notNull()
      .references(() => electricityBills.id, { onDelete: 'cascade' }),
    householdId: char('household_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    editedBy: char('edited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    previousAmount: double('previous_amount'),
    newAmount: double('new_amount'),
    previousUnits: double('previous_units'),
    newUnits: double('new_units'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_bill_corrections_bill').on(table.billId)],
);

export const appliances = mysqlTable(
  'appliances',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    category: varchar('category', { length: 40 }).notNull().default('other'),
    brand: varchar('brand', { length: 120 }).notNull().default(''),
    model: varchar('model', { length: 120 }).notNull().default(''),
    installationDate: timestamp('installation_date', { mode: 'date', fsp: 3 }),
    ratedPowerW: double('rated_power_w').notNull().default(0),
    estimatedHoursPerDay: double('estimated_hours_per_day').notNull().default(0),
    /**
     * true only when usage is backed by measured data.
     */
    isMeasured: boolean('is_measured').notNull().default(false),
    lastServiceDate: timestamp('last_service_date', { mode: 'date', fsp: 3 }),
    recommendedServiceIntervalDays: int('recommended_service_interval_days').notNull().default(30),
    maintenanceNotes: text('maintenance_notes'),
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
