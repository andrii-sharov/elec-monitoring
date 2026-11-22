import { resources } from '@elec/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { TEST_PASSWORD, createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { FakeClock, FakeEmailSender, linkFrom } from '../../../test/fakes.ts';
import { appUser, oneTimeToken } from '../../db/schema/index.ts';
import { createPgRateLimiter } from '../../rateLimit/limiter.ts';
import { issueOneTimeToken } from '../../auth/oneTimeTokens.ts';

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
  await t.db.delete(oneTimeToken);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  email = new FakeEmailSender();
});

function app(overrides: Parameters<typeof testApp>[0] = {}) {
  return testApp({ db: t.db, clock, email, ...overrides });
}

const signupBody = {
  email: ' John@Example.COM ',
  password: TEST_PASSWORD,
  name: 'John',
  language: 'en',
  timezone: 'Europe/Kyiv',
};

function tokenFrom(message: { text: string }): string {
  return new URL(linkFrom(message as never)).searchParams.get('token') ?? '';
}

test('sign up creates an unverified user and sends a verification email', async () => {
  const res = await request(app()).post('/api/auth/signup').send(signupBody);
  expect(res.status).toBe(201);
  expect(res.text).toBe('');

  const users = await t.db.select().from(appUser);
  expect(users).toHaveLength(1);
  expect(users[0]).toMatchObject({
    email: 'john@example.com',
    name: 'John',
    language: 'en',
    timezone: 'Europe/Kyiv',
    emailVerifiedAt: null,
  });
  expect(users[0]?.passwordHash).toMatch(/^\$argon2id\$/);

  await vi.waitFor(() => expect(email.sent).toHaveLength(1));
  expect(email.sent[0]?.to).toBe('john@example.com');
  expect(email.sent[0]?.subject).toBe(resources.en.translation.email.verifyEmail.subject);
  expect(linkFrom(email.sent[0]!)).toMatch(/^https:\/\/app\.test\/verify-email\?token=/);
});

test('an existing email gets the same response and an accountExists email', async () => {
  await createUser(t.db, { language: 'ru' });
  const res = await request(app()).post('/api/auth/signup').send(signupBody);
  expect(res.status).toBe(201);
  expect(res.text).toBe('');
  expect(await t.db.select().from(appUser)).toHaveLength(1);
  await vi.waitFor(() => expect(email.sent).toHaveLength(1));
  expect(email.sent[0]?.subject).toBe(resources.ru.translation.email.accountExists.subject);
  expect(linkFrom(email.sent[0]!)).toBe('https://app.test/login');
});

test.each([
  ['bad email', { email: 'nope' }, 'email'],
  ['short password', { password: 'short' }, 'password'],
  ['unknown language', { language: 'de' }, 'language'],
  ['bad timezone', { timezone: 'Mars/Base' }, 'timezone'],
])('rejects %s', async (_name, patch, path) => {
  const res = await request(app())
    .post('/api/auth/signup')
    .send({ ...signupBody, ...patch });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('validation_error');
  expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  expect(email.sent).toHaveLength(0);
});

async function signUpAndGetToken(): Promise<string> {
  await request(app()).post('/api/auth/signup').send(signupBody);
  await vi.waitFor(() => expect(email.sent).toHaveLength(1));
  return tokenFrom(email.sent[0]!);
}

test('verify-email marks the address verified, once', async () => {
  const token = await signUpAndGetToken();
  const res = await request(app()).post('/api/auth/verify-email').send({ token });
  expect(res.status).toBe(204);
  const [user] = await t.db.select().from(appUser);
  expect(user?.emailVerifiedAt).toEqual(clock.now());

  const again = await request(app()).post('/api/auth/verify-email').send({ token });
  expect(again.status).toBe(410);
  expect(again.body.error.code).toBe('expired');
});

test('verify-email link expires after 24 hours', async () => {
  const token = await signUpAndGetToken();
  clock.advance(86_400_000 - 1000);
  expect((await request(app()).post('/api/auth/verify-email').send({ token })).status).toBe(204);

  email.sent = [];
  await t.db.delete(appUser);
  const late = await signUpAndGetToken();
  clock.advance(86_400_000);
  expect((await request(app()).post('/api/auth/verify-email').send({ token: late })).status).toBe(
    410,
  );
});

test('verify-email answers 410 for garbage', async () => {
  const res = await request(app()).post('/api/auth/verify-email').send({ token: 'garbage' });
  expect(res.status).toBe(410);
});

test('a reset token cannot verify an email', async () => {
  const user = await createUser(t.db, { emailVerifiedAt: null });
  const token = await issueOneTimeToken(t.db, clock, user.id, 'RESET_PASSWORD');
  expect((await request(app()).post('/api/auth/verify-email').send({ token })).status).toBe(410);
});

test('resend-verification sends a new email and the old link still works', async () => {
  const oldToken = await signUpAndGetToken();
  const [user] = await t.db.select().from(appUser);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user!.id);
  const res = await request(app())
    .post('/api/auth/resend-verification')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(204);
  await vi.waitFor(() => expect(email.sent).toHaveLength(2));
  expect(tokenFrom(email.sent[1]!)).not.toBe(oldToken);
  expect(
    (await request(app()).post('/api/auth/verify-email').send({ token: oldToken })).status,
  ).toBe(204);
});

test('resend-verification for a verified user sends nothing', async () => {
  const user = await createUser(t.db);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  const res = await request(app())
    .post('/api/auth/resend-verification')
    .set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(204);
  expect(email.sent).toHaveLength(0);
});

test('resend-verification needs a JWT', async () => {
  expect((await request(app()).post('/api/auth/resend-verification')).status).toBe(401);
});

test('the 11th sign up from one IP in a minute is rate limited', async () => {
  const limited = app({ rateLimiter: createPgRateLimiter(t.db, clock) });
  for (let i = 0; i < 10; i++) {
    const res = await request(limited)
      .post('/api/auth/signup')
      .send({ ...signupBody, email: `user${i}@example.com` });
    expect(res.status).toBe(201);
  }
  const res = await request(limited)
    .post('/api/auth/signup')
    .send({ ...signupBody, email: 'user11@example.com' });
  expect(res.status).toBe(429);
  expect(res.headers['retry-after']).toMatch(/^\d+$/);
});

test('sign up with a mixed-case, padded email finds the same account on a second try', async () => {
  await request(app()).post('/api/auth/signup').send(signupBody);
  await request(app())
    .post('/api/auth/signup')
    .send({ ...signupBody, email: 'JOHN@example.com' });
  expect(
    await t.db.select().from(appUser).where(eq(appUser.email, 'john@example.com')),
  ).toHaveLength(1);
});
