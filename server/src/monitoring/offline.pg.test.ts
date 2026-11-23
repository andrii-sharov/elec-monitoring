import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../test/db.ts';
import { pairDevice, pingBody } from '../../test/devices.ts';
import { FakeClock, RecordingNotificationQueue, silentLogger } from '../../test/fakes.ts';
import { device, outage } from '../db/schema/index.ts';
import { hashDeviceToken } from '../devices/credentials.ts';
import { recordCheckIn } from './checkIn.ts';
import { checkOffline, type MonitorDeps } from './offline.ts';

const T = new Date('2026-11-21T16:42:00Z');
const at = (s: number) => new Date(T.getTime() + s * 1000);

describe.skipIf(!pgTestUrl)('offline checker on real Postgres', () => {
  let t: PgTestDb;

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  async function pastDeadlineDevice() {
    const owner = await createUser(t.db, { email: `u${Math.random()}@example.com` });
    const { device: row, token } = await pairDevice(t.db, owner.id, {
      state: 'ONLINE',
      stateSince: T,
      lastSeenAt: T,
      offlineAt: at(120),
      bootId: pingBody().boot_id as string,
      seq: 1,
    });
    return { row, token };
  }

  test('skips a row locked by another transaction', async () => {
    const { row } = await pastDeadlineDevice();
    const clock = new FakeClock(at(125));
    const deps: MonitorDeps = {
      db: t.db,
      clock,
      logger: silentLogger(),
      notifications: new RecordingNotificationQueue(),
    };

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = t.sql.begin(async (tx) => {
      await tx`select id from device where id = ${row.id} for update`;
      locked();
      await held;
    });
    await lockTaken;

    expect(await checkOffline(deps)).toBe(0);
    const [during] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(during!.state).toBe('ONLINE');

    release();
    await holder;
    expect(await checkOffline(deps)).toBe(1);
  });

  test('a check-in racing the worker leaves one closed outage at most', async () => {
    const { row, token } = await pastDeadlineDevice();
    const clock = new FakeClock(at(125));
    const queue = new RecordingNotificationQueue();
    const deps: MonitorDeps = {
      db: t.db,
      clock,
      logger: silentLogger(),
      notifications: queue,
    };
    const body = pingBody({ seq: 2 });

    await Promise.all([
      checkOffline(deps),
      recordCheckIn({ ...deps }, row.id, hashDeviceToken(token), {
        type: 'PING',
        bootId: body.boot_id as string,
        seq: 2,
        uptimeS: 60,
        resetReason: 'POWER_ON',
        rssi: -60,
        fw: '2.0.0',
      }),
    ]);

    const [after] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(after!.state).toBe('ONLINE');
    const outages = await t.db.select().from(outage).where(eq(outage.deviceId, row.id));
    expect(outages.length).toBeLessThanOrEqual(1);
    expect(outages.every((o) => o.endedAt !== null)).toBe(true);
  });
});
