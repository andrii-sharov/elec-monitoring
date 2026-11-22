import { afterAll, beforeAll, expect, test } from 'vitest';
import { workerHeartbeat } from '../db/schema/index.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { beat } from './heartbeat.ts';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

test('upserts one row per worker with the clock time', async () => {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  await beat(t.db, clock, 'main', 'host-a:1');
  clock.advance(10_000);
  await beat(t.db, clock, 'main', 'host-b:2');

  const rows = await t.db.select().from(workerHeartbeat);
  expect(rows).toEqual([
    { worker: 'main', instanceId: 'host-b:2', beatAt: new Date('2026-11-21T16:42:10Z') },
  ]);
});
