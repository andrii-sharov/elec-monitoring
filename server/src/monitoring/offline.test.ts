import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { pairDevice } from '../../test/devices.ts';
import { FakeClock, RecordingNotificationQueue, silentLogger } from '../../test/fakes.ts';
import { appUser, device, outage } from '../db/schema/index.ts';
import { checkOffline, queueDueOffAlerts, type MonitorDeps } from './offline.ts';

let t: TestDb;
const T = new Date('2026-11-21T16:42:00Z');
const at = (s: number) => new Date(T.getTime() + s * 1000);
let clock: FakeClock;
let queue: RecordingNotificationQueue;
let deps: MonitorDeps;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(T);
  queue = new RecordingNotificationQueue();
  deps = { db: t.db, clock, logger: silentLogger(), notifications: queue };
});

async function onlineDevice(overrides: Partial<typeof device.$inferInsert> = {}) {
  const owner = await createUser(t.db);
  const { device: row } = await pairDevice(t.db, owner.id, {
    state: 'ONLINE',
    stateSince: T,
    lastSeenAt: T,
    offlineAt: at(120),
    ...overrides,
  });
  return row;
}

describe('checkOffline', () => {
  test('does nothing before the deadline', async () => {
    const row = await onlineDevice();
    clock.set(at(119));
    expect(await checkOffline(deps)).toBe(0);
    const [after] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(after!.state).toBe('ONLINE');
  });

  test('flips the device at the deadline and opens an outage', async () => {
    const row = await onlineDevice();
    clock.set(at(125));
    expect(await checkOffline(deps)).toBe(1);

    const [after] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(after!.state).toBe('OFFLINE');
    expect(after!.stateSince).toEqual(at(120));
    expect(after!.offlineAt).toBeNull();
    const [open] = await t.db.select().from(outage).where(eq(outage.deviceId, row.id));
    expect(open!.type).toBe('OUTAGE');
    expect(open!.startedAt).toEqual(T);
    expect(open!.endedAt).toBeNull();
    expect(open!.offAlertDueAt).toEqual(at(125));
    expect(open!.createdAt).toEqual(at(125));
  });

  test('flips exactly at offline_at', async () => {
    await onlineDevice();
    clock.set(at(120));
    expect(await checkOffline(deps)).toBe(1);
  });

  test.each(['PENDING', 'OFFLINE', 'UPDATING'] as const)('ignores %s devices', async (state) => {
    const owner = await createUser(t.db);
    await pairDevice(t.db, owner.id, { state, lastSeenAt: T });
    clock.set(at(1000));
    expect(await checkOffline(deps)).toBe(0);
  });

  test('handles more devices than one batch, one outage each', async () => {
    const owner = await createUser(t.db);
    await t.db.insert(device).values(
      Array.from({ length: 250 }, (_, i) => ({
        ownerId: owner.id,
        name: `d${i}`,
        state: 'ONLINE' as const,
        stateSince: T,
        lastSeenAt: T,
        offlineAt: at(120),
      })),
    );
    clock.set(at(130));
    expect(await checkOffline(deps)).toBe(250);
    const outages = await t.db.select().from(outage);
    expect(outages).toHaveLength(250);
    expect(new Set(outages.map((o) => o.deviceId)).size).toBe(250);
  });
});

describe('queueDueOffAlerts', () => {
  test('queues an OFF alert once the outage is due', async () => {
    const row = await onlineDevice();
    clock.set(at(120));
    await checkOffline(deps);
    expect(await queueDueOffAlerts(deps)).toBe(1);

    const [open] = await t.db.select().from(outage).where(eq(outage.deviceId, row.id));
    expect(open!.offAlertQueuedAt).toEqual(at(120));
    expect(queue.calls).toEqual([{ kind: 'offAlert', deviceId: row.id, outageId: open!.id }]);

    expect(await queueDueOffAlerts(deps)).toBe(0);
    expect(queue.calls).toHaveLength(1);
  });

  test('waits for the short-outage threshold when short alerts are off', async () => {
    await onlineDevice({ notifyShortOutages: false });
    clock.set(at(120));
    await checkOffline(deps);
    const [open] = await t.db.select().from(outage);
    expect(open!.offAlertDueAt).toEqual(at(180));

    clock.set(at(179));
    expect(await queueDueOffAlerts(deps)).toBe(0);
    clock.set(at(180));
    expect(await queueDueOffAlerts(deps)).toBe(1);
  });

  test('skips an outage that was closed before it was due', async () => {
    await onlineDevice({ notifyShortOutages: false });
    clock.set(at(120));
    await checkOffline(deps);
    await t.db.update(outage).set({ endedAt: at(150), cause: 'NETWORK', kind: 'SHORT' });
    clock.set(at(200));
    expect(await queueDueOffAlerts(deps)).toBe(0);
    expect(queue.calls).toHaveLength(0);
  });
});
