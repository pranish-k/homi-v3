import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { houses, users } from './identity';

// Ledger tables are append-only for money truth (spec 5.4 invariant 1):
// soft delete only, every edit writes a revision.

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    description: text('description').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    paidBy: uuid('paid_by')
      .notNull()
      .references(() => users.id),
    category: text('category'),
    isStaple: boolean('is_staple').notNull().default(false),
    receiptPath: text('receipt_path'),
    templateId: uuid('template_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_expenses_house').on(t.houseId),
    check('chk_expenses_amount_positive', sql`${t.amountCents} > 0`),
  ],
);

export const expenseSplits = pgTable(
  'expense_splits',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.userId] }),
    index('idx_expense_splits_user').on(t.userId),
    check('chk_expense_splits_amount_nonnegative', sql`${t.amountCents} >= 0`),
  ],
);

export const expenseRevisions = pgTable('expense_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id')
    .notNull()
    .references(() => expenses.id),
  changedBy: uuid('changed_by')
    .notNull()
    .references(() => users.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  previous: jsonb('previous').notNull(),
});

export const billTemplates = pgTable('bill_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  houseId: uuid('house_id')
    .notNull()
    .references(() => houses.id),
  description: text('description').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  splitMode: text('split_mode').notNull(), // equal | exact | percent | room_weighted
  splitConfig: jsonb('split_config'),
  cadence: text('cadence').notNull(), // monthly | weekly
  cadenceDay: text('cadence_day').notNull(),
  nextRun: date('next_run').notNull(),
  active: boolean('active').notNull().default(true),
});

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    fromUser: uuid('from_user')
      .notNull()
      .references(() => users.id),
    toUser: uuid('to_user')
      .notNull()
      .references(() => users.id),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    method: text('method'), // venmo | zelle | cash_app | cash | other
    status: text('status').notNull().default('recorded'), // recorded | disputed | resolved
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_payments_house').on(t.houseId),
    check('chk_payments_amount_positive', sql`${t.amountCents} > 0`),
    check('chk_payments_distinct_parties', sql`${t.fromUser} <> ${t.toUser}`),
  ],
);

// H1: server-side idempotency. Scoped to (key, user, endpoint) so one
// user's stored response can never be replayed to another user or from
// a different endpoint; request_hash rejects key reuse with a changed
// body.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: uuid('key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: bigint('response_status', { mode: 'number' }).notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.userId, t.endpoint] })],
);

// Single append-only feed: HOME feed, realtime fan-out, audit trail.
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_activity_events_house_created').on(t.houseId, t.createdAt)],
);
