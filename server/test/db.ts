import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle as pgDrizzle } from 'drizzle-orm/postgres-js';
import { migrate as pgMigrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { migrationsFolder, schema, type Db } from '../src/db/client.ts';

export type TestDb = { db: Db; client: PGlite; close(): Promise<void> };

export async function createTestDb(
  beforeMigrate?: (client: PGlite) => Promise<void>,
): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await beforeMigrate?.(client);
  await migrate(db, { migrationsFolder });
  return { db, client, close: () => client.close() };
}

export const pgTestUrl = process.env.TEST_DATABASE_URL;

export type PgTestDb = { db: Db; url: string; sql: postgres.Sql; close(): Promise<void> };

export async function createPgTestDb(
  beforeMigrate?: (sql: postgres.Sql) => Promise<void>,
): Promise<PgTestDb> {
  if (!pgTestUrl) throw new Error('TEST_DATABASE_URL is not set');
  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(pgTestUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(pgTestUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { prepare: false, max: 5, onnotice: () => {} });
  const db = pgDrizzle({ client: sql, schema, casing: 'snake_case' });
  await beforeMigrate?.(sql);
  await pgMigrate(db, { migrationsFolder });
  return {
    db,
    url: url.toString(),
    sql,
    close: async () => {
      await sql.end();
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}
