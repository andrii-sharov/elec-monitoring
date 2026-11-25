import { resources } from '@elec/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { TEST_PASSWORD, createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { FakeClock, FakeEmailSender, linkFrom } from '../../../test/fakes.ts';
import { appUser, deviceViewer } from '../../db/schema/index.ts';
import { createDevice } from '../../../test/devices.ts';
import { seedInvite } from '../../../test/sharing.ts';

const NEW_PASSWORD = 'brand new pass 2';
let t: TestDb;
let clock: FakeClock;
let email: FakeEmailSender;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  email = new FakeEmailSender();
});

function app() {
  return testApp({ db: t.db, clock, email });
}

function tokenFrom(message: Parameters<typeof linkFrom>[0]): string {
  return new URL(linkFrom(message)).searchParams.get('token') ?? '';
}

async function requestReset(address = 'john@example.com'): Promise<string> {
  const before = email.sent.length;
  const res = await request(app()).post('/api/auth/forgot-password').send({ email: address });
  expect(res.status).toBe(204);
  await vi.waitFor(() => expect(email.sent).toHaveLength(before + 1));
  return tokenFrom(email.sent[before]!);
}

function login(password: string) {
  return request(app()).post('/api/auth/login').send({ email: 'john@example.com', password });
}

test('forgot-password sends a reset email in the user language', async () => {
  await createUser(t.db, { language: 'ru' });
  const res = await request(app())
    .post('/api/auth/forgot-password')
    .send({ email: ' John@Example.com' });
  expect(res.status).toBe(204);
  await vi.waitFor(() => expect(email.sent).toHaveLength(1));
  expect(email.sent[0]?.subject).toBe(resources.ru.translation.email.resetPassword.subject);
  expect(linkFrom(email.sent[0]!)).toMatch(/^https:\/\/app\.test\/reset-password\?token=/);
});

test('forgot-password for an unknown email answers 204 and sends nothing', async () => {
  const res = await request(app())
    .post('/api/auth/forgot-password')
    .send({ email: 'nobody@example.com' });
  expect(res.status).toBe(204);
  expect(email.sent).toHaveLength(0);
});

test('forgot-password lets a Google-only user add a password', async () => {
  await createUser(t.db, { passwordHash: null, googleSub: 'sub-1' });
  await requestReset();
  expect(email.sent).toHaveLength(1);
});

test('reset-password sets the password, verifies the email and ends every session', async () => {
  const user = await createUser(t.db, { emailVerifiedAt: null });
  const { refreshToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const token = await requestReset();

  const res = await request(app())
    .post('/api/auth/reset-password')
    .send({ token, password: NEW_PASSWORD });
  expect(res.status).toBe(204);

  expect((await login(NEW_PASSWORD)).status).toBe(200);
  expect((await login(TEST_PASSWORD)).status).toBe(401);
  const refresh = await request(app())
    .post('/api/auth/refresh')
    .set('Origin', 'https://app.test')
    .set('Cookie', `em_refresh=${refreshToken}`);
  expect(refresh.status).toBe(401);
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row?.emailVerifiedAt).toEqual(clock.now());
});

test('a newer reset link invalidates an older one once used', async () => {
  await createUser(t.db);
  const first = await requestReset();
  const second = await requestReset();
  expect(
    (
      await request(app())
        .post('/api/auth/reset-password')
        .send({ token: second, password: NEW_PASSWORD })
    ).status,
  ).toBe(204);
  expect(
    (
      await request(app())
        .post('/api/auth/reset-password')
        .send({ token: first, password: NEW_PASSWORD })
    ).status,
  ).toBe(410);
});

test('a reset link expires after 1 hour', async () => {
  await createUser(t.db);
  const token = await requestReset();
  clock.advance(3_600_000);
  const res = await request(app())
    .post('/api/auth/reset-password')
    .send({ token, password: NEW_PASSWORD });
  expect(res.status).toBe(410);
  expect(res.body.error.code).toBe('expired');
});

test('a too-short new password is a 400 and the token stays usable', async () => {
  await createUser(t.db);
  const token = await requestReset();
  const bad = await request(app())
    .post('/api/auth/reset-password')
    .send({ token, password: 'short' });
  expect(bad.status).toBe(400);
  const good = await request(app())
    .post('/api/auth/reset-password')
    .send({ token, password: NEW_PASSWORD });
  expect(good.status).toBe(204);
});

test('change-password revokes other sessions but keeps the current one', async () => {
  const user = await createUser(t.db);
  const deps = { db: t.db, clock, config: testConfig };
  const current = await signIn(deps, user.id);
  const other = await signIn(deps, user.id);
  const res = await request(app())
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${current.accessToken}`)
    .send({ current_password: TEST_PASSWORD, new_password: NEW_PASSWORD });
  expect(res.status).toBe(204);

  const refresh = (token: string) =>
    request(app())
      .post('/api/auth/refresh')
      .set('Origin', 'https://app.test')
      .set('Cookie', `em_refresh=${token}`);
  expect((await refresh(current.refreshToken)).status).toBe(200);
  expect((await refresh(other.refreshToken)).status).toBe(401);
  expect((await login(NEW_PASSWORD)).status).toBe(200);
});

test('change-password with a wrong current password is 403 invalid_credentials', async () => {
  const user = await createUser(t.db);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ current_password: 'wrong password', new_password: NEW_PASSWORD });
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('invalid_credentials');
});

test('change-password on a Google-only account is 409', async () => {
  const user = await createUser(t.db, { passwordHash: null, googleSub: 'sub-1' });
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ current_password: 'anything', new_password: NEW_PASSWORD });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('conflict');
});

test('change-password needs a JWT', async () => {
  const res = await request(app())
    .post('/api/auth/change-password')
    .send({ current_password: 'a', new_password: NEW_PASSWORD });
  expect(res.status).toBe(401);
});

async function pendingInviteFor(address: string) {
  const owner = await createUser(t.db, { email: 'owner@example.com', name: 'Owner' });
  const home = await createDevice(t.db, owner.id, { name: 'Home' });
  await seedInvite(t.db, { deviceId: home.id, invitedBy: owner.id, email: address });
  return home.id;
}

test('reset of an unverified account accepts its pending invites', async () => {
  const user = await createUser(t.db, { emailVerifiedAt: null });
  const deviceId = await pendingInviteFor('john@example.com');
  const token = await requestReset();
  await request(app()).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });
  expect(await t.db.select().from(deviceViewer)).toEqual([
    expect.objectContaining({ deviceId, userId: user.id }),
  ]);
});

test('reset of a verified account leaves its pending invites alone', async () => {
  await createUser(t.db);
  await pendingInviteFor('john@example.com');
  const token = await requestReset();
  await request(app()).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });
  expect(await t.db.select().from(deviceViewer)).toEqual([]);
});

test('reset of an unverified account unlinks a Google account someone attached to it', async () => {
  const user = await createUser(t.db, { emailVerifiedAt: null, googleSub: 'attacker-sub' });
  const token = await requestReset();
  await request(app()).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row?.googleSub).toBeNull();
});

test('reset of a verified account keeps its Google link', async () => {
  const user = await createUser(t.db, { googleSub: 'sub-1' });
  const token = await requestReset();
  await request(app()).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row?.googleSub).toBe('sub-1');
});
