import { pgTable, text } from 'drizzle-orm/pg-core';
import { tstz } from '../types.ts';

export const workerHeartbeat = pgTable('worker_heartbeat', {
  worker: text().primaryKey(),
  instanceId: text().notNull(),
  beatAt: tstz().notNull(),
}).enableRLS();
