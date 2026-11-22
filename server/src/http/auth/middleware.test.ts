import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { appUser, session } from '../../db/schema/index.ts';
import { getAuth, requireUser, requireVerifiedEmail } from './middleware.ts';

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
  const deps = { db: t.db, clock, config: testConfig };
  return testApp({
    ...deps,
    routes: (a) => {
      a.get('/test/me', requireUser(deps), (_req, res) => {
        res.json({ id: getAuth(res).user.id });
      });
      a.get('/test/verified', requireUser(deps), requireVerifiedEmail, (_req, res) => {
        res.status(204).end();
      });
    },
  });
}

test('accepts a valid access token', async () => {
  const user = await createUser(t.db);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app()).get('/test/me').set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(200);
  expect(res.body.id).toBe(user.id);
});

test.each([[undefined], ['Bearer garbage'], ['Basic x'], ['Bearer em_live_abc']])(
  'rejects Authorization %s',
  async (header) => {
    const req = request(app()).get('/test/me');
    const res = await (header ? req.set('Authorization', header) : req);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  },
);

test('rejects an expired token', async () => {
  const user = await createUser(t.db);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  clock.advance(900_000);
  const res = await request(app()).get('/test/me').set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(401);
});

test('rejects a revoked session at once', async () => {
  const user = await createUser(t.db);
  const { accessToken, sessionId } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  await t.db.update(session).set({ revokedAt: clock.now() }).where(eq(session.id, sessionId));
  const res = await request(app()).get('/test/me').set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(401);
});

test('rejects a deleted user', async () => {
  const user = await createUser(t.db);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  await t.db.delete(appUser).where(eq(appUser.id, user.id));
  const res = await request(app()).get('/test/me').set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(401);
});

test('requireVerifiedEmail blocks unverified users', async () => {
  const user = await createUser(t.db, { emailVerifiedAt: null });
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .get('/test/verified')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('email_not_verified');
});

test('requireVerifiedEmail lets verified users through', async () => {
  const user = await createUser(t.db);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .get('/test/verified')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(204);
});
