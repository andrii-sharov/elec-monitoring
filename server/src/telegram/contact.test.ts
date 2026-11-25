import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../test/app.ts';
import { createUser } from '../../test/auth.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { createDevice } from '../../test/devices.ts';
import { FakeClock } from '../../test/fakes.ts';
import { addViewer, seedInvite } from '../../test/sharing.ts';
import { issueOneTimeToken } from '../auth/oneTimeTokens.ts';
import {
  appUser,
  deviceChannel,
  deviceViewer,
  notificationChannel,
  oneTimeToken,
} from '../db/schema/index.ts';
import { sha256 } from '../lib/crypto.ts';

const TG = 777;
const PHONE = '+380501234567';
const { webhookSecret } = testConfig.telegram;

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

type Reply = { method?: string; chat_id?: string; text?: string; reply_markup?: unknown };

async function send(message: object): Promise<Reply> {
  const res = await request(testApp({ db: t.db, clock }))
    .post(`/telegram/webhook/${webhookSecret}`)
    .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret)
    .send({
      message: {
        chat: { id: TG, type: 'private', first_name: 'John' },
        from: { id: TG, language_code: 'en' },
        ...message,
      },
    });
  expect(res.status).toBe(200);
  return res.body as Reply;
}

const start = (token: string) => send({ text: `/start p_${token}` });

const share = (phone = '380501234567', userId: number | undefined = TG) =>
  send({ contact: { phone_number: phone, ...(userId === undefined ? {} : { user_id: userId }) } });

const phoneUser = (overrides: Parameters<typeof createUser>[1] = {}) =>
  createUser(t.db, { language: 'en', phone: PHONE, phoneVerified: false, ...overrides });

const verifyCode = (userId: string, phone = PHONE) =>
  issueOneTimeToken(t.db, clock, userId, 'PHONE_VERIFY', { phone });

async function userRow(id: string) {
  const [row] = await t.db.select().from(appUser).where(eq(appUser.id, id));
  return row!;
}

async function tokenRow(token: string) {
  const [row] = await t.db
    .select()
    .from(oneTimeToken)
    .where(eq(oneTimeToken.tokenHash, sha256(token)));
  return row!;
}

const ASK = {
  method: 'sendMessage',
  chat_id: String(TG),
  text: 'To confirm your number, tap “Share my phone number” below.',
  reply_markup: {
    keyboard: [[{ text: 'Share my phone number', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
};

const REMOVE = { remove_keyboard: true };

async function expectNothingChanged(userId: string) {
  expect(await userRow(userId)).toMatchObject({ phoneVerifiedAt: null, telegramUserId: null });
  expect(await t.db.select().from(notificationChannel)).toHaveLength(0);
}

describe('/start p_<code>', () => {
  test('claims a valid code and asks for the contact', async () => {
    const user = await phoneUser();
    const token = await verifyCode(user.id);
    expect(await start(token)).toEqual(ASK);
    expect((await tokenRow(token)).telegramUserId).toBe(BigInt(TG));
  });

  test('answers unknown and expired codes the same way', async () => {
    const user = await phoneUser();
    const token = await verifyCode(user.id);
    clock.advance(24 * 3600_000);
    expect(await start(token)).toEqual(ASK);
    expect(await start('unknown')).toEqual(ASK);
    expect((await tokenRow(token)).telegramUserId).toBeNull();
  });

  test('refuses a group chat without claiming the code', async () => {
    const user = await phoneUser();
    const token = await verifyCode(user.id);
    const reply = await send({
      chat: { id: -100, type: 'group', title: 'Family' },
      text: `/start p_${token}`,
    });
    expect(reply.text).toBe('Open this link in a private chat with the bot.');
    expect((await tokenRow(token)).telegramUserId).toBeNull();
  });
});

describe('contact', () => {
  test('confirms the number, binds Telegram and connects the chat', async () => {
    const user = await phoneUser();
    const own = await createDevice(t.db, user.id);
    const owner = await createUser(t.db, { email: 'owner@example.com' });
    const shared = await createDevice(t.db, owner.id, { name: 'Cottage' });
    await addViewer(t.db, shared.id, user.id);
    const token = await verifyCode(user.id);
    await start(token);

    const reply = await share();

    expect(reply.text).toBe(
      'Your number is confirmed. Alerts for your devices will come to this chat.',
    );
    expect(reply.reply_markup).toEqual(REMOVE);
    expect(await userRow(user.id)).toMatchObject({
      phone: PHONE,
      phoneVerifiedAt: clock.now(),
      telegramUserId: BigInt(TG),
    });
    const [channel] = await t.db.select().from(notificationChannel);
    expect(channel).toMatchObject({
      userId: user.id,
      type: 'TELEGRAM_PLATFORM',
      telegramChatId: BigInt(TG),
    });
    const links = await t.db.select().from(deviceChannel);
    expect(links.map((l) => l.deviceId).toSorted()).toEqual([own.id, shared.id].toSorted());
    expect((await tokenRow(token)).usedAt).not.toBeNull();

    expect((await share()).text).toMatch(/doesn't match/);
  });

  test('adds a phone to an email account', async () => {
    const user = await createUser(t.db, { language: 'en' });
    await start(await verifyCode(user.id));
    await share();
    expect(await userRow(user.id)).toMatchObject({
      email: 'john@example.com',
      phone: PHONE,
      phoneVerifiedAt: clock.now(),
    });
  });

  test.each([[999], [undefined]])('rejects a forwarded contact (user_id %s)', async (userId) => {
    const user = await phoneUser();
    const token = await verifyCode(user.id);
    await start(token);
    const reply = await send({
      contact: { phone_number: '380501234567', ...(userId ? { user_id: userId } : {}) },
    });
    expect(reply.text).toMatch(/doesn't match/);
    expect(reply.reply_markup).toEqual(REMOVE);
    await expectNothingChanged(user.id);
    expect((await tokenRow(token)).usedAt).toBeNull();
  });

  test('rejects another number', async () => {
    const user = await phoneUser();
    await start(await verifyCode(user.id));
    expect((await share('380509999999')).text).toMatch(/doesn't match/);
    await expectNothingChanged(user.id);
  });

  test('rejects a contact without a claimed code', async () => {
    const user = await phoneUser();
    await verifyCode(user.id);
    expect((await share()).text).toMatch(/doesn't match/);
    await expectNothingChanged(user.id);
  });

  test('ignores a contact sent to a group', async () => {
    const user = await phoneUser();
    await start(await verifyCode(user.id));
    const reply = await send({
      chat: { id: -100, type: 'group', title: 'Family' },
      contact: { phone_number: '380501234567', user_id: TG },
    });
    expect(reply).toEqual({});
    await expectNothingChanged(user.id);
  });

  test('refuses a number that another account holds', async () => {
    await phoneUser();
    const other = await createUser(t.db, { email: 'mary@example.com', language: 'en' });
    await start(await verifyCode(other.id));
    expect((await share()).text).toBe('This number is already used by another account.');
    expect(await userRow(other.id)).toMatchObject({ phone: null, telegramUserId: null });
    expect(await t.db.select().from(notificationChannel)).toHaveLength(0);
  });

  test('does not replace a phone the account already has', async () => {
    const user = await phoneUser({ phoneVerified: true });
    await start(await verifyCode(user.id, '+380509999999'));
    expect((await share('380509999999')).text).toMatch(/doesn't match/);
    expect((await userRow(user.id)).phone).toBe(PHONE);
  });

  test('moves the Telegram binding to the account that confirms', async () => {
    const first = await createUser(t.db, { phone: '+380501111111', telegramUserId: BigInt(TG) });
    const second = await phoneUser();
    await start(await verifyCode(second.id));
    await share();
    expect((await userRow(second.id)).telegramUserId).toBe(BigInt(TG));
    expect(await userRow(first.id)).toMatchObject({
      telegramUserId: null,
      phoneVerifiedAt: first.phoneVerifiedAt,
    });
  });

  test('accepts pending phone invites', async () => {
    const owner = await createUser(t.db, { email: 'owner@example.com' });
    const shared = await createDevice(t.db, owner.id);
    await seedInvite(t.db, { deviceId: shared.id, invitedBy: owner.id, phone: PHONE });
    const user = await phoneUser();
    await start(await verifyCode(user.id));
    await share();
    const viewers = await t.db.select().from(deviceViewer);
    expect(viewers).toMatchObject([{ deviceId: shared.id, userId: user.id }]);
    expect(await t.db.select().from(deviceChannel)).toHaveLength(1);
  });

  test('sends a reset link for a recovery code without verifying the phone', async () => {
    const user = await phoneUser();
    await start(await issueOneTimeToken(t.db, clock, user.id, 'PHONE_RECOVER', { phone: PHONE }));
    const reply = await share();
    expect(reply.text).toContain('https://app.test/reset-password?token=');
    expect(reply.reply_markup).toEqual(REMOVE);
    expect(await userRow(user.id)).toMatchObject({
      telegramUserId: BigInt(TG),
      phoneVerifiedAt: null,
    });
    const resets = await t.db
      .select()
      .from(oneTimeToken)
      .where(eq(oneTimeToken.purpose, 'RESET_PASSWORD'));
    expect(resets).toMatchObject([{ userId: user.id, phone: PHONE, usedAt: null }]);
  });
});
