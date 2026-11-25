import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../../test/channels.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { addViewer } from '../../../test/sharing.ts';
import { appUser, device, deviceChannel, deviceViewer } from '../../db/schema/index.ts';
import type { User } from '../auth/middleware.ts';

let t: TestDb;
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

let john: User;
let mary: User;
let pete: User;
let deviceId: string;
const auth = {} as Record<'john' | 'mary' | 'pete' | 'anna', string>;

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  john = await createUser(t.db, { email: 'john@example.com', name: 'John' });
  mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
  pete = await createUser(t.db, { email: 'pete@example.com', name: 'Pete' });
  const anna = await createUser(t.db, { email: 'anna@example.com', name: 'Anna' });
  deviceId = (
    await createDevice(t.db, john.id, { name: 'Home', createdAt: new Date('2026-11-01T10:00:00Z') })
  ).id;
  await t.db.insert(deviceViewer).values([
    { deviceId, userId: mary.id, createdAt: new Date('2026-11-02T10:00:00Z') },
    { deviceId, userId: pete.id, createdAt: new Date('2026-11-03T10:00:00Z') },
  ]);
  for (const [key, user] of [
    ['john', john],
    ['mary', mary],
    ['pete', pete],
    ['anna', anna],
  ] as const) {
    const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
    auth[key] = `Bearer ${accessToken}`;
  }
});

const app = () => testApp({ db: t.db, clock });

const members = (as: string) =>
  request(app()).get(`/api/v1/devices/${deviceId}/members`).set('Authorization', as);

const remove = (userId: string, as: string) =>
  request(app()).delete(`/api/v1/devices/${deviceId}/members/${userId}`).set('Authorization', as);

describe('GET /api/v1/devices/:id/members', () => {
  test('the owner sees everyone with emails, owner first', async () => {
    const res = await members(auth.john);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        user_id: john.id,
        name: 'John',
        email: 'john@example.com',
        role: 'OWNER',
        joined_at: '2026-11-01T10:00:00.000Z',
      },
      {
        user_id: mary.id,
        name: 'Mary',
        email: 'mary@example.com',
        role: 'VIEWER',
        joined_at: '2026-11-02T10:00:00.000Z',
      },
      {
        user_id: pete.id,
        name: 'Pete',
        email: 'pete@example.com',
        role: 'VIEWER',
        joined_at: '2026-11-03T10:00:00.000Z',
      },
    ]);
  });

  test('a viewer sees names and only their own email', async () => {
    const res = await members(auth.mary);
    expect(
      res.body.items.map((m: { name: string; email: string | null }) => [m.name, m.email]),
    ).toEqual([
      ['John', null],
      ['Mary', 'mary@example.com'],
      ['Pete', null],
    ]);
  });

  test('a stranger gets 404', async () => {
    expect((await members(auth.anna)).status).toBe(404);
  });
});

describe('DELETE /api/v1/devices/:id/members/:userId', () => {
  test('the owner removes a viewer and only their links to this device', async () => {
    const other = await createDevice(t.db, john.id, { name: 'Cottage' });
    await addViewer(t.db, other.id, mary.id);
    const maryChannel = await createPlatformChannel(t.db, mary.id);
    const peteChannel = await createPlatformChannel(t.db, pete.id);
    await linkChannel(t.db, deviceId, maryChannel.id);
    await linkChannel(t.db, other.id, maryChannel.id);
    await linkChannel(t.db, deviceId, peteChannel.id);

    expect((await remove(mary.id, auth.john)).status).toBe(204);
    const seen = await request(app())
      .get(`/api/v1/devices/${deviceId}`)
      .set('Authorization', auth.mary);
    expect(seen.status).toBe(404);
    const links = await t.db.select().from(deviceChannel);
    expect(links.map((l) => [l.deviceId, l.channelId]).sort()).toEqual(
      [
        [other.id, maryChannel.id],
        [deviceId, peteChannel.id],
      ].sort(),
    );
  });

  test('a viewer leaves', async () => {
    expect((await remove(mary.id, auth.mary)).status).toBe(204);
    const rows = await t.db
      .select()
      .from(deviceViewer)
      .where(and(eq(deviceViewer.deviceId, deviceId), eq(deviceViewer.userId, mary.id)));
    expect(rows).toEqual([]);
  });

  test('a viewer cannot remove another viewer', async () => {
    const res = await remove(pete.id, auth.mary);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  test('a viewer cannot remove the owner', async () => {
    expect((await remove(john.id, auth.mary)).status).toBe(403);
  });

  test('the owner cannot be removed', async () => {
    const res = await remove(john.id, auth.john);
    expect(res.status).toBe(409);
    expect((await t.db.select().from(device)).length).toBe(1);
  });

  test('removing a non-member is 404', async () => {
    const anna = await t.db.select().from(appUser).where(eq(appUser.email, 'anna@example.com'));
    expect((await remove(anna[0]!.id, auth.john)).status).toBe(404);
  });

  test('a stranger gets 404', async () => {
    expect((await remove(mary.id, auth.anna)).status).toBe(404);
  });
});
