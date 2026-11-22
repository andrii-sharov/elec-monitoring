import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { tstz } from '../types.ts';

export const workerHeartbeat = pgTable('worker_heartbeat', {
  worker: text().primaryKey(),
  instanceId: text().notNull(),
  beatAt: tstz().notNull(),
}).enableRLS();

export const rateLimitBucket = pgTable(
  'rate_limit_bucket',
  {
    key: text().primaryKey(),
    windowStart: tstz().notNull(),
    count: integer().notNull(),
  },
  (t) => [index('rate_limit_bucket_window_start_idx').on(t.windowStart)],
).enableRLS();
