import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { TEST_PASSWORD, createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { verifyAccessToken } from '../../auth/jwt.ts';
import { appUser } from '../../db/schema/index.ts';
import { toMe } from '../account/me.ts';

const DAY_MS = 86_400_000;
const ORIGIN = 'https://app.test';
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

function cookieHeader(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = header?.find((value) => value.startsWith('em_refresh='));
  if (!line) throw new Error('no refresh cookie');
  return line;
}

function cookieValue(res: request.Response): string {
  return cookieHeader(res).split(';')[0]!.slice('em_refresh='.length);
}

function login(email = ' JOHN@example.com ', password = TEST_PASSWORD) {
  return request(app()).post('/api/auth/login').send({ email, password });
}

function refresh(token: string, origin = ORIGIN) {
  return request(app())
    .post('/api/auth/refresh')
    .set('Origin', origin)
    .set('Cookie', `em_refresh=${token}`);
}

test('login returns a session and a hardened refresh cookie', async () => {
  const user = await createUser(t.db);
  const res = await login();
  expect(res.status).toBe(200);
  expect(res.body.expires_in).toBe(900);
  expect(res.body.user).toEqual(JSON.parse(JSON.stringify(toMe(user))));
  expect(res.body.user).toMatchObject({
    has_password: true,
    google_linked: false,
    is_admin: false,
  });

  const cookie = cookieHeader(res);
  expect(cookie).toMatch(/^em_refresh=/);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Path=/api/auth');
  expect(cookie).toContain('Max-Age=2592000');
  expect(cookie).not.toContain('Domain');

  const claims = await verifyAccessToken(testConfig.jwtSecret, clock, res.body.access_token);
  expect(claims?.userId).toBe(user.id);
});

test('an unverified user can log in', async () => {
  await createUser(t.db, { emailVerifiedAt: null });
  const res = await login();
  expect(res.status).toBe(200);
  expect(res.body.user.email_verified).toBe(false);
});

test('wrong password, unknown email and Google-only accounts look the same', async () => {
  await createUser(t.db);
  await createUser(t.db, { email: 'g@example.com', passwordHash: null, googleSub: 'sub-1' });
  const wrong = await login('john@example.com', 'wrong password');
  const unknown = await login('nobody@example.com');
  const googleOnly = await login('g@example.com');
  for (const res of [wrong, unknown, googleOnly]) {
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  }
  expect(unknown.body).toEqual(wrong.body);
  expect(googleOnly.body).toEqual(wrong.body);
});

test('refresh rotates the cookie', async () => {
  await createUser(t.db);
  const first = cookieValue(await login());
  clock.advance(60_000);
  const res = await refresh(first);
  expect(res.status).toBe(200);
  expect(res.body.access_token).toBeTruthy();
  const second = cookieValue(res);
  expect(second).not.toBe(first);

  clock.advance(60_000);
  expect((await refresh(second)).status).toBe(200);
});

test('replaying the old cookie within 10 s is a 409 without a new cookie', async () => {
  await createUser(t.db);
  const first = cookieValue(await login());
  await refresh(first);
  clock.advance(5_000);
  const res = await refresh(first);
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('conflict');
  expect(res.headers['set-cookie']).toBeUndefined();
});

test('replaying the old cookie after 10 s revokes the session', async () => {
  await createUser(t.db);
  const first = cookieValue(await login());
  const rotated = cookieValue(await refresh(first));
  clock.advance(11_000);
  const reuse = await refresh(first);
  expect(reuse.status).toBe(401);
  expect(cookieHeader(reuse)).toMatch(/^em_refresh=;/);
  expect((await refresh(rotated)).status).toBe(401);
});

test('refresh without a cookie is 401', async () => {
  const res = await request(app()).post('/api/auth/refresh').set('Origin', ORIGIN);
  expect(res.status).toBe(401);
});

test('refresh from a foreign origin is 403 and does not consume the token', async () => {
  await createUser(t.db);
  const first = cookieValue(await login());
  const res = await refresh(first, 'https://evil.test');
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('forbidden');
  expect((await refresh(first)).status).toBe(200);
});

test('refresh fails after 30 days', async () => {
  await createUser(t.db);
  const first = cookieValue(await login());
  clock.advance(30 * DAY_MS);
  expect((await refresh(first)).status).toBe(401);
});

test('logout clears the cookie and ends the session', async () => {
  await createUser(t.db);
  const first = cookieValue(await login());
  const res = await request(app())
    .post('/api/auth/logout')
    .set('Origin', ORIGIN)
    .set('Cookie', `em_refresh=${first}`);
  expect(res.status).toBe(204);
  expect(cookieHeader(res)).toMatch(/^em_refresh=;/);
  expect((await refresh(first)).status).toBe(401);
});

test('logout without a cookie is 204', async () => {
  const res = await request(app()).post('/api/auth/logout').set('Origin', ORIGIN);
  expect(res.status).toBe(204);
});

test('logout-all revokes every session', async () => {
  const user = await createUser(t.db);
  const deps = { db: t.db, clock, config: testConfig };
  const one = await signIn(deps, user.id);
  const two = await signIn(deps, user.id);
  const res = await request(app())
    .post('/api/auth/logout-all')
    .set('Authorization', `Bearer ${one.accessToken}`);
  expect(res.status).toBe(204);
  const jwtCheck = await request(app())
    .post('/api/auth/logout-all')
    .set('Authorization', `Bearer ${two.accessToken}`);
  expect(jwtCheck.status).toBe(401);
  expect((await refresh(two.refreshToken)).status).toBe(401);
  expect((await refresh(one.refreshToken)).status).toBe(401);
});
