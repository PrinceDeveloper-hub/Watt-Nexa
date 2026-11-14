import { timestamp } from 'drizzle-orm/mysql-core';

/** Every table stores UTC; the client converts to the user's timezone. */
export const timestamps = {
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull().defaultNow().onUpdateNow(),
};

export const softDelete = {
  deletedAt: timestamp('deleted_at', { mode: 'date', fsp: 3 }),
};
