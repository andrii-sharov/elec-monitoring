import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ConfigError, loadConfig } from '../config.ts';
import { migrationsFolder } from './client.ts';

try {
  const config = loadConfig(process.env);
  const client = postgres(config.databaseUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
    console.info('migrations applied');
  } finally {
    await client.end();
  }
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exitCode = 1;
}
