import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { FakeClock, FakeGoogleClient } from '../../../test/fakes.ts';
import { appUser, deviceViewer, session } from '../../db/schema/index.ts';
import { createDevice } from '../../../test/devices.ts';
import { seedInvite } from '../../../test/sharing.ts';

let t: TestDb;
let clock: FakeClock;
let google: FakeGoogleClient;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  google = new FakeGoogleClient();
});

function app() {
  return testApp({ db: t.db, clock, google });
}

function setCookies(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

function cookieLine(res: request.Response, name: string): string | undefined {
  return setCookies(res).find((line) => line.startsWith(`${name}=`));
}

async function startFlow(query: string, cookie?: string) {
  const req = request(app()).get(`/api/auth/google?${query}`);
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  const oauth = cookieLine(res, 'em_oauth');
  const location = res.headers.location ?? '';
  const state = location.startsWith('https://accounts.google.test')
    ? (new URL(location).searchParams.get('state') ?? '')
    : '';
  return { res, oauthCookie: oauth?.split(';')[0] ?? '', state };
}

function callback(query: string, cookie?: string) {
  const req = request(app()).get(`/api/auth/google/callback?${query}`);
  return cookie ? req.set('Cookie', cookie) : req;
}

async function runLogin(app_ = 'CLIENT') {
  const { oauthCookie, state } = await startFlow(`app=${app_}&intent=LOGIN`);
  return callback(`code=abc&state=${state}`, oauthCookie);
}

test('start redirects to Google and sets a hardened state cookie', async () => {
  const { res } = await startFlow('app=ADMIN&intent=LOGIN');
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.test\/auth\?state=/);
  const cookie = cookieLine(res, 'em_oauth')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Path=/api/auth/google');
  expect(cookie).toContain('Max-Age=600');
});

test('start rejects a bad query', async () => {
  expect((await startFlow('app=https://evil.test&intent=LOGIN')).res.status).toBe(400);
  expect((await startFlow('app=CLIENT&intent=NOPE')).res.status).toBe(400);
  expect((await startFlow('intent=LOGIN')).res.status).toBe(400);
});

test('LOGIN with a new identity creates a verified Google account and signs in', async () => {
  const res = await runLogin('ADMIN');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://admin.test/auth/google');

  const [user] = await t.db.select().from(appUser);
  expect(user).toMatchObject({
    email: 'john@example.com',
    googleSub: 'google-sub-1',
    passwordHash: null,
    name: 'John Google',
    language: 'uk',
    timezone: 'Europe/Kyiv',
  });
  expect(user?.emailVerifiedAt).toEqual(clock.now());

  const refreshCookie = cookieLine(res, 'em_refresh')!.split(';')[0]!;
  const refresh = await request(app())
    .post('/api/auth/refresh')
    .set('Origin', 'https://admin.test')
    .set('Cookie', refreshCookie);
  expect(refresh.status).toBe(200);
  expect(refresh.body.user.google_linked).toBe(true);
});

test('a new identity without a name falls back to the email local part', async () => {
  google.identity = { ...google.identity, name: null };
  await runLogin();
  const [user] = await t.db.select().from(appUser);
  expect(user?.name).toBe('john');
});

test('LOGIN with a known Google account signs into it', async () => {
  const user = await createUser(t.db, { passwordHash: null, googleSub: 'google-sub-1' });
  const res = await runLogin();
  expect(res.headers.location).toBe('https://app.test/auth/google');
  expect(await t.db.select().from(appUser)).toHaveLength(1);
  const [row] = await t.db.select().from(session);
  expect(row?.userId).toBe(user.id);
});

test('LOGIN links Google to a verified password account and keeps the password', async () => {
  await createUser(t.db);
  const res = await runLogin();
  expect(res.headers.location).toBe('https://app.test/auth/google');
  const [user] = await t.db.select().from(appUser);
  expect(user?.googleSub).toBe('google-sub-1');
  expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
});

test('LOGIN takes over an unverified account: verified, no password, old sessions revoked', async () => {
  const unverified = await createUser(t.db, { emailVerifiedAt: null });
  const old = await signIn({ db: t.db, clock, config: testConfig }, unverified.id);
  await runLogin();
  const [user] = await t.db.select().from(appUser);
  expect(user).toMatchObject({ googleSub: 'google-sub-1', passwordHash: null });
  expect(user?.emailVerifiedAt).toEqual(clock.now());
  const refresh = await request(app())
    .post('/api/auth/refresh')
    .set('Origin', 'https://app.test')
    .set('Cookie', `em_refresh=${old.refreshToken}`);
  expect(refresh.status).toBe(401);
});

test('LOGIN with an unverified Google email changes nothing', async () => {
  google.identity = { ...google.identity, emailVerified: false };
  const res = await runLogin();
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_email_unverified');
  expect(await t.db.select().from(appUser)).toHaveLength(0);
});

test('LINK attaches Google to the signed-in user without a new session', async () => {
  const user = await createUser(t.db);
  const { refreshToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const { oauthCookie, state } = await startFlow(
    'app=CLIENT&intent=LINK',
    `em_refresh=${refreshToken}`,
  );
  const res = await callback(`code=abc&state=${state}`, oauthCookie);
  expect(res.headers.location).toBe('https://app.test/auth/google');
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row?.googleSub).toBe('google-sub-1');
  expect(await t.db.select().from(session)).toHaveLength(1);
});

test('LINK without a refresh cookie redirects with google_failed', async () => {
  const { res } = await startFlow('app=CLIENT&intent=LINK');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_failed');
});

test('LINK refuses a Google account that belongs to someone else', async () => {
  await createUser(t.db, {
    email: 'other@example.com',
    passwordHash: null,
    googleSub: 'google-sub-1',
  });
  const user = await createUser(t.db);
  const { refreshToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const { oauthCookie, state } = await startFlow(
    'app=CLIENT&intent=LINK',
    `em_refresh=${refreshToken}`,
  );
  const res = await callback(`code=abc&state=${state}`, oauthCookie);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_account_in_use');
});

test('LINK refuses when the user already has another Google account', async () => {
  const user = await createUser(t.db, { googleSub: 'google-sub-other' });
  const { refreshToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const { oauthCookie, state } = await startFlow(
    'app=CLIENT&intent=LINK',
    `em_refresh=${refreshToken}`,
  );
  const res = await callback(`code=abc&state=${state}`, oauthCookie);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_already_linked');
});

test('a callback that cannot be trusted redirects to the client with google_failed', async () => {
  const { oauthCookie, state } = await startFlow('app=CLIENT&intent=LOGIN');
  const failed = 'https://app.test/auth/google?error=google_failed';

  const noCookie = await callback(`code=abc&state=${state}`);
  expect(noCookie.status).toBe(302);
  expect(noCookie.headers.location).toBe(failed);

  const wrongState = await callback('code=abc&state=other', oauthCookie);
  expect(wrongState.headers.location).toBe(failed);

  const denied = await callback(`error=access_denied&state=${state}`, oauthCookie);
  expect(denied.status).toBe(302);
  expect(denied.headers.location).toBe(failed);

  google.failExchange = true;
  const exchange = await callback(`code=abc&state=${state}`, oauthCookie);
  expect(exchange.status).toBe(302);
  expect(exchange.headers.location).toBe(failed);

  expect(await t.db.select().from(appUser)).toHaveLength(0);
});

test('an expired state cookie redirects with google_failed', async () => {
  const { oauthCookie, state } = await startFlow('app=ADMIN&intent=LOGIN');
  clock.advance(601_000);
  const res = await callback(`code=abc&state=${state}`, oauthCookie);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_failed');
});

test('the state cookie is cleared after the callback', async () => {
  const res = await runLogin();
  expect(cookieLine(res, 'em_oauth')).toMatch(/^em_oauth=;/);
});

test('unlink removes Google when a password exists', async () => {
  const user = await createUser(t.db, { googleSub: 'google-sub-1' });
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .delete('/api/auth/google')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(204);
  const [row] = await t.db.select().from(appUser);
  expect(row?.googleSub).toBeNull();
});

test('unlink of the only sign-in method is 409', async () => {
  const user = await createUser(t.db, { passwordHash: null, googleSub: 'google-sub-1' });
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .delete('/api/auth/google')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('conflict');
});

test('unlink needs a JWT', async () => {
  expect((await request(app()).delete('/api/auth/google')).status).toBe(401);
});

async function pendingInviteForJohn() {
  const owner = await createUser(t.db, { email: 'owner@example.com', name: 'Owner' });
  const home = await createDevice(t.db, owner.id, { name: 'Home' });
  await seedInvite(t.db, { deviceId: home.id, invitedBy: owner.id, email: 'john@example.com' });
  return home.id;
}

const viewerRows = () => t.db.select().from(deviceViewer);

test('a new Google account accepts its pending invites', async () => {
  const deviceId = await pendingInviteForJohn();
  await runLogin();
  const [john] = await t.db.select().from(appUser).where(eq(appUser.email, 'john@example.com'));
  expect(await viewerRows()).toEqual([expect.objectContaining({ deviceId, userId: john!.id })]);
});

test('Google verifying an unverified account accepts its pending invites', async () => {
  const john = await createUser(t.db, { emailVerifiedAt: null });
  const deviceId = await pendingInviteForJohn();
  await runLogin();
  expect(await viewerRows()).toEqual([expect.objectContaining({ deviceId, userId: john.id })]);
});

test('Google sign-in to a verified account leaves pending invites alone', async () => {
  await createUser(t.db);
  await pendingInviteForJohn();
  await runLogin();
  expect(await viewerRows()).toEqual([]);
});

async function linkAs(userId: string) {
  const { refreshToken } = await signIn({ db: t.db, clock, config: testConfig }, userId);
  const cookie = `em_refresh=${refreshToken}`;
  const { oauthCookie, state } = await startFlow('app=CLIENT&intent=LINK', cookie);
  return callback(`code=abc&state=${state}`, oauthCookie);
}

test('linking Google to a phone account adds the verified email', async () => {
  const user = await createUser(t.db, { phone: '+380501234567' });
  const deviceId = await pendingInviteForJohn();
  const res = await linkAs(user.id);
  expect(res.headers.location).toBe('https://app.test/auth/google');
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row).toMatchObject({
    email: 'john@example.com',
    emailVerifiedAt: clock.now(),
    googleSub: 'google-sub-1',
  });
  expect(await viewerRows()).toEqual([expect.objectContaining({ deviceId, userId: user.id })]);
});

test('linking a Google email that another account holds fails', async () => {
  await createUser(t.db);
  const user = await createUser(t.db, { phone: '+380501234567' });
  const res = await linkAs(user.id);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_account_in_use');
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row).toMatchObject({ email: null, googleSub: null });
});

test('an unverified phone account cannot link Google', async () => {
  const user = await createUser(t.db, { phone: '+380501234567', phoneVerified: false });
  const res = await linkAs(user.id);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_failed');
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row).toMatchObject({ email: null, googleSub: null });
});

test('an unverified email account cannot link Google', async () => {
  const user = await createUser(t.db, { email: 'mary@example.com', emailVerifiedAt: null });
  const res = await linkAs(user.id);
  expect(res.headers.location).toBe('https://app.test/auth/google?error=google_failed');
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, user.id));
  expect(row?.googleSub).toBeNull();
});
