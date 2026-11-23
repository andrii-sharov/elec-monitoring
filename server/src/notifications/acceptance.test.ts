import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp } from '../../test/app.ts';
import { createUser } from '../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../test/channels.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { pairDevice } from '../../test/devices.ts';
import { FakeClock, FakeTelegramClient, silentLogger } from '../../test/fakes.ts';
import { appUser, delivery, device, deviceChannel, outage } from '../db/schema/index.ts';
import { createI18n } from '../i18n.ts';
import { checkOffline, queueDueOffAlerts } from '../monitoring/offline.ts';
import { processDueDeliveries } from './deliveryLoop.ts';
import { createPacer } from './pacer.ts';
import { createNotificationQueue } from './queue.ts';

const T = new Date('2026-11-21T16:42:00Z');
const BOOT_A = '0193a1c4-0000-7000-8000-00000000000a';
const BOOT_B = '0193a1c4-0000-7000-8000-00000000000b';

let t: TestDb;
let clock: FakeClock;
let telegram: FakeTelegramClient;
let queue: ReturnType<typeof createNotificationQueue>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(T);
  telegram = new FakeTelegramClient(clock);
  queue = createNotificationQueue(clock);
});

const at = (s: number) => new Date(T.getTime() + s * 1000);
const logger = silentLogger();

function pacerOn(clockToUse = clock) {
  return createPacer({
    ratePerS: 30,
    clock: clockToUse,
    sleep: (ms) => {
      clockToUse.advance(ms);
      return Promise.resolve();
    },
  });
}

async function tick(pacer: { take(): Promise<void> } = pacerOn()) {
  const monitor = { db: t.db, clock, logger, notifications: queue };
  await checkOffline(monitor);
  await queueDueOffAlerts(monitor);
  for (let handled = 1; handled > 0;) {
    handled = await processDueDeliveries({
      db: t.db,
      clock,
      logger,
      telegram,
      i18n: createI18n(),
      pacer,
    });
  }
}

async function setup(deviceOverrides: Partial<typeof device.$inferInsert> = {}) {
  const user = await createUser(t.db, { language: 'en', timezone: 'Europe/Kyiv' });
  const paired = await pairDevice(t.db, user.id, deviceOverrides);
  const channel = await createPlatformChannel(t.db, user.id);
  await linkChannel(t.db, paired.device.id, channel.id);
  let seq = 0;
  const send = async (body: Record<string, unknown>, expected = 204) => {
    const res = await request(testApp({ db: t.db, clock, notifications: queue }))
      .post('/api/v1/device/ping')
      .set('Authorization', `Bearer ${paired.token}`)
      .send({ rssi: -61, fw: '2.0.0', reset_reason: 'POWER_ON', ...body });
    expect(res.status).toBe(expected);
  };
  const boot = (bootId: string, resetReason = 'POWER_ON') => {
    seq = 1;
    return send({ type: 'BOOT', boot_id: bootId, seq, uptime_s: 8, reset_reason: resetReason });
  };
  const ping = (bootId: string, uptime = 100) => {
    seq += 1;
    return send({ type: 'PING', boot_id: bootId, seq, uptime_s: uptime });
  };
  const resend = () => send({ type: 'PING', boot_id: BOOT_A, seq, uptime_s: 100 });
  return { user, device: paired.device, channel, boot, ping, resend };
}

const texts = () => telegram.sent.map((s) => s.text);

describe('sustained loss of contact', () => {
  test('the OFF alert goes out at 120 s and only once', async () => {
    const d = await setup();
    await d.boot(BOOT_A);
    for (let s = 10; s <= 300; s += 10) {
      clock.set(at(s));
      await tick();
      if (s < 120) expect(telegram.sent).toHaveLength(0);
    }
    expect(texts()).toEqual(['🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42']);
  });

  test('with short alerts off the OFF alert waits for the threshold', async () => {
    const d = await setup({ notifyShortOutages: false });
    await d.boot(BOOT_A);
    for (let s = 10; s < 180; s += 10) {
      clock.set(at(s));
      await tick();
    }
    expect(telegram.sent).toHaveLength(0);
    clock.set(at(180));
    await tick();
    expect(texts()).toEqual(['🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42']);
  });
});

describe('recovery', () => {
  const recovery =
    '🟢 Home — device is back online\nOffline for 5 min (18:42 → 18:47) · suspected network outage';

  test.each([true, false])(
    'after an OFF alert one recovery is sent (network alerts %s)',
    async (notifyNetworkOutages) => {
      const d = await setup({ notifyNetworkOutages });
      await d.boot(BOOT_A);
      for (let s = 10; s <= 300; s += 10) {
        clock.set(at(s));
        await tick();
      }
      await d.ping(BOOT_A, 300);
      await tick();
      expect(texts()).toEqual([
        '🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42',
        recovery,
      ]);
    },
  );

  test('contact back before the worker runs sends one summary and no OFF alert', async () => {
    const d = await setup();
    await d.boot(BOOT_A);
    clock.set(at(125));
    await d.ping(BOOT_A, 125);
    await tick();
    expect(texts()).toEqual([
      '🟠 Home — device was out of contact\nOffline for 2 min (18:42 → 18:44) · suspected network outage',
    ]);
  });

  test.each([
    ['network alerts off', { notifyNetworkOutages: false }],
    ['short alerts off', { notifyShortOutages: false }],
  ])('the summary is suppressed with %s', async (_name, overrides) => {
    const d = await setup(overrides);
    await d.boot(BOOT_A);
    clock.set(at(125));
    await d.ping(BOOT_A, 125);
    await tick();
    expect(telegram.sent).toHaveLength(0);
    const [stored] = await t.db.select().from(outage);
    expect(stored).toMatchObject({ cause: 'NETWORK', kind: 'SHORT' });
  });

  test('an outage closed before its OFF alert was due sends nothing', async () => {
    const d = await setup({ notifyShortOutages: false });
    await d.boot(BOOT_A);
    clock.set(at(120));
    await tick();
    clock.set(at(150));
    await d.ping(BOOT_A, 150);
    clock.set(at(200));
    await tick();
    expect(telegram.sent).toHaveLength(0);
  });
});

describe('retries', () => {
  test('a resent check-in and a repeated queue call send nothing twice', async () => {
    const d = await setup();
    await d.boot(BOOT_A);
    for (let s = 10; s <= 300; s += 10) {
      clock.set(at(s));
      await tick();
    }
    await d.ping(BOOT_A, 300);
    await d.resend();
    const [closed] = await t.db.select().from(outage);
    await t.db.transaction(async (tx) => {
      await queue.offAlert(tx, { deviceId: d.device.id, outageId: closed!.id });
      await queue.recovery(tx, { deviceId: d.device.id, outageId: closed!.id });
    });
    await tick();
    expect(telegram.sent).toHaveLength(2);
    expect(await t.db.select().from(delivery)).toHaveLength(2);
  });
});

describe('power blip', () => {
  test('a reset within the timeout sends one blip message', async () => {
    const d = await setup();
    await d.boot(BOOT_A);
    clock.set(at(25));
    await d.boot(BOOT_B);
    await tick();
    expect(texts()).toEqual([
      '🟡 Home — suspected short power interruption\nDevice restarted · 25 s between check-ins',
    ]);
  });

  test('with short alerts off the blip is stored but not sent', async () => {
    const d = await setup({ notifyShortOutages: false });
    await d.boot(BOOT_A);
    clock.set(at(25));
    await d.boot(BOOT_B);
    await tick();
    expect(telegram.sent).toHaveLength(0);
    expect(await t.db.select().from(outage)).toHaveLength(1);
  });
});

describe('quiet hours', () => {
  test('an OFF alert at 23:30 local time is silent', async () => {
    clock.set(new Date('2026-11-21T21:28:00Z'));
    const d = await setup({ quietHoursStart: '23:00', quietHoursEnd: '07:00' });
    await d.boot(BOOT_A);
    clock.set(new Date('2026-11-21T21:30:00Z'));
    await tick();
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]!.silent).toBe(true);
  });
});

describe('mass outage', () => {
  test('300 devices across 30 users are alerted once each within 30 messages per second', async () => {
    const chats: bigint[] = [];
    for (let u = 0; u < 30; u++) {
      const user = await createUser(t.db, { email: `u${u}@example.com`, language: 'en' });
      const channel = await createPlatformChannel(t.db, user.id);
      chats.push(channel.telegramChatId!);
      const rows = await t.db
        .insert(device)
        .values(
          Array.from({ length: 10 }, (_, i) => ({
            ownerId: user.id,
            name: `d${u}-${i}`,
            state: 'ONLINE' as const,
            stateSince: T,
            lastSeenAt: T,
            offlineAt: at(120),
          })),
        )
        .returning({ id: device.id });
      await t.db
        .insert(deviceChannel)
        .values(rows.map((r) => ({ deviceId: r.id, channelId: channel.id })));
    }

    const requested: number[] = [];
    const frozen = createPacer({
      ratePerS: 30,
      clock,
      sleep: (ms) => {
        requested.push(ms);
        return Promise.resolve();
      },
    });
    clock.set(at(130));
    await tick(frozen);

    expect(await t.db.select().from(outage).where(eq(outage.type, 'OUTAGE'))).toHaveLength(300);
    expect(telegram.sent).toHaveLength(300);
    const perChat = new Map<bigint, number>();
    for (const s of telegram.sent) perChat.set(s.chatId, (perChat.get(s.chatId) ?? 0) + 1);
    expect([...perChat.values()].every((n) => n === 10)).toBe(true);
    expect(chats.every((c) => perChat.has(c))).toBe(true);

    const offsets = [0, ...requested].toSorted((a, b) => a - b);
    for (let i = 0; i + 30 < offsets.length; i++) {
      expect(offsets[i + 30]! - offsets[i]!).toBeGreaterThanOrEqual(1000);
    }
    expect(offsets.at(-1)).toBeGreaterThanOrEqual(9000);
  });
});
