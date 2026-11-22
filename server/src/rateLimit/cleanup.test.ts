import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { rateLimitBucket } from '../db/schema/index.ts';
import { cleanupRateLimits } from './cleanup.ts';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

test('deletes buckets older than one day and keeps newer ones', async () => {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const hour = 3_600_000;
  await t.db.insert(rateLimitBucket).values([
    { key: 'old', windowStart: new Date(clock.now().getTime() - 25 * hour), count: 1 },
    { key: 'recent', windowStart: new Date(clock.now().getTime() - hour), count: 1 },
  ]);
  await cleanupRateLimits(t.db, clock);
  const rows = await t.db.select().from(rateLimitBucket);
  expect(rows.map((row) => row.key)).toEqual(['recent']);
});
