import { lt } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { rateLimitBucket } from '../db/schema/index.ts';

const RETENTION_MS = 24 * 60 * 60 * 1000;

export async function cleanupRateLimits(db: Db, clock: Clock): Promise<void> {
  const cutoff = new Date(clock.now().getTime() - RETENTION_MS);
  await db.delete(rateLimitBucket).where(lt(rateLimitBucket.windowStart, cutoff));
}
