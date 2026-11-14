import {
  boolean,
  char,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { softDelete, timestamps } from './_columns';
import { users } from './core';
import { devices, homes } from './energy';

export const alerts = mysqlTable(
  'alerts',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    homeId: char('home_id', { length: 36 }).references(() => homes.id, { onDelete: 'cascade' }),
    deviceId: char('device_id', { length: 36 }).references(() => devices.id, {
      onDelete: 'cascade',
    }),
    type: mysqlEnum('type', [
      'high_power',
      'unusual_consumption',
      'device_offline',
      'device_online',
      'high_temperature',
      'daily_threshold',
      'monthly_threshold',
      'bill_threshold',
      'device_error',
      'firmware_update',
      'account',
    ]).notNull(),
    severity: mysqlEnum('severity', ['info', 'warning', 'critical']).notNull().default('warning'),
    title: varchar('title', { length: 160 }).notNull(),
    message: text('message').notNull(),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    acknowledgedAt: timestamp('acknowledged_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_alerts_user_created').on(table.userId, table.createdAt),
    index('idx_alerts_home_created').on(table.homeId, table.createdAt),
  ],
);

export const notificationPreferences = mysqlTable('notification_preferences', {
  userId: char('user_id', { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  pushEnabled: boolean('push_enabled').notNull().default(false),
  powerThresholdW: double('power_threshold_w'),
  temperatureThresholdC: double('temperature_threshold_c'),
  dailyKwhThreshold: double('daily_kwh_threshold'),
  monthlyKwhThreshold: double('monthly_kwh_threshold'),
  billThreshold: double('bill_threshold'),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
});

export const notifications = mysqlTable(
  'notifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alertId: char('alert_id', { length: 36 }).references(() => alerts.id, { onDelete: 'set null' }),
    channel: mysqlEnum('channel', ['in_app', 'email', 'push']).notNull().default('in_app'),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_notifications_user_created').on(table.userId, table.createdAt)],
);

/**
 * Approved WattBot product knowledge, split into retrieval-sized chunks.
 * Vectors live alongside the text in MariaDB; the corpus is small enough to
 * score in process, so no separate vector service is required.
 */
export const wattbotKnowledgeChunks = mysqlTable(
  'wattbot_knowledge_chunks',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** Stable identity so a document update replaces its chunk in place. */
    chunkKey: varchar('chunk_key', { length: 200 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    source: varchar('source', { length: 160 }).notNull(),
    content: text('content').notNull(),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    embedding: json('embedding').$type<number[]>(),
    embeddingModel: varchar('embedding_model', { length: 80 }),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_wattbot_knowledge_chunk').on(table.chunkKey)],
);

export const automationRules = mysqlTable(
  'automation_rules',
  {
    id: char('id', { length: 36 }).primaryKey(),
    homeId: char('home_id', { length: 36 })
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    triggerType: mysqlEnum('trigger_type', [
      'power_above',
      'temperature_above',
      'device_offline',
      'daily_summary',
      'monthly_usage_above',
    ]).notNull(),
    threshold: double('threshold'),
    actionType: mysqlEnum('action_type', ['notify', 'email', 'summary']).notNull().default('notify'),
    message: varchar('message', { length: 240 }),
    isActive: boolean('is_active').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
  },
  (table) => [index('idx_automation_home').on(table.homeId)],
);

export const automationExecutions = mysqlTable(
  'automation_executions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    ruleId: char('rule_id', { length: 36 })
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    status: mysqlEnum('status', ['success', 'skipped', 'failed']).notNull().default('success'),
    detail: varchar('detail', { length: 320 }),
    executedAt: timestamp('executed_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_executions_rule').on(table.ruleId, table.executedAt)],
);

export const wattbotConversations = mysqlTable(
  'wattbot_conversations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 160 }).notNull().default('New conversation'),
    ...timestamps,
  },
  (table) => [index('idx_conversations_user').on(table.userId, table.updatedAt)],
);

export const wattbotMessages = mysqlTable(
  'wattbot_messages',
  {
    id: char('id', { length: 36 }).primaryKey(),
    conversationId: char('conversation_id', { length: 36 })
      .notNull()
      .references(() => wattbotConversations.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', ['user', 'assistant']).notNull(),
    content: text('content').notNull(),
    /** provider used: rule_based | openai | anthropic */
    provider: varchar('provider', { length: 40 }).notNull().default('rule_based'),
    /** Model, latency, fallback reason — never the prompt or any credential. */
    metadata: json('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_messages_conversation').on(table.conversationId, table.createdAt)],
);

export const subscriptionPlans = mysqlTable(
  'subscription_plans',
  {
    id: char('id', { length: 36 }).primaryKey(),
    slug: varchar('slug', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 240 }),
    priceMonthly: double('price_monthly').notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    maxHomes: int('max_homes').notNull().default(1),
    maxDevices: int('max_devices').notNull().default(1),
    historyDays: int('history_days').notNull().default(7),
    wattbotMessagesPerDay: int('wattbot_messages_per_day').notNull().default(0),
    features: json('features').$type<string[]>(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: int('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('uq_plans_slug').on(table.slug)],
);

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: char('plan_id', { length: 36 })
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    status: mysqlEnum('status', ['active', 'trialing', 'past_due', 'canceled'])
      .notNull()
      .default('active'),
    currentPeriodStart: timestamp('current_period_start', { mode: 'date', fsp: 3 }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { mode: 'date', fsp: 3 }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** Provider-agnostic: 'sandbox' until a real gateway is configured. */
    provider: varchar('provider', { length: 40 }).notNull().default('sandbox'),
    providerRef: varchar('provider_ref', { length: 120 }),
    ...timestamps,
  },
  (table) => [index('idx_subscriptions_user').on(table.userId)],
);

export const invoices = mysqlTable(
  'invoices',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: char('subscription_id', { length: 36 }).references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    number: varchar('number', { length: 40 }).notNull(),
    amount: double('amount').notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    status: mysqlEnum('status', ['draft', 'open', 'paid', 'void']).notNull().default('open'),
    issuedAt: timestamp('issued_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_invoices_number').on(table.number),
    index('idx_invoices_user').on(table.userId),
  ],
);

export const payments = mysqlTable(
  'payments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    invoiceId: char('invoice_id', { length: 36 })
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull().default('sandbox'),
    providerRef: varchar('provider_ref', { length: 120 }),
    amount: double('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    /** 'simulated' explicitly marks sandbox records — never a real capture. */
    status: mysqlEnum('status', ['pending', 'succeeded', 'failed', 'refunded', 'simulated'])
      .notNull()
      .default('pending'),
    method: varchar('method', { length: 40 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_payments_invoice').on(table.invoiceId)],
);

export const supportTickets = mysqlTable(
  'support_tickets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 160 }).notNull(),
    category: mysqlEnum('category', ['billing', 'device', 'account', 'technical', 'other'])
      .notNull()
      .default('other'),
    priority: mysqlEnum('priority', ['low', 'normal', 'high', 'urgent']).notNull().default('normal'),
    status: mysqlEnum('status', ['open', 'pending', 'resolved', 'closed'])
      .notNull()
      .default('open'),
    assignedTo: char('assigned_to', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [index('idx_tickets_user').on(table.userId, table.status)],
);

export const supportMessages = mysqlTable(
  'support_messages',
  {
    id: char('id', { length: 36 }).primaryKey(),
    ticketId: char('ticket_id', { length: 36 })
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorId: char('author_id', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    attachmentUrl: varchar('attachment_url', { length: 512 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_support_messages_ticket').on(table.ticketId, table.createdAt)],
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    actorId: char('actor_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    resourceType: varchar('resource_type', { length: 60 }).notNull(),
    resourceId: varchar('resource_id', { length: 64 }),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_audit_created').on(table.createdAt)],
);

export const announcements = mysqlTable('announcements', {
  id: char('id', { length: 36 }).primaryKey(),
  title: varchar('title', { length: 160 }).notNull(),
  body: text('body').notNull(),
  level: mysqlEnum('level', ['info', 'warning', 'critical']).notNull().default('info'),
  isActive: boolean('is_active').notNull().default(true),
  publishedAt: timestamp('published_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  ...timestamps,
});

export const blogPosts = mysqlTable(
  'blog_posts',
  {
    id: char('id', { length: 36 }).primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    excerpt: varchar('excerpt', { length: 400 }).notNull(),
    content: text('content').notNull(),
    coverImage: varchar('cover_image', { length: 512 }),
    authorId: char('author_id', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    status: mysqlEnum('status', ['draft', 'published']).notNull().default('draft'),
    publishedAt: timestamp('published_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex('uq_blog_slug').on(table.slug)],
);

export const faqs = mysqlTable('faqs', {
  id: char('id', { length: 36 }).primaryKey(),
  question: varchar('question', { length: 240 }).notNull(),
  answer: text('answer').notNull(),
  category: varchar('category', { length: 60 }).notNull().default('general'),
  isPublished: boolean('is_published').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  ...timestamps,
});

export const systemSettings = mysqlTable('system_settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: json('value').$type<unknown>().notNull(),
  description: varchar('description', { length: 240 }),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
});
