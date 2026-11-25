import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice, pairDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { addViewer, seedInvite } from '../../../test/sharing.ts';
import { appUser, device } from '../../db/schema/index.ts';
import type { User } from '../auth/middleware.ts';

let t: TestDb;
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

type Role = 'owner' | 'viewer' | 'stranger';
type Ctx = { deviceId: string; users: Record<Role, User>; inviteId?: string };
type Fixture = Ctx & { auth: Record<Role, string> };

let f: Fixture;

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const users = {
    owner: await createUser(t.db, { email: 'john@example.com', name: 'John' }),
    viewer: await createUser(t.db, { email: 'mary@example.com', name: 'Mary' }),
    stranger: await createUser(t.db, { email: 'pete@example.com', name: 'Pete' }),
  };
  const { device: paired } = await pairDevice(t.db, users.owner.id);
  await addViewer(t.db, paired.id, users.viewer.id);
  const auth = {} as Record<Role, string>;
  for (const role of ['owner', 'viewer', 'stranger'] as const) {
    const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, users[role].id);
    auth[role] = `Bearer ${accessToken}`;
  }
  f = { deviceId: paired.id, users, auth };
});

const app = () => testApp({ db: t.db, clock });

type Row = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: (c: Ctx) => string;
  body?: (c: Ctx) => object;
  setup?: (c: Ctx) => Promise<Partial<Ctx> | void>;
  expect: Record<Role, number>;
};

const errorCodeFor: Record<number, string | undefined> = { 403: 'forbidden', 404: 'not_found' };

const matrix: Record<string, Row> = {
  'GET device': {
    method: 'get',
    path: (c) => `/api/v1/devices/${c.deviceId}`,
    expect: { owner: 200, viewer: 200, stranger: 404 },
  },
  'PATCH device': {
    method: 'patch',
    path: (c) => `/api/v1/devices/${c.deviceId}`,
    body: () => ({ name: 'X' }),
    expect: { owner: 200, viewer: 403, stranger: 404 },
  },
  'DELETE device': {
    method: 'delete',
    path: (c) => `/api/v1/devices/${c.deviceId}`,
    expect: { owner: 204, viewer: 403, stranger: 404 },
  },
  'POST pairing-code': {
    method: 'post',
    path: (c) => `/api/v1/devices/${c.deviceId}/pairing-code`,
    expect: { owner: 201, viewer: 403, stranger: 404 },
  },
  'POST rotate-token': {
    method: 'post',
    path: (c) => `/api/v1/devices/${c.deviceId}/rotate-token`,
    expect: { owner: 204, viewer: 403, stranger: 404 },
  },
  'GET outages': {
    method: 'get',
    path: (c) => `/api/v1/devices/${c.deviceId}/outages`,
    expect: { owner: 200, viewer: 200, stranger: 404 },
  },
  'GET diagnostics': {
    method: 'get',
    path: (c) => `/api/v1/devices/${c.deviceId}/diagnostics`,
    expect: { owner: 200, viewer: 403, stranger: 404 },
  },
  'GET device channels': {
    method: 'get',
    path: (c) => `/api/v1/devices/${c.deviceId}/channels`,
    expect: { owner: 200, viewer: 200, stranger: 404 },
  },
  'PUT device channels': {
    method: 'put',
    path: (c) => `/api/v1/devices/${c.deviceId}/channels`,
    body: () => ({ channel_ids: [] }),
    expect: { owner: 200, viewer: 200, stranger: 404 },
  },
  'POST invites': {
    method: 'post',
    path: (c) => `/api/v1/devices/${c.deviceId}/invites`,
    body: () => ({ email: 'anna@example.com' }),
    expect: { owner: 201, viewer: 403, stranger: 404 },
  },
  'GET invites': {
    method: 'get',
    path: (c) => `/api/v1/devices/${c.deviceId}/invites`,
    expect: { owner: 200, viewer: 403, stranger: 404 },
  },
  'DELETE invite': {
    method: 'delete',
    path: (c) => `/api/v1/devices/${c.deviceId}/invites/${c.inviteId}`,
    setup: async (c) => ({
      inviteId: (
        await seedInvite(t.db, {
          deviceId: c.deviceId,
          invitedBy: c.users.owner.id,
          email: 'anna@example.com',
        })
      ).id,
    }),
    expect: { owner: 204, viewer: 403, stranger: 404 },
  },
};

describe('device endpoint role matrix', () => {
  for (const [name, row] of Object.entries(matrix)) {
    for (const role of ['owner', 'viewer', 'stranger'] as const) {
      test(`${name} as ${role} → ${row.expect[role]}`, async () => {
        const extra = (await row.setup?.(f)) ?? {};
        const ctx = { ...f, ...extra };
        let req = request(app())[row.method](row.path(ctx)).set('Authorization', f.auth[role]);
        if (row.body) req = req.send(row.body(ctx));
        const res = await req;
        expect(res.status).toBe(row.expect[role]);
        expect(res.body.error?.code).toBe(errorCodeFor[row.expect[role]]);
      });
    }
  }
});

describe('viewer role', () => {
  test('device details carry the caller role', async () => {
    const asViewer = await request(app())
      .get(`/api/v1/devices/${f.deviceId}`)
      .set('Authorization', f.auth.viewer);
    expect(asViewer.body.role).toBe('VIEWER');
    const asOwner = await request(app())
      .get(`/api/v1/devices/${f.deviceId}`)
      .set('Authorization', f.auth.owner);
    expect(asOwner.body.role).toBe('OWNER');
  });

  test('a viewer cannot rename or delete the device', async () => {
    await request(app())
      .patch(`/api/v1/devices/${f.deviceId}`)
      .set('Authorization', f.auth.viewer)
      .send({ name: 'Mine' });
    await request(app())
      .delete(`/api/v1/devices/${f.deviceId}`)
      .set('Authorization', f.auth.viewer);
    const [row] = await t.db.select().from(device).where(eq(device.id, f.deviceId));
    expect(row?.name).toBe('Home');
  });

  test('the list holds owned and shared devices, oldest first', async () => {
    const mary = f.users.viewer;
    const own = await createDevice(t.db, mary.id, {
      name: 'Cottage',
      createdAt: new Date('2026-11-21T17:00:00Z'),
    });
    await t.db
      .update(device)
      .set({ createdAt: new Date('2026-11-20T10:00:00Z') })
      .where(eq(device.id, f.deviceId));
    const res = await request(app()).get('/api/v1/devices').set('Authorization', f.auth.viewer);
    expect(res.status).toBe(200);
    expect(res.body.items.map((d: { id: string; role: string }) => [d.id, d.role])).toEqual([
      [f.deviceId, 'VIEWER'],
      [own.id, 'OWNER'],
    ]);
  });

  test('the stranger list stays empty', async () => {
    const res = await request(app()).get('/api/v1/devices').set('Authorization', f.auth.stranger);
    expect(res.body.items).toEqual([]);
  });

  test('shared devices do not count toward the device cap', async () => {
    const mary = f.users.viewer;
    for (let i = 0; i < 19; i += 1) await createDevice(t.db, mary.id, { name: `D${i}` });
    for (let i = 0; i < 4; i += 1) {
      const other = await createDevice(t.db, f.users.owner.id, { name: `S${i}` });
      await addViewer(t.db, other.id, mary.id);
    }
    const ok = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', f.auth.viewer)
      .send({ name: 'Twentieth' });
    expect(ok.status).toBe(201);
    const capped = await request(app())
      .post('/api/v1/devices')
      .set('Authorization', f.auth.viewer)
      .send({ name: 'Twenty-first' });
    expect(capped.status).toBe(409);
  });
});
