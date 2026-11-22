import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export { schema };

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDb(url: string): { db: Db; close(): Promise<void> } {
  const client = postgres(url, { prepare: false, connect_timeout: 5, max: 10 });
  const db = drizzle({ client, schema, casing: 'snake_case' });
  return { db, close: () => client.end({ timeout: 5 }) };
}
