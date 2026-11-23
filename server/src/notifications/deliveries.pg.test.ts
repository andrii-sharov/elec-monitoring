import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../test/channels.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../test/db.ts';
import { pairDevice } from '../../test/devices.ts';
import { FakeClock } from '../../test/fakes.ts';
import { delivery, outage } from '../db/schema/index.ts';
import { claimDeliveries } from './deliveries.ts';

describe.skipIf(!pgTestUrl)('claimDeliveries on real Postgres', () => {
  let t: PgTestDb;

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  test('two workers claim disjoint batches', async () => {
    const owner = await createUser(t.db);
    const { device } = await pairDevice(t.db, owner.id);
    const channel = await createPlatformChannel(t.db, owner.id);
    await linkChannel(t.db, device.id, channel.id);
    const base = new Date('2026-11-21T16:00:00Z');
    const outages = await t.db
      .insert(outage)
      .values(
        Array.from({ length: 60 }, (_, i) => ({
          deviceId: device.id,
          type: 'POWER_BLIP' as const,
          startedAt: new Date(base.getTime() + i * 60_000),
          endedAt: new Date(base.getTime() + i * 60_000 + 25_000),
          cause: 'POWER' as const,
          kind: 'SHORT' as const,
        })),
      )
      .returning({ id: outage.id });
    await t.db.insert(delivery).values(
      outages.map((o) => ({
        outageId: o.id,
        channelId: channel.id,
        event: 'device.power_blip',
        payload: {},
        nextAttemptAt: base,
      })),
    );

    const clock = new FakeClock(new Date('2026-11-21T17:00:00Z'));
    const [a, b] = await Promise.all([
      claimDeliveries(t.db, clock, 30),
      claimDeliveries(t.db, clock, 30),
    ]);
    const ids = new Set([...a, ...b].map((d) => d.id));
    expect(a).toHaveLength(30);
    expect(b).toHaveLength(30);
    expect(ids.size).toBe(60);
  });
});
