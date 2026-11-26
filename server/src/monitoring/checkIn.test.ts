import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { markOffline, pairDevice } from '../../test/devices.ts';
import { FakeClock, RecordingNotificationQueue, silentLogger } from '../../test/fakes.ts';
import { appUser, device, deviceBoot, deviceDiagnostic, outage } from '../db/schema/index.ts';
import { hashDeviceToken } from '../devices/credentials.ts';
import { recordCheckIn, type CheckIn } from './checkIn.ts';

const T = new Date('2026-11-21T16:42:00Z');
const BOOT_A = '0193a1c4-0000-7000-8000-00000000000a';
const BOOT_B = '0193a1c4-0000-7000-8000-00000000000b';

let t: TestDb;
let clock: FakeClock;
let queue: RecordingNotificationQueue;
let deviceId: string;
let tokenHash: Buffer;

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
  const user = await createUser(t.db);
  const paired = await pairDevice(t.db, user.id);
  deviceId = paired.device.id;
  tokenHash = hashDeviceToken(paired.token);
});

const deps = () => ({ db: t.db, clock, logger: silentLogger(), notifications: queue });

function checkIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    type: 'PING',
    bootId: BOOT_A,
    seq: 1,
    uptimeS: 10,
    resetReason: 'POWER_ON',
    rssi: -61,
    fw: '2.0.0',
    ...overrides,
  };
}

const send = (c: CheckIn) => recordCheckIn(deps(), deviceId, tokenHash, c);
const row = async () => (await t.db.select().from(device).where(eq(device.id, deviceId)))[0]!;
const outages = () => t.db.select().from(outage).where(eq(outage.deviceId, deviceId));

async function online() {
  expect(await send(checkIn({ type: 'BOOT' }))).toBe('ACCEPTED');
}

test('the first check-in goes ONLINE and stores live state', async () => {
  await online();
  expect(await row()).toMatchObject({
    state: 'ONLINE',
    stateSince: T,
    lastSeenAt: T,
    offlineAt: new Date(T.getTime() + 40_000),
    bootId: BOOT_A,
    seq: 1,
    uptimeS: 10,
    rssi: -61,
    fwVersion: '2.0.0',
  });
  const boots = await t.db.select().from(deviceBoot);
  expect(boots).toMatchObject([{ bootId: BOOT_A, resetReason: 'POWER_ON' }]);
  expect(queue.calls).toEqual([]);
});

test('a power blip inserts a closed POWER_BLIP and queues it', async () => {
  await online();
  clock.advance(25_000);
  await send(checkIn({ type: 'BOOT', bootId: BOOT_B, seq: 1, uptimeS: 8 }));
  const [blip] = await outages();
  expect(blip).toMatchObject({
    type: 'POWER_BLIP',
    cause: 'POWER',
    kind: 'SHORT',
    startedAt: T,
    endedAt: new Date(T.getTime() + 25_000),
    durationS: 25,
  });
  expect(queue.calls).toEqual([{ kind: 'powerBlip', deviceId, outageId: blip!.id }]);
  expect((await row()).stateSince).toEqual(T);
});

test('a late recovery inserts a closed OUTAGE and queues a summary', async () => {
  await online();
  clock.advance(150_000);
  await send(checkIn({ seq: 2, uptimeS: 160 }));
  const [late] = await outages();
  expect(late).toMatchObject({ type: 'OUTAGE', cause: 'NETWORK', kind: 'SHORT', durationS: 150 });
  expect(late!.offAlertQueuedAt).toBeNull();
  expect(queue.calls).toEqual([{ kind: 'summary', deviceId, outageId: late!.id }]);
  expect((await row()).stateSince).toEqual(clock.now());
});

test('recovery after an OFF alert closes the open outage with a recovery', async () => {
  await online();
  const outageId = await markOffline(t.db, deviceId, {
    offAlertQueuedAt: new Date(T.getTime() + 120_000),
  });
  clock.advance(300_000);
  await send(checkIn({ seq: 2, uptimeS: 310 }));
  const [closed] = await outages();
  expect(closed).toMatchObject({ id: outageId, cause: 'NETWORK', kind: 'LONG', durationS: 300 });
  expect(queue.calls).toEqual([{ kind: 'recovery', deviceId, outageId }]);
  expect(await row()).toMatchObject({ state: 'ONLINE', stateSince: clock.now() });
});

test('a duplicate changes nothing', async () => {
  await online();
  const before = await row();
  clock.advance(5_000);
  expect(await send(checkIn({ type: 'BOOT' }))).toBe('DUPLICATE');
  const after = await row();
  expect(after.lastSeenAt).toEqual(before.lastSeenAt);
  expect(after.seq).toBe(before.seq);
  expect(after.updatedAt).toEqual(before.updatedAt);
  expect(queue.calls).toEqual([]);
});

test('a duplicate still stores its Wi-Fi events', async () => {
  await online();
  const wifi = {
    evicted: 0,
    events: [{ id: 1, kind: 'WIFI' as const, start_uptime_s: 2, end_uptime_s: 5, reason: 8 }],
  };
  expect(await send(checkIn({ wifi }))).toBe('DUPLICATE');
  expect(await t.db.select().from(deviceDiagnostic)).toHaveLength(1);
});

test('a rotated token is unauthorized', async () => {
  await t.db.update(device).set({ tokenHash: null }).where(eq(device.id, deviceId));
  expect(await send(checkIn())).toBe('UNAUTHORIZED');
});

test('closing an outage with a clock behind its start keeps the outage valid', async () => {
  await online();
  const outageId = await markOffline(t.db, deviceId);
  clock.advance(-5_000);
  expect(await send(checkIn({ seq: 2, uptimeS: 20 }))).toBe('ACCEPTED');
  const [closed] = await outages();
  expect(closed).toMatchObject({ id: outageId, startedAt: T, endedAt: T, durationS: 0 });
});
