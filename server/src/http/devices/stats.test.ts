import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { addViewer } from '../../../test/sharing.ts';
import { appUser, deviceBoot, outage } from '../../db/schema/index.ts';

const NOW = new Date('2026-11-27T10:00:00Z');
const BOOT_A = '0193a1c4-0000-7000-8000-00000000000a';
const BOOT_B = '0193a1c4-0000-7000-8000-00000000000b';

let t: TestDb;
let clock: FakeClock;
let deviceId: string;
let auth: { owner: string; viewer: string; stranger: string };

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

async function tokenFor(userId: string) {
  return `Bearer ${(await signIn({ db: t.db, clock, config: testConfig }, userId)).accessToken}`;
}

async function boot(bootId: string, firstSeenAt: Date) {
  await t.db.insert(deviceBoot).values({ deviceId, bootId, resetReason: 'POWER_ON', firstSeenAt });
}

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(NOW);
  const owner = await createUser(t.db, { email: 'john@example.com', timezone: 'Europe/Kyiv' });
  const viewer = await createUser(t.db, {
    email: 'mary@example.com',
    timezone: 'America/New_York',
  });
  const stranger = await createUser(t.db, { email: 'pete@example.com' });
  deviceId = (await createDevice(t.db, owner.id, { state: 'ONLINE', offlineAt: NOW })).id;
  await addViewer(t.db, deviceId, viewer.id);
  auth = {
    owner: await tokenFor(owner.id),
    viewer: await tokenFor(viewer.id),
    stranger: await tokenFor(stranger.id),
  };
});

function get(query: string, token: string | null = auth.owner, id = deviceId) {
  const req = request(testApp({ db: t.db, clock })).get(`/api/v1/devices/${id}/stats?${query}`);
  return token ? req.set('Authorization', token) : req;
}

describe('GET /api/v1/devices/:id/stats', () => {
  test('owner and viewer read stats; others get 401 or 404', async () => {
    expect((await get('period=WEEK', null)).status).toBe(401);
    expect((await get('period=WEEK', auth.stranger)).status).toBe(404);
    expect((await get('period=WEEK', auth.viewer)).status).toBe(200);
    expect((await get('period=WEEK')).status).toBe(200);
    const unknown = await get('period=WEEK', auth.owner, '0193a1c4-0000-7000-8000-0000000000ff');
    expect(unknown.status).toBe(404);
  });

  test('rejects an invalid range', async () => {
    const custom = await get('period=CUSTOM&from=2026-01-01');
    expect(custom.status).toBe(400);
    expect(custom.body.error.code).toBe('validation_error');
    expect((await get('period=WEEK&from=2026-02-30')).status).toBe(400);
    expect((await get('period=WEEK&from=2026-11-23&to=2026-11-29')).status).toBe(400);
  });

  test('uses the caller timezone', async () => {
    const owner = await get('period=DAY&from=2026-11-20');
    const viewer = await get('period=DAY&from=2026-11-20', auth.viewer);
    expect(owner.body).toMatchObject({ timezone: 'Europe/Kyiv', from: '2026-11-19T22:00:00.000Z' });
    expect(viewer.body).toMatchObject({
      timezone: 'America/New_York',
      from: '2026-11-20T05:00:00.000Z',
    });
  });

  test('a year of daily outages gives 12 month buckets', async () => {
    await boot(BOOT_A, new Date('2025-12-01T00:00:00Z'));
    const start = Date.parse('2025-12-25T10:00:00Z');
    const rows = Array.from({ length: 366 }, (_row, i) => {
      const startedAt = new Date(start + i * 86_400_000);
      return {
        deviceId,
        type: 'OUTAGE' as const,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 600_000),
        cause: 'POWER' as const,
        kind: 'LONG' as const,
      };
    });
    await t.db.insert(outage).values(rows);
    const res = await get('period=YEAR&from=2026-03-01');
    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe('MONTH');
    expect(res.body.buckets).toHaveLength(12);
    expect(res.body.outages).toBe(359);
    expect(res.body.long_outages).toBe(359);
    expect(res.body.by_cause.power).toBe(359);
  });

  test('availability starts at the first check-in, even after a re-pair', async () => {
    await boot(BOOT_B, new Date('2026-11-26T08:00:00Z'));
    await boot(BOOT_A, new Date('2026-11-25T08:00:00Z'));
    await t.db.insert(outage).values({
      deviceId,
      type: 'OUTAGE',
      startedAt: new Date('2026-11-26T09:00:00Z'),
      endedAt: null,
    });
    const res = await get('period=WEEK');
    expect(res.status).toBe(200);
    expect(res.body.monitoring_since).toBe('2026-11-25T08:00:00.000Z');
    expect(res.body.buckets[0].availability_pct).toBeNull();
    expect(res.body.buckets[2].availability_pct).not.toBeNull();
    expect(res.body).toMatchObject({ outages: 1, open_outage: true, total_downtime_s: 90_000 });
  });

  test('a device that never checked in has zero counts and no availability', async () => {
    const res = await get('period=MONTH&from=2026-11-01');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outages: 0, availability_pct: null, monitoring_since: null });
    expect(res.body.buckets).toHaveLength(30);
  });

  test("other devices' outages don't count", async () => {
    const otherId = (
      await createDevice(t.db, (await createUser(t.db, { email: 'x@example.com' })).id)
    ).id;
    await t.db.insert(outage).values({
      deviceId: otherId,
      type: 'OUTAGE',
      startedAt: new Date('2026-11-26T09:00:00Z'),
      endedAt: null,
    });
    expect((await get('period=WEEK')).body.outages).toBe(0);
  });
});
