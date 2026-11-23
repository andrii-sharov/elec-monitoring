import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { appUser, device, deviceBoot, deviceDiagnostic, outage } from '../../db/schema/index.ts';
import { sha256 } from '../../lib/crypto.ts';
import { toOutageItem } from './views.ts';

let t: TestDb;
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
});

function app() {
  return testApp({ db: t.db, clock });
}

let emailCounter = 0;

async function authed(overrides: Parameters<typeof createUser>[1] = {}) {
  emailCounter += 1;
  const user = await createUser(t.db, { email: `john${emailCounter}@example.com`, ...overrides });
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  return { user, auth: `Bearer ${accessToken}` };
}

const defaultSettings = {
  ping_interval_s: 30,
  offline_timeout_s: 120,
  short_outage_threshold_s: 180,
  notify_short_outages: true,
  notify_network_outages: true,
  quiet_hours: null,
  auto_update: false,
};

describe('POST /api/v1/devices', () => {
  test('creates a PENDING device with a pairing code', async () => {
    const { auth } = await authed();
    const res = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', auth)
      .send({ name: 'Home' });
    expect(res.status).toBe(201);
    expect(res.body.device).toMatchObject({
      name: 'Home',
      role: 'OWNER',
      state: 'PENDING',
      state_since: '2026-11-21T16:42:00.000Z',
      last_seen_at: null,
      open_outage: null,
      settings: defaultSettings,
    });
    expect(res.body.pairing_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(res.body.pairing_code_expires_at).toBe('2026-11-21T17:12:00.000Z');
    const [row] = await t.db.select().from(device).where(eq(device.id, res.body.device.id));
    expect(row!.pairingCodeHash).toEqual(sha256(res.body.pairing_code));
  });

  test('trims the name', async () => {
    const { auth } = await authed();
    const res = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', auth)
      .send({ name: '  Dacha ' });
    expect(res.body.device.name).toBe('Dacha');
  });

  test.each([{ name: '' }, { name: '   ' }, { name: 'x'.repeat(65) }, {}])(
    'rejects %j',
    async (body) => {
      const { auth } = await authed();
      const res = await request(app())
        .post('/api/v1/devices')
        .set('Authorization', auth)
        .send(body);
      expect(res.status).toBe(400);
    },
  );

  test('requires a verified email', async () => {
    const { auth } = await authed({ emailVerifiedAt: null });
    const res = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', auth)
      .send({ name: 'Home' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_not_verified');
  });

  test('requires a JWT', async () => {
    const res = await request(app()).post('/api/v1/devices').send({ name: 'Home' });
    expect(res.status).toBe(401);
  });

  test('caps an owner at 20 devices', async () => {
    const { user, auth } = await authed();
    for (let i = 0; i < 20; i += 1) await createDevice(t.db, user.id);
    const res = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', auth)
      .send({ name: 'Home' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');

    const other = await authed();
    const ok = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', other.auth)
      .send({ name: 'Home' });
    expect(ok.status).toBe(201);
  });
});

describe('GET /api/v1/devices', () => {
  test('lists only own devices, oldest first, without detail fields', async () => {
    const { user, auth } = await authed();
    const stranger = await authed();
    await createDevice(t.db, user.id, {
      name: 'First',
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });
    await createDevice(t.db, user.id, {
      name: 'Second',
      createdAt: new Date('2026-11-02T00:00:00Z'),
    });
    await createDevice(t.db, stranger.user.id, { name: 'Other' });
    const res = await request(app()).get('/api/v1/devices').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((d: { name: string }) => d.name)).toEqual(['First', 'Second']);
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('telemetry');
      expect(item).not.toHaveProperty('settings_sync');
      expect(item).not.toHaveProperty('firmware');
      expect(item.role).toBe('OWNER');
    }
  });
});

describe('GET /api/v1/devices/:id', () => {
  test('returns the full device with telemetry and open outage', async () => {
    const { user, auth } = await authed();
    const bootId = '0193a1c4-0000-7000-8000-000000000001';
    const row = await createDevice(t.db, user.id, {
      state: 'OFFLINE',
      lastSeenAt: new Date('2026-11-21T16:00:00Z'),
      bootId,
      seq: 9,
      uptimeS: 9420,
      rssi: -61,
      fwVersion: '2.0.0',
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
    });
    await t.db.insert(deviceBoot).values({ deviceId: row.id, bootId, resetReason: 'BROWNOUT' });
    const [open] = await t.db
      .insert(outage)
      .values({ deviceId: row.id, type: 'OUTAGE', startedAt: new Date('2026-11-21T16:00:00Z') })
      .returning();

    const res = await request(app()).get(`/api/v1/devices/${row.id}`).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: row.id,
      name: 'Home',
      role: 'OWNER',
      state: 'OFFLINE',
      state_since: row.stateSince.toISOString(),
      last_seen_at: '2026-11-21T16:00:00.000Z',
      open_outage: JSON.parse(JSON.stringify(toOutageItem(open!))),
      telemetry: { rssi: -61, uptime_s: 9420, reset_reason: 'BROWNOUT' },
      settings: { ...defaultSettings, quiet_hours: { start: '23:00', end: '07:00' } },
      settings_sync: { desired_version: 1, applied_version: null, pending: true },
      firmware: { version: '2.0.0', available: null, update: null },
    });
    expect(res.body.open_outage).toMatchObject({ type: 'OUTAGE', ended_at: null, cause: null });
  });

  test('hides a stranger device', async () => {
    const owner = await authed();
    const stranger = await authed();
    const row = await createDevice(t.db, owner.user.id);
    const res = await request(app())
      .get(`/api/v1/devices/${row.id}`)
      .set('Authorization', stranger.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  test('rejects a malformed id', async () => {
    const { auth } = await authed();
    const res = await request(app()).get('/api/v1/devices/not-a-uuid').set('Authorization', auth);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/devices/:id', () => {
  test('deletes the device and its history', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id);
    const kept = await createDevice(t.db, user.id, { name: 'Kept' });
    const bootId = '0193a1c4-0000-7000-8000-000000000002';
    await t.db.insert(deviceBoot).values({ deviceId: row.id, bootId, resetReason: 'POWER_ON' });
    await t.db.insert(deviceDiagnostic).values({
      deviceId: row.id,
      bootId,
      localId: 1,
      kind: 'WIFI',
      startUptimeS: 1,
      endUptimeS: 2,
      startedAt: clock.now(),
      endedAt: clock.now(),
    });
    await t.db.insert(outage).values({ deviceId: row.id, type: 'OUTAGE', startedAt: clock.now() });

    const res = await request(app()).delete(`/api/v1/devices/${row.id}`).set('Authorization', auth);
    expect(res.status).toBe(204);
    expect(await t.db.select().from(outage)).toHaveLength(0);
    expect(await t.db.select().from(deviceBoot)).toHaveLength(0);
    expect(await t.db.select().from(deviceDiagnostic)).toHaveLength(0);
    const remaining = await t.db.select().from(device);
    expect(remaining.map((d) => d.id)).toEqual([kept.id]);
  });

  test('hides a stranger device', async () => {
    const owner = await authed();
    const stranger = await authed();
    const row = await createDevice(t.db, owner.user.id);
    const res = await request(app())
      .delete(`/api/v1/devices/${row.id}`)
      .set('Authorization', stranger.auth);
    expect(res.status).toBe(404);
    expect(await t.db.select().from(device)).toHaveLength(1);
  });
});

describe('PATCH /api/v1/devices/:id', () => {
  test('updates the name and settings', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id);
    clock.advance(60_000);
    const res = await request(app())
      .patch(`/api/v1/devices/${row.id}`)
      .set('Authorization', auth)
      .send({ name: 'Dacha', settings: { notify_short_outages: false } });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Dacha');
    expect(res.body.settings.notify_short_outages).toBe(false);
    const [updated] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  test('bumps the settings version on an interval change', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id);
    const res = await request(app())
      .patch(`/api/v1/devices/${row.id}`)
      .set('Authorization', auth)
      .send({ settings: { ping_interval_s: 60 } });
    expect(res.body.settings_sync).toEqual({
      desired_version: 2,
      applied_version: null,
      pending: true,
    });
  });

  test('reports the cross-field error', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id);
    const res = await request(app())
      .patch(`/api/v1/devices/${row.id}`)
      .set('Authorization', auth)
      .send({ settings: { ping_interval_s: 90 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'validation_error',
      details: [{ path: 'settings.offline_timeout_s', code: 'too_small', min: 180 }],
    });
  });

  test.each([{ owner_id: 'x' }, { settings: { unknown: 1 } }, { name: '' }])(
    'rejects %j',
    async (body) => {
      const { user, auth } = await authed();
      const row = await createDevice(t.db, user.id);
      const res = await request(app())
        .patch(`/api/v1/devices/${row.id}`)
        .set('Authorization', auth)
        .send(body);
      expect(res.status).toBe(400);
    },
  );

  test('an empty body changes nothing', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id);
    const res = await request(app())
      .patch(`/api/v1/devices/${row.id}`)
      .set('Authorization', auth)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Home');
  });
});

describe('pairing code and token rotation', () => {
  test('a new pairing code replaces the old one and keeps the token', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id, {
      tokenHash: sha256('token'),
      pairingCodeHash: sha256('OLDCODE2'),
      pairingCodeExpiresAt: new Date('2026-11-21T16:50:00Z'),
    });
    const res = await request(app())
      .post(`/api/v1/devices/${row.id}/pairing-code`)
      .set('Authorization', auth);
    expect(res.status).toBe(201);
    expect(res.body.pairing_code_expires_at).toBe('2026-11-21T17:12:00.000Z');
    const [updated] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(updated!.pairingCodeHash).toEqual(sha256(res.body.pairing_code));
    expect(updated!.tokenHash).toEqual(sha256('token'));
  });

  test('rotating the token clears it', async () => {
    const { user, auth } = await authed();
    const row = await createDevice(t.db, user.id, { tokenHash: sha256('token') });
    const res = await request(app())
      .post(`/api/v1/devices/${row.id}/rotate-token`)
      .set('Authorization', auth);
    expect(res.status).toBe(204);
    const [updated] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(updated!.tokenHash).toBeNull();
  });

  test.each([
    ['patch', ''],
    ['post', '/pairing-code'],
    ['post', '/rotate-token'],
  ] as const)('a stranger gets 404 on %s %s', async (method, suffix) => {
    const owner = await authed();
    const stranger = await authed();
    const row = await createDevice(t.db, owner.user.id, { tokenHash: sha256('token') });
    const agent = request(app());
    const res = await agent[method](`/api/v1/devices/${row.id}${suffix}`)
      .set('Authorization', stranger.auth)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
    const [unchanged] = await t.db.select().from(device).where(eq(device.id, row.id));
    expect(unchanged!.name).toBe('Home');
    expect(unchanged!.tokenHash).toEqual(sha256('token'));
  });
});
