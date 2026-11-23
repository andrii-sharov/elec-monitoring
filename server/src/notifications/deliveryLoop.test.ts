import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { seedDelivery } from '../../test/deliveries.ts';
import { FakeClock, FakeTelegramClient, silentLogger } from '../../test/fakes.ts';
import { appUser, delivery } from '../db/schema/index.ts';
import { createI18n } from '../i18n.ts';
import { createPacer } from './pacer.ts';
import { processDueDeliveries, runDeliveryLoop, type DeliveryDeps } from './deliveryLoop.ts';

let t: TestDb;
let clock: FakeClock;
let telegram: FakeTelegramClient;
let deps: DeliveryDeps;
const T = new Date('2026-11-21T16:50:00Z');

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
  deps = {
    db: t.db,
    clock,
    logger: silentLogger(),
    telegram,
    i18n: createI18n(),
    pacer: createPacer({
      ratePerS: 30,
      clock,
      sleep: (ms) => {
        clock.advance(ms);
        return Promise.resolve();
      },
    }),
  };
});

const stored = async (id: string) =>
  (await t.db.select().from(delivery).where(eq(delivery.id, id)))[0]!;

describe('processDueDeliveries', () => {
  test('sends a queued OFF alert in the recipient language', async () => {
    const seeded = await seedDelivery(t.db, { userOverrides: { language: 'en' } });
    expect(await processDueDeliveries(deps)).toBe(1);
    expect(telegram.sent.map((s) => s.text)).toEqual([
      '🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42',
    ]);
    expect(telegram.sent[0]).toMatchObject({
      chatId: seeded.channel.telegramChatId,
      silent: false,
    });
    expect((await stored(seeded.delivery.id)).status).toBe('SENT');
  });

  test('renders in the recipient language', async () => {
    await seedDelivery(t.db, { userOverrides: { language: 'ru' } });
    await processDueDeliveries(deps);
    expect(telegram.sent[0]!.text).toContain('устройство перестало выходить на связь');
  });

  test('sends silently during the recipient quiet hours', async () => {
    clock.set(new Date('2026-11-21T21:30:00Z'));
    await seedDelivery(t.db, {
      deviceOverrides: { quietHoursStart: '23:00', quietHoursEnd: '07:00' },
      nextAttemptAt: new Date('2026-11-21T21:00:00Z'),
    });
    await processDueDeliveries(deps);
    expect(telegram.sent[0]!.silent).toBe(true);
  });

  test('skips an OFF alert whose outage has closed and still sends the recovery', async () => {
    const off = await seedDelivery(t.db, {
      userOverrides: { language: 'en' },
      outageOverrides: {
        endedAt: new Date('2026-11-21T16:48:00Z'),
        cause: 'NETWORK',
        kind: 'LONG',
        offAlertQueuedAt: new Date('2026-11-21T16:44:00Z'),
      },
      createdAt: new Date('2026-11-21T16:44:00Z'),
    });
    const online = await seedDelivery(t.db, {
      user: off.user,
      device: off.device,
      channel: off.channel,
      outageId: off.outageId,
      event: 'device.online',
      createdAt: new Date('2026-11-21T16:48:00Z'),
    });
    expect(await processDueDeliveries(deps)).toBe(2);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]!.text).toContain('🟢 Home — device is back online');
    expect(await stored(off.delivery.id)).toMatchObject({
      status: 'FAILED',
      lastError: 'skipped: outage closed',
    });
    expect((await stored(online.delivery.id)).status).toBe('SENT');
  });

  test('sends two due messages for one chat in creation order', async () => {
    const first = await seedDelivery(t.db, {
      outageOverrides: { offAlertQueuedAt: new Date('2026-11-21T16:44:00Z') },
      createdAt: new Date('2026-11-21T16:44:00Z'),
    });
    await seedDelivery(t.db, {
      user: first.user,
      device: first.device,
      channel: first.channel,
      outageId: first.outageId,
      event: 'device.power_blip',
      createdAt: new Date('2026-11-21T16:45:00Z'),
    });
    await processDueDeliveries(deps);
    expect(telegram.sent[0]!.text).toContain('🔴');
    expect(telegram.sent[1]!.text).toContain('🟡');
  });

  test('skips a disabled channel', async () => {
    const seeded = await seedDelivery(t.db, { channelOverrides: { enabled: false } });
    await processDueDeliveries(deps);
    expect(telegram.sent).toEqual([]);
    expect((await stored(seeded.delivery.id)).lastError).toBe('skipped: channel disabled');
  });

  test('retries a flaky Telegram on the schedule and ends SENT on attempt six', async () => {
    const seeded = await seedDelivery(t.db);
    telegram.script(
      ...Array.from({ length: 5 }, () => ({ type: 'TRANSIENT' as const, error: 'HTTP 502' })),
    );
    for (const waitS of [0, 60, 300, 1800, 7200, 21_600]) {
      clock.advance(waitS * 1000);
      await processDueDeliveries(deps);
    }
    const final = await stored(seeded.delivery.id);
    expect(final).toMatchObject({ status: 'SENT', attempts: 6 });
    expect(telegram.sent).toHaveLength(1);
  });

  test('does nothing when nothing is due', async () => {
    expect(await processDueDeliveries(deps)).toBe(0);
  });
});

describe('runDeliveryLoop', () => {
  test('processes deliveries, beats, and sleeps when idle until aborted', async () => {
    const seeded = await seedDelivery(t.db);
    const controller = new AbortController();
    let beats = 0;
    let sleeps = 0;
    await runDeliveryLoop({
      ...deps,
      signal: controller.signal,
      beat: () => {
        beats += 1;
        return Promise.resolve();
      },
      sleep: () => {
        sleeps += 1;
        if (sleeps === 2) controller.abort();
        return Promise.resolve();
      },
    });
    expect((await stored(seeded.delivery.id)).status).toBe('SENT');
    expect(beats).toBe(1);
    expect(sleeps).toBe(2);
  });
});
