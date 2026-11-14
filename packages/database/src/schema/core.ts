import {
  boolean,
  char,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { softDelete, timestamps } from './_columns';

export const users = mysqlTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    role: mysqlEnum('role', ['user', 'admin', 'super_admin', 'support_agent'])
      .notNull()
      .default('user'),
    emailVerifiedAt: timestamp('email_verified_at', { mode: 'date', fsp: 3 }),
    avatarUrl: varchar('avatar_url', { length: 512 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    isSuspended: boolean('is_suspended').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('uq_users_email').on(table.email),
    index('idx_users_role').on(table.role),
    index('idx_users_created_at').on(table.createdAt),
  ],
);

export const userSessions = mysqlTable(
  'user_sessions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the refresh token — the raw token never touches the DB. */
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 512 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    rememberMe: boolean('remember_me').notNull().default(false),
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_sessions_token').on(table.tokenHash),
    index('idx_sessions_user').on(table.userId, table.expiresAt),
  ],
);

export const emailVerifications = mysqlTable(
  'email_verifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: char('code_hash', { length: 64 }).notNull(),
    purpose: mysqlEnum('purpose', ['email_verify', 'login_otp']).notNull().default('email_verify'),
    attempts: int('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    consumedAt: timestamp('consumed_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index('idx_verifications_user').on(table.userId, table.purpose)],
);

export const passwordResets = mysqlTable(
  'password_resets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    usedAt: timestamp('used_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_password_resets_token').on(table.tokenHash),
    index('idx_password_resets_user').on(table.userId),
  ],
);
