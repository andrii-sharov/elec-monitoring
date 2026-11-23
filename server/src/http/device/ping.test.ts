import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp } from '../../../test/app.ts';
import { createUser } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { pairDevice, pingBody } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { appUser, device, deviceBoot, deviceDiagnostic } from '../../db/schema/index.ts';
import type { RateLimiter } from '../../rateLimit/limiter.ts';

let t: TestDb;
let clock: FakeClock;
let token: string;
let deviceId: string;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const user = await createUser(t.db);
  const paired = await pairDevice(t.db, user.id);
  token = paired.token;
  deviceId = paired.device.id;
});

function ping(body: object, overrides: Parameters<typeof testApp>[0] = {}) {
  return request(testApp({ db: t.db, clock, ...overrides }))
    .post('/api/v1/device/ping')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

test('an accepted check-in answers 204 with no body', async () => {
  const res = await ping(pingBody({ type: 'BOOT', seq: 1 }));
  expect(res.status).toBe(204);
  expect(res.text).toBe('');
  const [row] = await t.db.select().from(device).where(eq(device.id, deviceId));
  expect(row!.state).toBe('ONLINE');
});

test('an unknown reset reason is stored as UNKNOWN', async () => {
  const res = await ping(pingBody({ type: 'BOOT', seq: 1, reset_reason: 'DEEP_SLEEP' }));
  expect(res.status).toBe(204);
  const [boot] = await t.db.select().from(deviceBoot);
  expect(boot!.resetReason).toBe('UNKNOWN');
});

test('a buggy Wi-Fi record is skipped and the check-in accepted', async () => {
  const res = await ping(
    pingBody({
      uptime_s: 300,
      wifi: {
        evicted: 1,
        events: [
          { id: 1, kind: 'WIFI', start_uptime_s: 200, end_uptime_s: 100, reason: 2 },
          { id: 2, kind: 'WIFI', start_uptime_s: 200, end_uptime_s: 400, reason: 2 },
          { id: 3, kind: 'API', start_uptime_s: 100, end_uptime_s: 130 },
        ],
      },
    }),
  );
  expect(res.status).toBe(204);
  const rows = await t.db.select().from(deviceDiagnostic);
  expect(rows.map((r) => r.localId)).toEqual([3]);
});

test.each([
  ['missing boot_id', pingBody({ boot_id: undefined })],
  ['unknown type', pingBody({ type: 'HELLO' })],
  ['negative seq', pingBody({ seq: -1 })],
  [
    'too many Wi-Fi events',
    pingBody({
      wifi: {
        evicted: 0,
        events: Array.from({ length: 33 }, (_, i) => ({
          id: i,
          kind: 'WIFI',
          start_uptime_s: 1,
          end_uptime_s: 2,
        })),
      },
    }),
  ],
])('%s is rejected', async (_name, body) => {
  expect((await ping(body)).status).toBe(400);
});

test('no token is unauthorized', async () => {
  const res = await request(testApp({ db: t.db, clock }))
    .post('/api/v1/device/ping')
    .send(pingBody());
  expect(res.status).toBe(401);
});

test('a rate-limited device gets 429 with Retry-After', async () => {
  const deny: RateLimiter = { hit: () => Promise.resolve({ allowed: false, retryAfterS: 42 }) };
  const res = await ping(pingBody(), { rateLimiter: deny });
  expect(res.status).toBe(429);
  expect(res.headers['retry-after']).toBe('42');
});
