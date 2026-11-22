import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { TEST_PASSWORD, createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { appUser, refreshToken, session } from '../../db/schema/index.ts';
import { toMe } from './me.ts';

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

async function authed(overrides: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(t.db, overrides);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  return { user, auth: `Bearer ${accessToken}` };
}

test('GET /me returns the profile of a password user', async () => {
  const { user, auth } = await authed();
  const res = await request(app()).get('/api/v1/me').set('Authorization', auth);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    id: user.id,
    email: 'john@example.com',
    email_verified: true,
    name: 'John',
    language: 'uk',
    timezone: 'Europe/Kyiv',
    has_password: true,
    google_linked: false,
    is_admin: false,
  });
  expect(res.body).toEqual(JSON.parse(JSON.stringify(toMe(user))));
});

test('GET /me reflects a Google-only account and the admin flag', async () => {
  const { auth } = await authed({ passwordHash: null, googleSub: 'sub-1', isAdmin: true });
  const res = await request(app()).get('/api/v1/me').set('Authorization', auth);
  expect(res.body).toMatchObject({ has_password: false, google_linked: true, is_admin: true });
});

test('PATCH /me updates name, language and timezone', async () => {
  const { user, auth } = await authed();
  clock.advance(60_000);
  const res = await request(app())
    .patch('/api/v1/me')
    .set('Authorization', auth)
    .send({ language: 'en', timezone: 'utc', name: '  Johnny ' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ language: 'en', timezone: 'UTC', name: 'Johnny' });
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row?.updatedAt).toEqual(clock.now());
});

test.each([
  ['unknown language', { language: 'de' }],
  ['unknown key', { email: 'x@y.z' }],
  ['empty name', { name: '' }],
  ['bad timezone', { timezone: 'Mars/Base' }],
])('PATCH /me rejects %s', async (_name, body) => {
  const { auth } = await authed();
  const res = await request(app()).patch('/api/v1/me').set('Authorization', auth).send(body);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('validation_error');
});

test('PATCH /me with an empty body changes nothing', async () => {
  const { auth } = await authed();
  const res = await request(app()).patch('/api/v1/me').set('Authorization', auth).send({});
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('John');
});

test('DELETE /me with the right password removes the account and its sessions', async () => {
  const { auth } = await authed();
  const other = await createUser(t.db, { email: 'other@example.com' });
  const otherSession = await signIn({ db: t.db, clock, config: testConfig }, other.id);

  const res = await request(app())
    .delete('/api/v1/me')
    .set('Authorization', auth)
    .send({ password: TEST_PASSWORD });
  expect(res.status).toBe(204);

  expect(await t.db.select().from(appUser)).toHaveLength(1);
  expect(await t.db.select().from(session)).toHaveLength(1);
  expect(await t.db.select().from(refreshToken)).toHaveLength(1);
  expect((await request(app()).get('/api/v1/me').set('Authorization', auth)).status).toBe(401);
  const stillThere = await request(app())
    .get('/api/v1/me')
    .set('Authorization', `Bearer ${otherSession.accessToken}`);
  expect(stillThere.status).toBe(200);
});

test('DELETE /me with a wrong or missing password is 403 invalid_credentials', async () => {
  const { auth } = await authed();
  const wrong = await request(app())
    .delete('/api/v1/me')
    .set('Authorization', auth)
    .send({ password: 'wrong password' });
  expect(wrong.status).toBe(403);
  expect(wrong.body.error.code).toBe('invalid_credentials');
  const missing = await request(app()).delete('/api/v1/me').set('Authorization', auth);
  expect(missing.status).toBe(403);
  expect(await t.db.select().from(appUser)).toHaveLength(1);
});

test('a Google-only account may delete within 5 minutes of sign-in, not after', async () => {
  const fresh = await authed({ passwordHash: null, googleSub: 'sub-1' });
  clock.advance(299_000);
  expect((await request(app()).delete('/api/v1/me').set('Authorization', fresh.auth)).status).toBe(
    204,
  );

  await t.db.delete(appUser);
  const stale = await authed({ passwordHash: null, googleSub: 'sub-2' });
  clock.advance(301_000);
  const res = await request(app()).delete('/api/v1/me').set('Authorization', stale.auth);
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('reauth_required');
});

test.each([['get'], ['patch'], ['delete']] as const)('%s /me needs a JWT', async (method) => {
  const res = await request(app())[method]('/api/v1/me');
  expect(res.status).toBe(401);
});
