import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../../lib/crypto.ts';
import { bytea, tstz } from '../types.ts';

export const appUser = pgTable(
  'app_user',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    email: text().notNull().unique('app_user_email_key'),
    emailVerifiedAt: tstz(),
    passwordHash: text(),
    googleSub: text().unique('app_user_google_sub_key'),
    name: text().notNull(),
    language: text().notNull().default('uk'),
    timezone: text().notNull().default('Europe/Kyiv'),
    isAdmin: boolean().notNull().default(false),
    createdAt: tstz().notNull().defaultNow(),
    updatedAt: tstz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [
    check('app_user_email_check', sql`email = lower(email)`),
    check('app_user_language_check', sql`language in ('uk', 'en', 'ru')`),
    check(
      'app_user_sign_in_method_check',
      sql`password_hash is not null or google_sub is not null`,
    ),
  ],
).enableRLS();

export const session = pgTable(
  'session',
  {
    id: uuid().primaryKey().$defaultFn(newId),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    createdAt: tstz().notNull().defaultNow(),
    lastUsedAt: tstz().notNull().defaultNow(),
    revokedAt: tstz(),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
).enableRLS();

export const refreshToken = pgTable(
  'refresh_token',
  {
    tokenHash: bytea().primaryKey(),
    sessionId: uuid()
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    expiresAt: tstz().notNull(),
    usedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    check('refresh_token_token_hash_check', sql`octet_length(token_hash) = 32`),
    index('refresh_token_session_id_idx').on(t.sessionId),
  ],
).enableRLS();

export const oneTimeToken = pgTable(
  'one_time_token',
  {
    tokenHash: bytea().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    purpose: text().notNull(),
    expiresAt: tstz().notNull(),
    usedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    check('one_time_token_token_hash_check', sql`octet_length(token_hash) = 32`),
    check(
      'one_time_token_purpose_check',
      sql`purpose in ('VERIFY_EMAIL', 'RESET_PASSWORD', 'TELEGRAM_LINK')`,
    ),
    index('one_time_token_user_id_idx').on(t.userId, t.purpose),
  ],
).enableRLS();
