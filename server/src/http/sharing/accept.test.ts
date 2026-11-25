import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { TEST_PASSWORD, createUser, signIn } from '../../../test/auth.ts';
import { createPlatformChannel } from '../../../test/channels.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock, FakeEmailSender, linkFrom } from '../../../test/fakes.ts';
import { seedInvite } from '../../../test/sharing.ts';
import {
  appUser,
  deviceChannel,
  deviceInvite,
  deviceViewer,
  notificationChannel,
} from '../../db/schema/index.ts';
import type { User } from '../auth/middleware.ts';

let t: TestDb;
let clock: FakeClock;
let email: FakeEmailSender;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

let owner: User;
let deviceId: string;

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  email = new FakeEmailSender();
  owner = await createUser(t.db, { email: 'john@example.com', name: 'John' });
  deviceId = (await createDevice(t.db, owner.id, { name: 'Home' })).id;
});

const app = () => testApp({ db: t.db, clock, email });

async function bearerFor(user: User): Promise<string> {
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  return `Bearer ${accessToken}`;
}

const accept = (token: string, auth: string) =>
  request(app()).post(`/api/v1/invites/${token}/accept`).set('Authorization', auth);

const inviteMary = (o: { expiresAt?: Date } = {}) =>
  seedInvite(t.db, { deviceId, invitedBy: owner.id, email: 'mary@example.com', ...o });

const viewers = () => t.db.select().from(deviceViewer).where(eq(deviceViewer.deviceId, deviceId));

async function maryWithChannels() {
  const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
  const telegram = await createPlatformChannel(t.db, mary.id);
  const [webhook] = await t.db
    .insert(notificationChannel)
    .values({
      userId: mary.id,
      type: 'WEBHOOK',
      name: 'Home Assistant',
      webhookUrl: 'https://hooks.example.com/x',
      webhookEvents: ['device.offline'],
      webhookSecretEnc: Buffer.from('secret'),
    })
    .returning();
  return { mary, channelIds: [telegram.id, webhook!.id] };
}

describe('POST /api/v1/invites/:token/accept', () => {
  test('joins as a viewer with all own channels attached', async () => {
    const { mary, channelIds } = await maryWithChannels();
    const { token } = await inviteMary();
    const auth = await bearerFor(mary);
    const res = await accept(token, auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: deviceId, name: 'Home', role: 'VIEWER' });
    const linked = await request(app())
      .get(`/api/v1/devices/${deviceId}/channels`)
      .set('Authorization', auth);
    expect([...linked.body.channel_ids].toSorted()).toEqual([...channelIds].toSorted());
    const [row] = await t.db.select().from(deviceInvite);
    expect(row?.acceptedAt).toEqual(clock.now());
  });

  test('works until the last second of the 7 days', async () => {
    const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
    const { token } = await inviteMary();
    clock.set(new Date('2026-11-28T16:41:59Z'));
    expect((await accept(token, await bearerFor(mary))).status).toBe(200);
  });

  test('an expired invite is gone', async () => {
    const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
    const { token } = await inviteMary();
    clock.set(new Date('2026-11-28T16:42:01Z'));
    const res = await accept(token, await bearerFor(mary));
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('expired');
    expect(await viewers()).toHaveLength(0);
  });

  test('another account cannot accept', async () => {
    const pete = await createUser(t.db, { email: 'pete@example.com', name: 'Pete' });
    const { token } = await inviteMary();
    const res = await accept(token, await bearerFor(pete));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(await viewers()).toHaveLength(0);
  });

  test('needs a JWT', async () => {
    const { token } = await inviteMary();
    expect((await request(app()).post(`/api/v1/invites/${token}/accept`)).status).toBe(401);
  });

  test('accepting twice returns the device and joins once', async () => {
    const { mary } = await maryWithChannels();
    const { token } = await inviteMary();
    const auth = await bearerFor(mary);
    expect((await accept(token, auth)).status).toBe(200);
    const again = await accept(token, auth);
    expect(again.status).toBe(200);
    expect(again.body.role).toBe('VIEWER');
    expect(await viewers()).toHaveLength(1);
    expect(await t.db.select().from(deviceChannel)).toHaveLength(2);
  });

  test('two accepts at once both succeed and join once', async () => {
    const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
    const { token } = await inviteMary();
    const auth = await bearerFor(mary);
    const results = await Promise.all([accept(token, auth), accept(token, auth)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await viewers()).toHaveLength(1);
  });

  test('a removed viewer cannot reuse the accepted link', async () => {
    const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
    const { token } = await inviteMary();
    const auth = await bearerFor(mary);
    await accept(token, auth);
    await t.db
      .delete(deviceViewer)
      .where(and(eq(deviceViewer.deviceId, deviceId), eq(deviceViewer.userId, mary.id)));
    expect((await accept(token, auth)).status).toBe(410);
  });

  test('accepting verifies the email', async () => {
    const mary = await createUser(t.db, {
      email: 'mary@example.com',
      name: 'Mary',
      emailVerifiedAt: null,
    });
    const { token } = await inviteMary();
    expect((await accept(token, await bearerFor(mary))).status).toBe(200);
    const [row] = await t.db.select().from(appUser).where(eq(appUser.id, mary.id));
    expect(row?.emailVerifiedAt).toEqual(clock.now());
  });

  test('a revoked invite is gone', async () => {
    const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
    const { id, token } = await inviteMary();
    await t.db.delete(deviceInvite).where(eq(deviceInvite.id, id));
    expect((await accept(token, await bearerFor(mary))).status).toBe(410);
  });
});

describe('sign up, then the invite is applied', () => {
  test('verifying the email joins the device', async () => {
    const { token } = await inviteMary();
    const signup = await request(app()).post('/api/auth/signup').send({
      email: 'mary@example.com',
      password: TEST_PASSWORD,
      name: 'Mary',
      language: 'en',
      timezone: 'Europe/Kyiv',
    });
    expect(signup.status).toBe(201);
    await vi.waitFor(() => expect(email.sent).toHaveLength(1));
    const verifyToken = new URL(linkFrom(email.sent[0]!)).searchParams.get('token');
    const verified = await request(app())
      .post('/api/auth/verify-email')
      .send({ token: verifyToken });
    expect(verified.status).toBe(204);

    const login = await request(app())
      .post('/api/auth/login')
      .set('Origin', 'https://app.test')
      .send({ email: 'mary@example.com', password: TEST_PASSWORD });
    const auth = `Bearer ${login.body.access_token}`;
    const list = await request(app()).get('/api/v1/devices').set('Authorization', auth);
    expect(list.body.items).toEqual([expect.objectContaining({ id: deviceId, role: 'VIEWER' })]);
    expect((await accept(token, auth)).status).toBe(200);
  });

  test('an expired invite is not applied', async () => {
    await inviteMary({ expiresAt: new Date('2026-11-21T16:00:00Z') });
    await request(app()).post('/api/auth/signup').send({
      email: 'mary@example.com',
      password: TEST_PASSWORD,
      name: 'Mary',
      language: 'en',
      timezone: 'Europe/Kyiv',
    });
    await vi.waitFor(() => expect(email.sent).toHaveLength(1));
    const verifyToken = new URL(linkFrom(email.sent[0]!)).searchParams.get('token');
    await request(app()).post('/api/auth/verify-email').send({ token: verifyToken });
    expect(await viewers()).toHaveLength(0);
  });
});
