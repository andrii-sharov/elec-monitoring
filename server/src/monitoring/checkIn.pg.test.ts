import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../test/db.ts';
import { pairDevice } from '../../test/devices.ts';
import { FakeClock, RecordingNotificationQueue, silentLogger } from '../../test/fakes.ts';
import { outage } from '../db/schema/index.ts';
import { hashDeviceToken } from '../devices/credentials.ts';
import { recordCheckIn, type CheckIn } from './checkIn.ts';

describe.skipIf(!pgTestUrl)('check-ins on real Postgres', () => {
  let t: PgTestDb;

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  test('two parallel identical boot check-ins record one power blip', async () => {
    const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
    const queue = new RecordingNotificationQueue();
    const deps = { db: t.db, clock, logger: silentLogger(), notifications: queue };
    const user = await createUser(t.db);
    const { device, token } = await pairDevice(t.db, user.id);
    const tokenHash = hashDeviceToken(token);
    const base: CheckIn = {
      type: 'BOOT',
      bootId: '0193a1c4-0000-7000-8000-00000000000a',
      seq: 1,
      uptimeS: 8,
      resetReason: 'POWER_ON',
      rssi: -61,
      fw: '2.0.0',
    };
    expect(await recordCheckIn(deps, device.id, tokenHash, base)).toBe('ACCEPTED');

    clock.advance(25_000);
    const retry: CheckIn = { ...base, bootId: '0193a1c4-0000-7000-8000-00000000000b' };
    let pending: Promise<string[]> | undefined;
    await t.sql.begin(async (blocker) => {
      await blocker`select id from device where id = ${device.id} for update`;
      pending = Promise.all([
        recordCheckIn(deps, device.id, tokenHash, retry),
        recordCheckIn(deps, device.id, tokenHash, retry),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const results = await pending!;

    expect(results.toSorted()).toEqual(['ACCEPTED', 'DUPLICATE']);
    expect(await t.db.select().from(outage)).toHaveLength(1);
    expect(queue.calls.filter((c) => c.kind === 'powerBlip')).toHaveLength(1);
  });
});
