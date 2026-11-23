import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { appUser, deviceBoot, deviceDiagnostic, outage } from '../../db/schema/index.ts';
import { encodeCursor } from '../pagination.ts';

const T = new Date('2026-11-21T16:42:00Z');
const minutes = (m: number) => new Date(T.getTime() + m * 60_000);
const BOOT_A = '0193a1c4-0000-7000-8000-00000000000a';
const BOOT_B = '0193a1c4-0000-7000-8000-00000000000b';

let t: TestDb;
let clock: FakeClock;
let auth: string;
let deviceId: string;
let otherDeviceId: string;
let strangerAuth: string;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(T);
  const owner = await createUser(t.db);
  const stranger = await createUser(t.db, { email: 'johnny@example.com' });
  auth = `Bearer ${(await signIn({ db: t.db, clock, config: testConfig }, owner.id)).accessToken}`;
  strangerAuth = `Bearer ${(await signIn({ db: t.db, clock, config: testConfig }, stranger.id)).accessToken}`;
  deviceId = (await createDevice(t.db, owner.id)).id;
  otherDeviceId = (await createDevice(t.db, owner.id, { name: 'Other' })).id;
});

function get(path: string, token = auth) {
  return request(testApp({ db: t.db, clock }))
    .get(path)
    .set('Authorization', token);
}

type OutageInsert = typeof outage.$inferInsert;

async function addOutage(overrides: Partial<OutageInsert> & { startedAt: Date }) {
  const closed = overrides.endedAt !== null;
  await t.db.insert(outage).values({
    deviceId,
    type: 'OUTAGE',
    endedAt: new Date(overrides.startedAt.getTime() + 60_000),
    ...(closed ? { cause: 'POWER', kind: 'SHORT' } : {}),
    ...overrides,
  });
}

describe('GET /api/v1/devices/:id/outages', () => {
  test('pages through every outage once, newest first', async () => {
    for (let i = 0; i < 120; i += 1) await addOutage({ startedAt: minutes(-i * 10) });
    await addOutage({ startedAt: minutes(-5000) });
    await addOutage({ startedAt: minutes(-5000) });
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res = await get(
        `/api/v1/devices/${deviceId}/outages?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      sizes.push(res.body.items.length);
      seen.push(...res.body.items.map((o: { id: string }) => o.id));
      cursor = res.body.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 22]);
    expect(new Set(seen).size).toBe(122);
  });

  test('a page that holds exactly the rest has no next cursor', async () => {
    for (let i = 0; i < 2; i += 1) await addOutage({ startedAt: minutes(-i * 10) });
    const res = await get(`/api/v1/devices/${deviceId}/outages?limit=2`);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.next_cursor).toBeNull();
  });

  test('filters by type, cause and kind', async () => {
    await addOutage({ startedAt: minutes(-30), type: 'POWER_BLIP' });
    await addOutage({ startedAt: minutes(-20), cause: 'NETWORK', kind: 'LONG' });
    await addOutage({ startedAt: minutes(-10), cause: 'UNKNOWN' });
    const types = await get(`/api/v1/devices/${deviceId}/outages?type=POWER_BLIP`);
    expect(types.body.items.map((o: { type: string }) => o.type)).toEqual(['POWER_BLIP']);
    const causes = await get(`/api/v1/devices/${deviceId}/outages?cause=NETWORK`);
    expect(causes.body.items).toHaveLength(1);
    const kinds = await get(`/api/v1/devices/${deviceId}/outages?kind=LONG`);
    expect(kinds.body.items).toHaveLength(1);
  });

  test('the range keeps outages that overlap it, including an open one', async () => {
    await addOutage({ startedAt: minutes(-600), endedAt: minutes(-500) });
    await addOutage({ startedAt: minutes(-120), endedAt: null });
    const res = await get(
      `/api/v1/devices/${deviceId}/outages?from=${minutes(-60).toISOString()}&to=${T.toISOString()}`,
    );
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      ended_at: null,
      duration_s: null,
      cause: null,
      kind: null,
    });
  });

  test.each([
    `from=${minutes(10).toISOString()}&to=${T.toISOString()}`,
    'limit=0',
    'limit=101',
    'cause=power',
    'cursor=%25%25',
    `cursor=${encodeCursor(['not-a-date', 'x'])}`,
  ])('rejects %s', async (query) => {
    expect((await get(`/api/v1/devices/${deviceId}/outages?${query}`)).status).toBe(400);
  });

  test('never shows another device and hides from strangers', async () => {
    await t.db.insert(outage).values({ deviceId: otherDeviceId, type: 'OUTAGE', startedAt: T });
    expect((await get(`/api/v1/devices/${deviceId}/outages`)).body.items).toEqual([]);
    expect((await get(`/api/v1/devices/${deviceId}/outages`, strangerAuth)).status).toBe(404);
  });
});

describe('GET /api/v1/devices/:id/diagnostics', () => {
  beforeEach(async () => {
    await t.db.insert(deviceBoot).values([
      { deviceId, bootId: BOOT_A, resetReason: 'POWER_ON', wifiEvicted: 4 },
      { deviceId, bootId: BOOT_B, resetReason: 'SOFTWARE' },
    ]);
    const row = (bootId: string, localId: number, kind: 'WIFI' | 'API', startedAt: Date) => ({
      deviceId,
      bootId,
      localId,
      kind,
      reason: kind === 'WIFI' ? 201 : null,
      startUptimeS: 100,
      endUptimeS: 148,
      startedAt,
      endedAt: new Date(startedAt.getTime() + 48_000),
    });
    await t.db
      .insert(deviceDiagnostic)
      .values([
        row(BOOT_A, 1, 'WIFI', minutes(-30)),
        row(BOOT_A, 2, 'API', minutes(-20)),
        row(BOOT_B, 1, 'WIFI', minutes(-10)),
      ]);
  });

  test('lists diagnostics newest first with the boot eviction counter', async () => {
    const res = await get(`/api/v1/devices/${deviceId}/diagnostics`);
    expect(res.status).toBe(200);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.items[2]).toEqual({
      boot_id: BOOT_A,
      id: 1,
      kind: 'WIFI',
      reason: 201,
      started_at: minutes(-30).toISOString(),
      ended_at: new Date(minutes(-30).getTime() + 48_000).toISOString(),
      duration_s: 48,
      boot_wifi_evicted: 4,
    });
    expect(res.body.items.map((d: { boot_id: string }) => d.boot_id)).toEqual([
      BOOT_B,
      BOOT_A,
      BOOT_A,
    ]);
  });

  test('filters by kind and pages', async () => {
    const api = await get(`/api/v1/devices/${deviceId}/diagnostics?kind=API`);
    expect(api.body.items).toHaveLength(1);
    const first = await get(`/api/v1/devices/${deviceId}/diagnostics?limit=2`);
    const second = await get(
      `/api/v1/devices/${deviceId}/diagnostics?limit=2&cursor=${first.body.next_cursor}`,
    );
    expect([...first.body.items, ...second.body.items]).toHaveLength(3);
    expect(second.body.next_cursor).toBeNull();
  });

  test('a cursor with an out-of-range local id is rejected', async () => {
    const cursor = encodeCursor([T.toISOString(), BOOT_A, '9999999999']);
    expect((await get(`/api/v1/devices/${deviceId}/diagnostics?cursor=${cursor}`)).status).toBe(
      400,
    );
  });

  test('hides from strangers', async () => {
    expect((await get(`/api/v1/devices/${deviceId}/diagnostics`, strangerAuth)).status).toBe(404);
  });
});
