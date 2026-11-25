import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { TEST_PASSWORD, createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import {
  FakeClock,
  FakeEmailSender,
  FakeTelegramClient,
  silentLogger,
} from '../../../test/fakes.ts';
import { appUser, oneTimeToken, rateLimitBucket, session } from '../../db/schema/index.ts';
import { sha256 } from '../../lib/crypto.ts';
import { createPgRateLimiter } from '../../rateLimit/limiter.ts';

const PHONE = '+380501234567';
const URL_SHAPE = /^https:\/\/t\.me\/TestBot\?start=p_[\w-]{43}$/;
const { webhookSecret } = testConfig.telegram;

let t: TestDb;
let clock: FakeClock;
let email: FakeEmailSender;
let telegram: FakeTelegramClient;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  await t.db.delete(rateLimitBucket);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  email = new FakeEmailSender();
  telegram = new FakeTelegramClient(clock);
});

function app(overrides: Parameters<typeof testApp>[0] = {}) {
  return testApp({ db: t.db, clock, email, telegram, ...overrides });
}

const profile = { name: 'John', language: 'en', timezone: 'Europe/Kyiv' };

const signup = (body: object, password = TEST_PASSWORD) =>
  request(app())
    .post('/api/auth/signup')
    .send({ ...profile, password, ...body });

const login = (body: object, password = TEST_PASSWORD) =>
  request(app())
    .post('/api/auth/login')
    .send({ password, ...body });

const forgot = (phone = PHONE) => request(app()).post('/api/auth/forgot-password').send({ phone });

const reset = (token: string, password = 'brand new pass 2') =>
  request(app()).post('/api/auth/reset-password').send({ token, password });

const phoneUser = (overrides: Parameters<typeof createUser>[1] = {}) =>
  createUser(t.db, { phone: PHONE, language: 'en', ...overrides });

async function authed(overrides: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(t.db, { language: 'en', ...overrides });
  const signedIn = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  return { user, ...signedIn, auth: `Bearer ${signedIn.accessToken}` };
}

async function userRow(id: string) {
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, id));
  return row!;
}

const codeFrom = (url: string) => new URL(url).searchParams.get('start')!.slice(2);

async function codeRow(url: string) {
  const [row] = await t.db
    .select()
    .from(oneTimeToken)
    .where(eq(oneTimeToken.tokenHash, sha256(codeFrom(url))));
  return row;
}

async function resetTokenFromPush(): Promise<string> {
  await vi.waitFor(() => expect(telegram.sent.length).toBeGreaterThan(0));
  const match = /reset-password\?token=([\w-]+)/.exec(telegram.sent.at(-1)!.text);
  return match![1]!;
}

async function tellBot(tg: number, message: object) {
  const res = await request(app())
    .post(`/telegram/webhook/${webhookSecret}`)
    .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret)
    .send({ message: { chat: { id: tg, type: 'private' }, from: { id: tg }, ...message } });
  return res.body as { text?: string };
}

describe('sign up with a phone', () => {
  test('creates an unverified account and returns a verification link', async () => {
    const res = await signup({ phone: '050 123 45 67' });
    expect(res.status).toBe(201);
    expect(res.body.telegram_url).toMatch(URL_SHAPE);
    const [user] = await t.db.select().from(appUser);
    expect(user).toMatchObject({ phone: PHONE, email: null, phoneVerifiedAt: null });
    expect(await codeRow(res.body.telegram_url)).toMatchObject({
      purpose: 'PHONE_VERIFY',
      phone: PHONE,
      userId: user!.id,
    });
    expect(email.sent).toHaveLength(0);
  });

  test('answers an existing number with a recovery link and warns its owner', async () => {
    const user = await phoneUser({ telegramUserId: 777n });
    const res = await signup({ phone: PHONE });
    expect(res.status).toBe(201);
    expect(res.body.telegram_url).toMatch(URL_SHAPE);
    expect(await t.db.select().from(appUser)).toHaveLength(1);
    expect(await codeRow(res.body.telegram_url)).toMatchObject({
      purpose: 'PHONE_RECOVER',
      userId: user.id,
    });
    await vi.waitFor(() => expect(telegram.sent).toHaveLength(1));
    expect(telegram.sent[0]!.chatId).toBe(777n);
    expect(telegram.sent[0]!.text).toContain('https://app.test/login');
  });

  test('pushes nothing when the account has no Telegram binding', async () => {
    await phoneUser();
    expect((await signup({ phone: PHONE })).status).toBe(201);
    expect(telegram.sent).toHaveLength(0);
  });

  test('refuses a body with both an email and a phone', async () => {
    const res = await signup({ phone: PHONE, email: 'john@example.com' });
    expect(res.status).toBe(400);
    expect(await t.db.select().from(appUser)).toHaveLength(0);
  });

  test('reports an invalid phone on its field', async () => {
    const res = await signup({ phone: '12' });
    expect(res.body.error.details).toEqual([{ path: 'phone', code: 'invalid_phone' }]);
  });
});

describe('log in with a phone', () => {
  test('works with any format of the number', async () => {
    await phoneUser();
    for (const phone of [PHONE, '0501234567']) {
      const res = await login({ phone });
      expect(res.status).toBe(200);
      expect(res.body.user.phone).toBe(PHONE);
    }
  });

  test('answers a wrong password with invalid_credentials', async () => {
    await phoneUser();
    const res = await login({ phone: PHONE }, 'wrong password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });
});

describe('forgot and reset with a phone', () => {
  test('pushes a reset link to the bound Telegram user', async () => {
    const user = await phoneUser({ telegramUserId: 777n, phoneVerified: false });
    const { sessionId } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
    const res = await forgot();
    expect(res.status).toBe(200);
    expect(res.body.telegram_url).toMatch(URL_SHAPE);

    const token = await resetTokenFromPush();
    expect(telegram.sent[0]!.chatId).toBe(777n);
    expect((await reset(token)).status).toBe(204);
    expect((await userRow(user.id)).phoneVerifiedAt).toEqual(clock.now());
    expect((await userRow(user.id)).emailVerifiedAt).toBeNull();
    const live = await t.db
      .select()
      .from(session)
      .where(and(eq(session.id, sessionId), isNull(session.revokedAt)));
    expect(live).toHaveLength(0);
  });

  test('answers an unknown number with the same shape and no push', async () => {
    const res = await forgot();
    expect(res.status).toBe(200);
    expect(res.body.telegram_url).toMatch(URL_SHAPE);
    expect(await codeRow(res.body.telegram_url)).toBeUndefined();
    expect(telegram.sent).toHaveLength(0);
  });

  test('still answers when the user blocked the bot', async () => {
    await phoneUser({ telegramUserId: 777n });
    telegram.script({ type: 'PERMANENT', error: 'HTTP 403: blocked' });
    const logger = silentLogger();
    const res = await request(app({ logger }))
      .post('/api/auth/forgot-password')
      .send({ phone: PHONE });
    expect(res.status).toBe(200);
    expect(res.body.telegram_url).toMatch(URL_SHAPE);
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
  });

  test('a reset token without a phone does not verify the phone', async () => {
    const user = await phoneUser({ phoneVerified: false });
    const token = 'plain-reset-token';
    await t.db.insert(oneTimeToken).values({
      tokenHash: sha256(token),
      userId: user.id,
      purpose: 'RESET_PASSWORD',
      expiresAt: new Date('2026-11-21T17:00:00Z'),
    });
    expect((await reset(token)).status).toBe(204);
    expect(await userRow(user.id)).toMatchObject({
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
    });
  });
});

test('the real owner of a pre-registered number takes the account back', async () => {
  const squatter = await signup({ phone: PHONE }, 'pw-x-password');
  expect(squatter.status).toBe(201);
  const squatted = await login({ phone: PHONE }, 'pw-x-password');
  const cookie = (squatted.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

  const again = await signup({ phone: PHONE }, 'pw-y-password');
  expect((await codeRow(again.body.telegram_url))!.purpose).toBe('PHONE_RECOVER');
  await tellBot(777, { text: `/start p_${codeFrom(again.body.telegram_url)}` });
  const reply = await tellBot(777, {
    contact: { phone_number: '380501234567', user_id: 777 },
  });
  const token = /reset-password\?token=([\w-]+)/.exec(reply.text!)![1]!;
  expect((await reset(token, 'pw-y-password')).status).toBe(204);

  expect((await login({ phone: PHONE }, 'pw-x-password')).status).toBe(401);
  const refresh = await request(app())
    .post('/api/auth/refresh')
    .set('Origin', 'https://app.test')
    .set('Cookie', cookie);
  expect(refresh.status).toBe(401);
  expect((await login({ phone: PHONE }, 'pw-y-password')).status).toBe(200);
  const [user] = await t.db.select().from(appUser);
  expect(user!.phoneVerifiedAt).toEqual(clock.now());
});

describe('POST /api/auth/phone', () => {
  const addPhone = (auth: string, phone = PHONE) =>
    request(app()).post('/api/auth/phone').set('Authorization', auth).send({ phone });

  test('returns a verification link and leaves the account unchanged', async () => {
    const { user, auth } = await authed();
    const res = await addPhone(auth, '050 123 45 67');
    expect(res.status).toBe(200);
    expect(res.body.telegram_url).toMatch(URL_SHAPE);
    expect(await codeRow(res.body.telegram_url)).toMatchObject({
      purpose: 'PHONE_VERIFY',
      phone: PHONE,
      userId: user.id,
    });
    expect((await userRow(user.id)).phone).toBeNull();
  });

  test('resends the link for an unverified phone account', async () => {
    const { auth } = await authed({ phone: PHONE, phoneVerified: false });
    expect((await addPhone(auth)).status).toBe(200);
  });

  test("refuses another account's number", async () => {
    await phoneUser();
    const { auth } = await authed({ email: 'mary@example.com' });
    const res = await addPhone(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'phone', code: 'already_in_use' }]);
  });

  test.each([
    ['an already verified number', PHONE, true],
    ['a second number', '+380509999999', true],
    ['a replacement for an unverified number', '+380509999999', false],
  ])('refuses %s', async (_label, phone, phoneVerified) => {
    const { auth } = await authed({ phone: PHONE, phoneVerified });
    const res = await addPhone(auth, phone);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toBeUndefined();
  });

  test('refuses a new number on an unverified account', async () => {
    const { auth } = await authed({ emailVerifiedAt: null });
    const res = await addPhone(auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_verified');
  });

  test('needs a signed-in user', async () => {
    expect((await request(app()).post('/api/auth/phone').send({ phone: PHONE })).status).toBe(401);
  });
});

describe('POST /api/auth/email', () => {
  const addEmail = (auth: string, address = 'john@example.com') =>
    request(app()).post('/api/auth/email').set('Authorization', auth).send({ email: address });

  test('sets an unverified email and sends the verification mail', async () => {
    const { user, auth } = await authed({ phone: PHONE });
    expect((await addEmail(auth, ' John@Example.com ')).status).toBe(204);
    expect(await userRow(user.id)).toMatchObject({
      email: 'john@example.com',
      emailVerifiedAt: null,
    });
    await vi.waitFor(() => expect(email.sent).toHaveLength(1));
    expect(email.sent[0]!.text).toContain('https://app.test/verify-email?token=');
  });

  test('keeps a taken email private and warns its owner', async () => {
    await createUser(t.db);
    const { user, auth } = await authed({ phone: PHONE });
    expect((await addEmail(auth)).status).toBe(204);
    expect((await userRow(user.id)).email).toBeNull();
    await vi.waitFor(() => expect(email.sent).toHaveLength(1));
    expect(email.sent[0]!.to).toBe('john@example.com');
    expect(email.sent[0]!.text).toContain('https://app.test/login');
  });

  test('refuses an unverified phone account', async () => {
    const { user, auth } = await authed({ phone: PHONE, phoneVerified: false });
    const res = await addEmail(auth);
    expect(res.status).toBe(403);
    expect((await userRow(user.id)).email).toBeNull();
  });

  test('refuses an account that has an email', async () => {
    const { auth } = await authed();
    expect((await addEmail(auth, 'new@example.com')).status).toBe(409);
  });
});

test('phone sends are limited to 3 an hour for any format of the number', async () => {
  const limited = app({ rateLimiter: createPgRateLimiter(t.db, clock) });
  const send = (path: string, phone: string) =>
    request(limited)
      .post(path)
      .send({ ...profile, password: TEST_PASSWORD, phone });
  for (const phone of [PHONE, '050 123 45 67', '380501234567']) {
    expect((await send('/api/auth/signup', phone)).status).toBe(201);
  }
  expect((await send('/api/auth/signup', '0501234567')).status).toBe(429);

  const strict = (phone: string) =>
    request(limited).post('/api/auth/forgot-password').send({ phone });
  for (const phone of [PHONE, '050 123 45 67', '380501234567']) {
    expect((await strict(phone)).status).toBe(200);
  }
  expect((await strict('0501234567')).status).toBe(429);
});
