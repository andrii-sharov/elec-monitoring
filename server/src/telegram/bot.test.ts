import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../test/channels.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { createDevice } from '../../test/devices.ts';
import { FakeClock } from '../../test/fakes.ts';
import { issueOneTimeToken } from '../auth/oneTimeTokens.ts';
import {
  appUser,
  device,
  deviceChannel,
  notificationChannel,
  oneTimeToken,
} from '../db/schema/index.ts';
import { createI18n } from '../i18n.ts';
import { handleUpdate, type BotDeps } from './bot.ts';
import type { TelegramUpdate } from './commands.ts';

let t: TestDb;
let clock: FakeClock;
let deps: BotDeps;
const CHAT = 555;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  deps = { db: t.db, clock, i18n: createI18n(), botUsername: 'TestBot' };
});

function message(
  text: string,
  chat: Partial<NonNullable<TelegramUpdate['message']>['chat']> = {},
  languageCode?: string,
): TelegramUpdate {
  return {
    message: {
      chat: { id: CHAT, type: 'private', ...chat },
      text,
      ...(languageCode ? { from: { language_code: languageCode } } : {}),
    },
  };
}

async function userWithDevices() {
  const user = await createUser(t.db, { language: 'en' });
  const home = await createDevice(t.db, user.id, { name: 'Home' });
  const dacha = await createDevice(t.db, user.id, { name: 'Dacha' });
  return { user, home, dacha };
}

const channels = () => t.db.select().from(notificationChannel);

describe('/start <code>', () => {
  test('links a private chat to the user and all their devices', async () => {
    const { user, home, dacha } = await userWithDevices();
    const code = await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK');

    const reply = await handleUpdate(
      deps,
      message(`/start ${code}`, { first_name: 'John', last_name: 'Smith' }),
    );

    expect(reply?.chatId).toBe(BigInt(CHAT));
    expect(reply?.text).toContain('linked');
    const [channel] = await channels();
    expect(channel).toMatchObject({
      userId: user.id,
      type: 'TELEGRAM_PLATFORM',
      name: 'John Smith',
      telegramChatId: BigInt(CHAT),
    });
    const links = await t.db.select().from(deviceChannel);
    expect(links.map((l) => l.deviceId).toSorted()).toEqual([home.id, dacha.id].toSorted());
    const [token] = await t.db.select().from(oneTimeToken);
    expect(token!.usedAt).not.toBeNull();
  });

  test('a used code and an expired code both say the link expired', async () => {
    const { user } = await userWithDevices();
    const code = await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK');
    await handleUpdate(deps, message(`/start ${code}`));
    const again = await handleUpdate(deps, message(`/start ${code}`, { id: 777 }, 'en'));
    expect(again?.text).toMatch(/expired|invalid/i);

    const late = await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK');
    clock.advance(15 * 60_000);
    const expired = await handleUpdate(deps, message(`/start ${late}`, { id: 778 }, 'en'));
    expect(expired?.text).toMatch(/expired|invalid/i);
    expect(await channels()).toHaveLength(1);
  });

  test('linking the same chat again changes nothing', async () => {
    const { user } = await userWithDevices();
    await handleUpdate(
      deps,
      message(`/start ${await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK')}`),
    );
    const reply = await handleUpdate(
      deps,
      message(`/start ${await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK')}`),
    );
    expect(reply?.text).toMatch(/already/i);
    expect(await channels()).toHaveLength(1);
  });

  test('links a group by its title, with the bot name in the command', async () => {
    const { user } = await userWithDevices();
    const code = await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK');
    await handleUpdate(
      deps,
      message(`/start@TestBot ${code}`, { id: -100123, type: 'supergroup', title: 'Dacha chat' }),
    );
    const [channel] = await channels();
    expect(channel).toMatchObject({ name: 'Dacha chat', telegramChatId: -100123n });
  });

  test('falls back to the username, then to a generic name', async () => {
    const { user } = await userWithDevices();
    await handleUpdate(
      deps,
      message(`/start ${await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK')}`, {
        username: 'john',
      }),
    );
    await handleUpdate(
      deps,
      message(`/start ${await issueOneTimeToken(t.db, clock, user.id, 'TELEGRAM_LINK')}`, {
        id: 9,
      }),
    );
    expect((await channels()).map((c) => c.name).toSorted()).toEqual(['@john', 'Telegram']);
  });
});

describe('/start without a code and unknown chats', () => {
  test.each([
    ['ru', 'Привет'],
    ['de', 'Вітаємо'],
  ])('welcome for language_code %s', async (code, fragment) => {
    const reply = await handleUpdate(deps, message('/start', {}, code));
    expect(reply?.text).toContain(fragment);
  });
});

describe('/status', () => {
  test('lists only devices that notify this chat, by name', async () => {
    const { user, home, dacha } = await userWithDevices();
    const channel = await createPlatformChannel(t.db, user.id, { chatId: BigInt(CHAT) });
    await linkChannel(t.db, home.id, channel.id);
    await linkChannel(t.db, dacha.id, channel.id);
    await createDevice(t.db, user.id, { name: 'Garage' });
    await t.db
      .update(device)
      .set({
        state: 'ONLINE',
        stateSince: new Date('2026-11-21T16:00:00Z'),
        offlineAt: clock.now(),
      })
      .where(eq(device.id, home.id));

    const reply = await handleUpdate(deps, message('/status'));
    const lines = reply!.text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Dacha');
    expect(lines[0]).toContain('⚪');
    expect(lines[1]).toContain('Home');
    expect(lines[1]).toContain('🟢');
    expect(lines[1]).toContain('18:00');
  });

  test('says so when the chat is not linked', async () => {
    const reply = await handleUpdate(deps, message('/status'));
    expect(reply?.text).toMatch(/not linked|isn't linked|Не прив/i);
  });

  test('says so when no device notifies the chat', async () => {
    const { user } = await userWithDevices();
    await createPlatformChannel(t.db, user.id, { chatId: BigInt(CHAT) });
    const reply = await handleUpdate(deps, message('/status'));
    expect(reply?.text).not.toContain('Home');
    expect(reply?.text.length).toBeGreaterThan(0);
  });

  test('ignores a command addressed to another bot', async () => {
    expect(await handleUpdate(deps, message('/status@OtherBot'))).toBeNull();
  });
});

describe('/stop and removal', () => {
  test('/stop unlinks the chat and its device links', async () => {
    const { user, home } = await userWithDevices();
    const channel = await createPlatformChannel(t.db, user.id, { chatId: BigInt(CHAT) });
    await linkChannel(t.db, home.id, channel.id);
    const reply = await handleUpdate(deps, message('/stop'));
    expect(reply?.text).toBeTruthy();
    expect(await channels()).toEqual([]);
    expect(await t.db.select().from(deviceChannel)).toEqual([]);
  });

  test('kicking the bot from a group deletes its channels silently', async () => {
    const { user } = await userWithDevices();
    await createPlatformChannel(t.db, user.id, { chatId: -100123n });
    const reply = await handleUpdate(deps, {
      my_chat_member: {
        chat: { id: -100123, type: 'supergroup' },
        new_chat_member: { status: 'kicked' },
      },
    });
    expect(reply).toBeNull();
    expect(await channels()).toEqual([]);
  });

  test('other membership changes are ignored', async () => {
    const { user } = await userWithDevices();
    await createPlatformChannel(t.db, user.id, { chatId: -100123n });
    await handleUpdate(deps, {
      my_chat_member: {
        chat: { id: -100123, type: 'supergroup' },
        new_chat_member: { status: 'administrator' },
      },
    });
    expect(await channels()).toHaveLength(1);
  });
});

describe('other input', () => {
  test('unknown commands get the help text', async () => {
    const reply = await handleUpdate(deps, message('/stats'));
    expect(reply?.text).toContain('/status');
  });

  test('plain text and non-text updates get no reply', async () => {
    expect(await handleUpdate(deps, message('hello'))).toBeNull();
    expect(
      await handleUpdate(deps, { message: { chat: { id: CHAT, type: 'private' } } }),
    ).toBeNull();
    expect(await handleUpdate(deps, {})).toBeNull();
  });
});
