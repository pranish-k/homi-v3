import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(), // nullable: placeholder members (HOMI-9) have no email
  name: text('name').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// The legacy hand-rolled auth tables (auth_identities, sessions) and
// users.avatar_path expanded out in Sprint 2 (HOMI-2) and contracted in
// the HOMI-22 migration (H7 complete).

// Better Auth tables (HOMI-2, D3). Better Auth owns these rows; sessions
// and identities live in our Postgres so we keep full data ownership.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_auth_sessions_user').on(t.userId)],
);

export const authAccounts = pgTable('auth_accounts', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(), // google | apple | magic-link credential
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'), // unused (no passwords, spec 5.2); required by Better Auth schema
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_auth_verifications_identifier').on(t.identifier)],
);

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

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    name: text('name').notNull(),
    weightBp: integer('weight_bp').notNull(), // basis points; sums to 10000 per house
  },
  (t) => [
    index('idx_rooms_house').on(t.houseId),
    check('chk_rooms_weight_range', sql`${t.weightBp} BETWEEN 1 AND 10000`),
  ],
);

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
  (t) => [
    primaryKey({ columns: [t.houseId, t.userId] }),
    index('idx_house_members_user').on(t.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id),
    tokenHash: text('token_hash').notNull().unique(), // never store raw tokens
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    // HOMI-9: an invite bound to a placeholder carries the claim -
    // accepting it hands the placeholder's history to the claimer in
    // the same atomic accept (H11)
    placeholderUserId: uuid('placeholder_user_id').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses').notNull().default(10),
    uses: integer('uses').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_invites_house').on(t.houseId),
    check('chk_invites_uses_within_max', sql`${t.uses} <= ${t.maxUses}`),
  ],
);
