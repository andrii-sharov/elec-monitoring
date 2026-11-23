import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { createDevice } from '../../test/devices.ts';
import { silentLogger } from '../../test/fakes.ts';
import { appUser, deviceBoot, deviceDiagnostic } from '../db/schema/index.ts';
import { storeWifiReport, type WifiReport } from './diagnostics.ts';

const NOW = new Date('2026-11-21T16:42:00Z');
const BOOT = '0193a1c4-0000-7000-8000-000000000001';

let t: TestDb;
let deviceId: string;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  const user = await createUser(t.db);
  deviceId = (await createDevice(t.db, user.id)).id;
  await t.db.insert(deviceBoot).values({ deviceId, bootId: BOOT, resetReason: 'POWER_ON' });
});

const logger = silentLogger();

async function store(report: WifiReport, uptimeS = 1260) {
  await t.db.transaction((tx) =>
    storeWifiReport(tx, logger, { deviceId, bootId: BOOT, uptimeS, now: NOW, report }),
  );
}

const wifiEvent = (id: number, start = 900, end = 948) => ({
  id,
  kind: 'WIFI' as const,
  start_uptime_s: start,
  end_uptime_s: end,
  reason: 201,
});

const diagnostics = () =>
  t.db.select().from(deviceDiagnostic).orderBy(asc(deviceDiagnostic.localId));

test('estimates wall-clock times from uptime', async () => {
  await store({ evicted: 0, events: [wifiEvent(7)] });
  const [row] = await diagnostics();
  expect(row).toMatchObject({
    localId: 7,
    kind: 'WIFI',
    reason: 201,
    startedAt: new Date('2026-11-21T16:36:00Z'),
    endedAt: new Date('2026-11-21T16:36:48Z'),
  });
});

test('the same event twice is stored once', async () => {
  await store({ evicted: 0, events: [wifiEvent(7)] });
  await store({ evicted: 0, events: [wifiEvent(7)] });
  expect(await diagnostics()).toHaveLength(1);
});

test('keeps the highest eviction counter', async () => {
  await store({ evicted: 3, events: [] });
  await store({ evicted: 2, events: [] });
  const [boot] = await t.db.select().from(deviceBoot);
  expect(boot!.wifiEvicted).toBe(3);
});

test('API records never keep a reason', async () => {
  await store({ evicted: 0, events: [{ ...wifiEvent(1), kind: 'API', reason: 5 }] });
  expect((await diagnostics())[0]!.reason).toBeNull();
});

test('invalid records are skipped and the rest are stored', async () => {
  await store({
    evicted: 0,
    events: [wifiEvent(1, 500, 400), wifiEvent(2, 900, 1300), wifiEvent(3, 100, 160)],
  });
  expect((await diagnostics()).map((d) => d.localId)).toEqual([3]);
  expect(logger.warn).toHaveBeenCalled();
});
