import {
  boolean,
  char,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  name: text('name').notNull(),
  avatarPath: text('avatar_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  provider: text('provider').notNull(), // apple | google | magic_link
  providerUid: text('provider_uid').notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  refreshHash: text('refresh_hash').notNull(),
  device: text('device'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const houses = pgTable('houses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  houseId: uuid('house_id')
    .notNull()
    .references(() => houses.id),
  name: text('name').notNull(),
  weightBp: integer('weight_bp').notNull(), // basis points; sums to 10000 per house
});

export const houseMembers = pgTable(
  'house_members',
  {
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'), // admin | member
    displayName: text('display_name'),
    isPlaceholder: boolean('is_placeholder').notNull().default(false),
    claimedBy: uuid('claimed_by').references(() => users.id),
    roomId: uuid('room_id').references(() => rooms.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }), // deactivated, never deleted (invariant 5)
  },
  (t) => [primaryKey({ columns: [t.houseId, t.userId] })],
);

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  houseId: uuid('house_id')
    .notNull()
    .references(() => houses.id),
  tokenHash: text('token_hash').notNull().unique(), // never store raw tokens
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(10),
  uses: integer('uses').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
