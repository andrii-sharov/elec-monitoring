import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { appUser, device } from '../../db/schema/index.ts';
import { hashPairingCode } from '../../devices/credentials.ts';
import { sha256 } from '../../lib/crypto.ts';

let t: TestDb;
let clock: FakeClock;
let ownerId: string;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  ownerId = (await createUser(t.db)).id;
});

function app() {
  return testApp({ db: t.db, clock });
}

async function withCode(code = 'K7Q2M9XD', overrides: Parameters<typeof createDevice>[2] = {}) {
  return createDevice(t.db, ownerId, {
    pairingCodeHash: hashPairingCode(code),
    pairingCodeExpiresAt: new Date('2026-11-21T17:12:00Z'),
    ...overrides,
  });
}

const claim = (body: object) => request(app()).post('/api/v1/device/claim').send(body);

test('claims the device and resets the boot baseline', async () => {
  const row = await withCode('K7Q2M9XD', {
    bootId: '0193a1c4-0000-7000-8000-000000000001',
    seq: 40,
    settingsVersion: 3,
    pingIntervalS: 45,
  });
  const res = await claim({ pairing_code: 'K7Q2M9XD', fw: '2.0.0' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    device_id: row.id,
    device_token: expect.stringMatching(/^[0-9a-f]{64}$/),
    settings: { version: 3, ping_interval_s: 45 },
  });
  const [claimed] = await t.db.select().from(device).where(eq(device.id, row.id));
  expect(claimed).toMatchObject({
    tokenHash: sha256(res.body.device_token),
    claimedAt: clock.now(),
    fwVersion: '2.0.0',
    pairingCodeHash: null,
    pairingCodeExpiresAt: null,
    bootId: null,
    seq: null,
    appliedSettingsVersion: 3,
  });
});

test('accepts a hand-typed code', async () => {
  const row = await withCode('K7Q2M9XD');
  const res = await claim({ pairing_code: 'k7q2-m9xd ', fw: '2.0.0' });
  expect(res.status).toBe(200);
  expect(res.body.device_id).toBe(row.id);
});

test('a used code is not found', async () => {
  await withCode();
  expect((await claim({ pairing_code: 'K7Q2M9XD', fw: '2.0.0' })).status).toBe(200);
  const res = await claim({ pairing_code: 'K7Q2M9XD', fw: '2.0.0' });
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('not_found');
});

test('a code expires after 30 minutes', async () => {
  await withCode();
  clock.set(new Date('2026-11-21T17:12:00Z'));
  const res = await claim({ pairing_code: 'K7Q2M9XD', fw: '2.0.0' });
  expect(res.status).toBe(410);
  expect(res.body.error.code).toBe('expired');
});

test('a code still works one second before expiry', async () => {
  await withCode();
  clock.set(new Date('2026-11-21T17:11:59Z'));
  expect((await claim({ pairing_code: 'K7Q2M9XD', fw: '2.0.0' })).status).toBe(200);
});

test('an unknown code is not found', async () => {
  expect((await claim({ pairing_code: 'ZZZZZZZZ', fw: '2.0.0' })).status).toBe(404);
});

test.each([{ pairing_code: 'abc', fw: '2.0.0' }, { pairing_code: 'K7Q2M9XD' }, {}])(
  'rejects %j',
  async (body) => {
    expect((await claim(body)).status).toBe(400);
  },
);

test('re-pairing replaces the old token', async () => {
  const row = await withCode();
  const first = await claim({ pairing_code: 'K7Q2M9XD', fw: '2.0.0' });
  const user = await t.db.select().from(appUser).where(eq(appUser.id, ownerId));
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user[0]!.id);
  const code = await request(app())
    .post(`/api/v1/devices/${row.id}/pairing-code`)
    .set('Authorization', `Bearer ${accessToken}`);
  const second = await claim({ pairing_code: code.body.pairing_code, fw: '2.0.1' });
  expect(second.status).toBe(200);
  const [claimed] = await t.db.select().from(device).where(eq(device.id, row.id));
  expect(claimed!.tokenHash).toEqual(sha256(second.body.device_token));
  expect(claimed!.tokenHash).not.toEqual(sha256(first.body.device_token));
});
