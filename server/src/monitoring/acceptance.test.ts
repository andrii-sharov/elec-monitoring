import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../test/app.ts';
import { createUser, signIn } from '../../test/auth.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { markOffline, pairDevice } from '../../test/devices.ts';
import { FakeClock, RecordingNotificationQueue, silentLogger } from '../../test/fakes.ts';
import { appUser } from '../db/schema/index.ts';
import { checkOffline, queueDueOffAlerts } from './offline.ts';

const T = new Date('2026-11-21T16:42:00Z');
const BOOT_A = '0193a1c4-0000-7000-8000-00000000000a';
const BOOT_B = '0193a1c4-0000-7000-8000-00000000000b';

let t: TestDb;
let clock: FakeClock;
let queue: RecordingNotificationQueue;
let userAuth: string;
let deviceToken: string;
let deviceId: string;
let seq: number;

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
  userAuth = `Bearer ${(await signIn({ db: t.db, clock, config: testConfig }, user.id)).accessToken}`;
  const paired = await pairDevice(t.db, user.id);
  deviceToken = paired.token;
  deviceId = paired.device.id;
  seq = 0;
});

const app = () => testApp({ db: t.db, clock, notifications: queue });
const at = (s: number) => new Date(T.getTime() + s * 1000).toISOString();

async function checkIn(body: Record<string, unknown>) {
  const res = await request(app())
    .post('/api/v1/device/ping')
    .set('Authorization', `Bearer ${deviceToken}`)
    .send({ rssi: -61, fw: '2.0.0', reset_reason: 'POWER_ON', ...body });
  expect(res.status).toBe(204);
}

const boot = (bootId: string, resetReason = 'POWER_ON', uptime = 8) => {
  seq = 1;
  return checkIn({
    type: 'BOOT',
    boot_id: bootId,
    seq,
    uptime_s: uptime,
    reset_reason: resetReason,
  });
};

const ping = (bootId: string, uptime: number, extra: Record<string, unknown> = {}) => {
  seq += 1;
  return checkIn({ type: 'PING', boot_id: bootId, seq, uptime_s: uptime, ...extra });
};

const getDevice = async () =>
  (await request(app()).get(`/api/v1/devices/${deviceId}`).set('Authorization', userAuth)).body;
const getOutages = async () =>
  (await request(app()).get(`/api/v1/devices/${deviceId}/outages`).set('Authorization', userAuth))
    .body.items;
const getDiagnostics = async () =>
  (
    await request(app())
      .get(`/api/v1/devices/${deviceId}/diagnostics`)
      .set('Authorization', userAuth)
  ).body.items;

test('1. first boot starts monitoring silently', async () => {
  await boot(BOOT_A);
  expect(await getDevice()).toMatchObject({
    state: 'ONLINE',
    state_since: at(0),
    last_seen_at: at(0),
  });
  expect(await getOutages()).toEqual([]);
  expect(queue.calls).toEqual([]);
});

test('2. regular pings keep the device online', async () => {
  await boot(BOOT_A);
  for (let i = 1; i <= 10; i += 1) {
    clock.advance(30_000);
    await ping(BOOT_A, 8 + i * 30);
  }
  expect(await getDevice()).toMatchObject({ state: 'ONLINE', last_seen_at: at(300) });
  expect(await getOutages()).toEqual([]);
});

test('3. a power reset before the timeout is a 25 s power blip', async () => {
  await boot(BOOT_A);
  clock.advance(30_000);
  await ping(BOOT_A, 38);
  clock.advance(25_000);
  await boot(BOOT_B);
  expect((await getDevice()).state).toBe('ONLINE');
  const outages = await getOutages();
  expect(outages).toMatchObject([
    { type: 'POWER_BLIP', cause: 'POWER', kind: 'SHORT', duration_s: 25 },
  ]);
  expect(queue.calls).toEqual([{ kind: 'powerBlip', deviceId, outageId: outages[0].id }]);
});

async function interruption(offAlertQueuedAt?: Date) {
  await boot(BOOT_A);
  const outageId = await markOffline(t.db, deviceId, { offAlertQueuedAt });
  clock.advance(300_000);
  await ping(BOOT_A, 308, {
    wifi: {
      evicted: 0,
      events: [{ id: 1, kind: 'WIFI', start_uptime_s: 10, end_uptime_s: 300, reason: 200 }],
    },
  });
  return outageId;
}

describe('4. Wi-Fi-only interruption', () => {
  test('without an OFF alert it sends a summary', async () => {
    const outageId = await interruption();
    expect(await getOutages()).toMatchObject([
      {
        id: outageId,
        type: 'OUTAGE',
        cause: 'NETWORK',
        kind: 'LONG',
        duration_s: 300,
        ended_at: at(300),
      },
    ]);
    expect(await getDiagnostics()).toMatchObject([{ id: 1, kind: 'WIFI', duration_s: 290 }]);
    expect(queue.calls).toEqual([{ kind: 'summary', deviceId, outageId }]);
    expect((await getDevice()).state).toBe('ONLINE');
  });

  test('after an OFF alert it sends a recovery', async () => {
    const outageId = await interruption(new Date(T.getTime() + 120_000));
    expect(queue.calls).toEqual([{ kind: 'recovery', deviceId, outageId }]);
  });
});

test('5. a software reset records no blip', async () => {
  await boot(BOOT_A);
  clock.advance(20_000);
  await boot(BOOT_B, 'SOFTWARE');
  expect(await getOutages()).toEqual([]);
  expect(queue.calls).toEqual([]);
  expect((await getDevice()).telemetry.reset_reason).toBe('SOFTWARE');
});

describe('6. duplicates', () => {
  test('a resent boot check-in changes nothing', async () => {
    await boot(BOOT_A);
    clock.advance(25_000);
    await boot(BOOT_B);
    clock.advance(2_000);
    await boot(BOOT_B);
    expect((await getDevice()).last_seen_at).toBe(at(25));
    expect(await getOutages()).toHaveLength(1);
    expect(queue.calls).toHaveLength(1);
  });

  test('resent Wi-Fi events are stored once', async () => {
    await boot(BOOT_A);
    const wifi = {
      evicted: 0,
      events: [{ id: 7, kind: 'WIFI', start_uptime_s: 2, end_uptime_s: 5, reason: 8 }],
    };
    clock.advance(30_000);
    await ping(BOOT_A, 38, { wifi });
    await checkIn({ type: 'PING', boot_id: BOOT_A, seq, uptime_s: 38, wifi });
    clock.advance(30_000);
    await ping(BOOT_A, 68, { wifi });
    expect(await getDiagnostics()).toHaveLength(1);
  });
});

test('7. recovery after the timeout before the worker runs', async () => {
  await boot(BOOT_A);
  clock.advance(150_000);
  await ping(BOOT_A, 158);
  const device = await getDevice();
  expect(device).toMatchObject({ state: 'ONLINE', state_since: at(150) });
  const outages = await getOutages();
  expect(outages).toMatchObject([
    { type: 'OUTAGE', cause: 'NETWORK', kind: 'SHORT', duration_s: 150 },
  ]);
  expect(queue.calls).toEqual([{ kind: 'summary', deviceId, outageId: outages[0].id }]);

  await checkIn({ type: 'PING', boot_id: BOOT_A, seq, uptime_s: 158 });
  expect(await getOutages()).toHaveLength(1);
  expect(queue.calls).toHaveLength(1);
});

test('8. a re-paired board does not register a power blip', async () => {
  await boot(BOOT_A);
  const code = await request(app())
    .post(`/api/v1/devices/${deviceId}/pairing-code`)
    .set('Authorization', userAuth);
  const claim = await request(app())
    .post('/api/v1/device/claim')
    .send({ pairing_code: code.body.pairing_code, fw: '2.0.0' });
  deviceToken = claim.body.device_token;
  clock.advance(20_000);
  await boot(BOOT_B);
  expect(await getOutages()).toEqual([]);
  expect(queue.calls).toEqual([]);
});

describe('planned network work', () => {
  const pause = (minutes: number) =>
    request(app())
      .put(`/api/v1/devices/${deviceId}/network-pause`)
      .set('Authorization', userAuth)
      .send({ minutes });

  async function workerTick() {
    const deps = { db: t.db, clock, logger: silentLogger(), notifications: queue };
    await checkOffline(deps);
    await queueDueOffAlerts(deps);
  }

  async function silence(seconds: number) {
    for (let s = 0; s < seconds; s += 10) {
      clock.advance(10_000);
      await workerTick();
    }
  }

  test('a router swap inside the pause leaves no outage and no message', async () => {
    await boot(BOOT_A);
    await pause(15);
    await silence(180);
    expect((await getDevice()).state).toBe('OFFLINE');
    await ping(BOOT_A, 188);
    expect(await getOutages()).toEqual([]);
    expect(queue.calls).toEqual([]);
    expect((await getDevice()).state).toBe('ONLINE');
  });

  test('silence past the pause alerts at its end and keeps the outage', async () => {
    await boot(BOOT_A);
    await pause(5);
    await silence(290);
    expect(queue.calls).toEqual([]);
    await silence(20);
    expect(queue.calls.map((c) => c.kind)).toEqual(['offAlert']);
    clock.advance(180_000);
    await ping(BOOT_A, 498);
    expect(await getOutages()).toMatchObject([{ type: 'OUTAGE', cause: 'NETWORK' }]);
    expect(queue.calls.map((c) => c.kind)).toEqual(['offAlert', 'recovery']);
  });
});
