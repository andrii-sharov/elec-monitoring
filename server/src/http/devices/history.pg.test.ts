import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { deviceBoot, deviceDiagnostic, outage } from '../../db/schema/index.ts';

const T = new Date('2026-11-21T16:42:00Z');
const BOOT = '0193a1c4-0000-7000-8000-00000000000a';

describe.skipIf(!pgTestUrl)('history pagination on real Postgres', () => {
  let t: PgTestDb;
  let clock: FakeClock;
  let auth: string;
  let deviceId: string;

  beforeAll(async () => {
    t = await createPgTestDb();
    clock = new FakeClock(T);
    const owner = await createUser(t.db);
    auth = `Bearer ${(await signIn({ db: t.db, clock, config: testConfig }, owner.id)).accessToken}`;
    deviceId = (await createDevice(t.db, owner.id)).id;
    const times = [0, 1, 2].map((i) => new Date(T.getTime() - i * 600_000));
    await t.db.insert(outage).values(
      times.map((startedAt) => ({
        deviceId,
        type: 'OUTAGE' as const,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 60_000),
        cause: 'POWER' as const,
        kind: 'SHORT' as const,
      })),
    );
    await t.db.insert(deviceBoot).values({ deviceId, bootId: BOOT, resetReason: 'POWER_ON' });
    await t.db.insert(deviceDiagnostic).values(
      times.map((startedAt, i) => ({
        deviceId,
        bootId: BOOT,
        localId: i,
        kind: 'WIFI' as const,
        reason: 201,
        startUptimeS: 10,
        endUptimeS: 20,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 10_000),
      })),
    );
  });

  afterAll(async () => {
    await t.close();
  });

  test.each(['outages', 'diagnostics'])('the second page of %s loads', async (list) => {
    const get = (query: string) =>
      request(testApp({ db: t.db, clock }))
        .get(`/api/v1/devices/${deviceId}/${list}?limit=2${query}`)
        .set('Authorization', auth);
    const first = await get('');
    const second = await get(`&cursor=${first.body.next_cursor}`);

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
  });
});
