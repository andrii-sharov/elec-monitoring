import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { seedDelivery, seedWebhookDelivery } from '../../test/deliveries.ts';
import { testConfig } from '../../test/app.ts';
import {
  FakeClock,
  FakeEmailSender,
  FakeTelegramClient,
  FakeWebhookSender,
  linkFrom,
  silentLogger,
} from '../../test/fakes.ts';
import { and, eq as equals } from 'drizzle-orm';
import { resources } from '@elec/shared';
import { createUser } from '../../test/auth.ts';
import { addViewer } from '../../test/sharing.ts';
import { appUser, delivery, deviceViewer, notificationChannel } from '../db/schema/index.ts';
import { createI18n } from '../i18n.ts';
import { encrypt } from '../lib/crypto.ts';
import type { WebhookResult } from '../webhooks/sender.ts';
import { LEASE_MS } from './deliveries.ts';
import { createPacer } from './pacer.ts';
import {
  processDueDeliveries,
  runDeliveryLoop,
  WEBHOOK_BATCH,
  type DeliveryDeps,
} from './deliveryLoop.ts';

let t: TestDb;
let clock: FakeClock;
let telegram: FakeTelegramClient;
let webhooks: FakeWebhookSender;
let email: FakeEmailSender;
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
  webhooks = new FakeWebhookSender();
  email = new FakeEmailSender();
  deps = {
    db: t.db,
    clock,
    logger: silentLogger(),
    telegram,
    webhooks,
    email,
    encryptionKey: testConfig.encryptionKey,
    clientUrl: 'https://app.test',
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
      '🔴 <b>Home</b> — device stopped checking in\nLast signal: 21 Nov 18:42',
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
    expect(telegram.sent[0]!.text).toContain('🟢 <b>Home</b> — device is back online');
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

async function sharedOutage(viewerOverrides: Partial<typeof appUser.$inferInsert> = {}) {
  const owner = await seedDelivery(t.db, {
    userOverrides: { email: 'john@example.com', language: 'uk', timezone: 'Europe/Kyiv' },
  });
  const viewer = await createUser(t.db, { email: 'mary@example.com', ...viewerOverrides });
  await addViewer(t.db, owner.device.id, viewer.id);
  const theirs = await seedDelivery(t.db, {
    user: viewer,
    device: owner.device,
    outageId: owner.outageId,
  });
  return { owner, viewer, theirs };
}
describe('viewers', () => {
  test('a removed viewer is skipped while the owner is sent', async () => {
    const { owner, viewer, theirs } = await sharedOutage();
    await t.db
      .delete(deviceViewer)
      .where(
        and(equals(deviceViewer.deviceId, owner.device.id), equals(deviceViewer.userId, viewer.id)),
      );

    await processDueDeliveries(deps);

    expect(telegram.sent.map((s) => s.chatId)).toEqual([owner.channel.telegramChatId]);
    expect((await stored(owner.delivery.id)).status).toBe('SENT');
    const skipped = await stored(theirs.delivery.id);
    expect(skipped.status).toBe('FAILED');
    expect(skipped.lastError).toBe('skipped: no access');
    const [channel] = await t.db
      .select()
      .from(notificationChannel)
      .where(equals(notificationChannel.id, theirs.channel.id));
    expect(channel?.consecutiveFailures).toBe(0);
  });

  test('each recipient gets their own language and time zone', async () => {
    const { owner, theirs } = await sharedOutage({
      language: 'en',
      timezone: 'America/New_York',
    });
    await processDueDeliveries(deps);
    const byChat = new Map(telegram.sent.map((s) => [s.chatId, s.text]));
    expect(byChat.get(owner.channel.telegramChatId!)).toContain('18:42');
    expect(byChat.get(theirs.channel.telegramChatId!)).toBe(
      '🔴 <b>Home</b> — device stopped checking in\nLast signal: 21 Nov 11:42',
    );
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
      sleep: async () => {
        await nextTurn();
        sleeps += 1;
        if (telegram.sent.length === 1) controller.abort();
      },
    });
    expect((await stored(seeded.delivery.id)).status).toBe('SENT');
    expect(beats).toBe(1);
    expect(sleeps).toBeGreaterThan(0);
  });
});

const channelState = async (id: string) =>
  (await t.db.select().from(notificationChannel).where(eq(notificationChannel.id, id)))[0]!;

const setChannel = (id: string, set: Partial<typeof notificationChannel.$inferInsert>) =>
  t.db.update(notificationChannel).set(set).where(eq(notificationChannel.id, id));

const failure: WebhookResult = { type: 'FAILED', error: 'HTTP 500' };
const closedOutage = {
  endedAt: new Date('2026-11-21T16:48:00Z'),
  cause: 'NETWORK' as const,
  kind: 'LONG' as const,
};

type Seeded = Awaited<ReturnType<typeof seedDelivery>>;

const sameChannel = (first: Seeded) => ({
  user: first.user,
  device: first.device,
  channel: first.channel,
  outageId: first.outageId,
});

describe('webhook deliveries', () => {
  test('posts the payload with sent_at, signed with the channel secret, without pacing', async () => {
    const seeded = await seedWebhookDelivery(t.db, {
      webhook: { url: 'https://hooks.example.com/a', secret: 'whsec_one' },
    });
    const take = vi.fn<() => Promise<void>>(() => Promise.resolve());

    expect(await processDueDeliveries({ ...deps, pacer: { take } })).toBe(1);

    expect(webhooks.sent).toHaveLength(1);
    const [request] = webhooks.sent;
    expect(request).toMatchObject({
      url: 'https://hooks.example.com/a',
      secret: 'whsec_one',
      event: 'device.offline',
      deliveryId: seeded.delivery.id,
    });
    expect(JSON.parse(request!.body)).toEqual({
      ...(seeded.delivery.payload as object),
      sent_at: T.toISOString(),
    });
    expect(take).not.toHaveBeenCalled();
    expect(telegram.sent).toEqual([]);
    expect(await stored(seeded.delivery.id)).toMatchObject({ status: 'SENT', sentAt: T });
  });

  test('retries on the schedule with the same id and a fresh sent_at, then fails', async () => {
    const seeded = await seedWebhookDelivery(t.db);
    webhooks.next = Array.from({ length: 6 }, () => failure);
    const attemptTimes: string[] = [];

    const attempt = async () => {
      attemptTimes.push(clock.now().toISOString());
      expect(await processDueDeliveries(deps)).toBe(1);
    };

    await attempt();
    for (const waitS of [60, 300, 1800, 7200, 21_600]) {
      clock.advance(waitS * 1000 - 1);
      expect(await processDueDeliveries(deps)).toBe(0);
      clock.advance(1);
      await attempt();
    }

    expect(webhooks.sent.map((r) => r.deliveryId)).toEqual(Array(6).fill(seeded.delivery.id));
    expect(webhooks.sent.map((r) => JSON.parse(r.body).sent_at)).toEqual(attemptTimes);
    expect(await stored(seeded.delivery.id)).toMatchObject({
      status: 'FAILED',
      attempts: 6,
      lastError: 'HTTP 500',
    });
    expect((await channelState(seeded.channel.id)).consecutiveFailures).toBe(6);
    clock.advance(86_400_000);
    expect(await processDueDeliveries(deps)).toBe(0);
  });

  test('a success resets the failure count', async () => {
    const seeded = await seedWebhookDelivery(t.db);
    webhooks.next = [failure, failure];
    await processDueDeliveries(deps);
    clock.advance(60_000);
    await processDueDeliveries(deps);
    expect((await channelState(seeded.channel.id)).consecutiveFailures).toBe(2);
    clock.advance(300_000);
    await processDueDeliveries(deps);
    expect((await channelState(seeded.channel.id)).consecutiveFailures).toBe(0);
    expect((await stored(seeded.delivery.id)).status).toBe('SENT');
  });

  test('the 20th failure disables the channel and emails the owner once', async () => {
    const seeded = await seedWebhookDelivery(t.db, {
      userOverrides: { language: 'ru' },
      webhook: { name: 'Office hook', secret: 'whsec_hidden' },
    });
    await setChannel(seeded.channel.id, { consecutiveFailures: 19 });
    webhooks.next = [failure];

    await processDueDeliveries(deps);

    expect(await channelState(seeded.channel.id)).toMatchObject({
      enabled: false,
      disabledReason: 'TOO_MANY_FAILURES',
      consecutiveFailures: 20,
    });
    expect(email.sent).toHaveLength(1);
    const [message] = email.sent;
    expect(message!.to).toBe('john@example.com');
    expect(message!.subject).toBe(resources.ru.translation.email.webhookDisabled.subject);
    expect(message!.text).toContain('Office hook');
    expect(message!.text).not.toContain('whsec_hidden');
    expect(linkFrom(message!)).toBe('https://app.test/notifications?type=WEBHOOK');

    clock.advance(60_000);
    await processDueDeliveries(deps);
    expect((await stored(seeded.delivery.id)).lastError).toBe('skipped: channel disabled');
    expect(webhooks.sent).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });

  test('two failing deliveries in one batch at 19 send exactly one email', async () => {
    const first = await seedWebhookDelivery(t.db);
    await seedDelivery(t.db, { ...sameChannel(first), event: 'device.online' });
    await setChannel(first.channel.id, { consecutiveFailures: 19 });
    webhooks.next = [failure, failure];

    expect(await processDueDeliveries(deps)).toBe(2);

    expect((await channelState(first.channel.id)).enabled).toBe(false);
    expect(email.sent).toHaveLength(1);
  });

  test('an owner without an email gets the channel disabled and no email', async () => {
    const seeded = await seedWebhookDelivery(t.db, {
      userOverrides: { phone: '+380501234567' },
    });
    await setChannel(seeded.channel.id, { consecutiveFailures: 19 });
    webhooks.next = [failure];

    await processDueDeliveries(deps);

    expect((await channelState(seeded.channel.id)).enabled).toBe(false);
    expect(email.sent).toEqual([]);
  });

  test('a failed email does not fail the delivery run', async () => {
    const seeded = await seedWebhookDelivery(t.db);
    await setChannel(seeded.channel.id, { consecutiveFailures: 19 });
    webhooks.next = [failure];
    email.failNext();

    await expect(processDueDeliveries(deps)).resolves.toBe(1);
    expect((await stored(seeded.delivery.id)).status).toBe('RETRYING');
  });

  test('a retry after rotation is signed with the new secret', async () => {
    const seeded = await seedWebhookDelivery(t.db, { webhook: { secret: 'whsec_old' } });
    webhooks.next = [failure];
    await processDueDeliveries(deps);
    await setChannel(seeded.channel.id, {
      webhookSecretEnc: encrypt(testConfig.encryptionKey, 'whsec_new'),
    });
    clock.advance(60_000);
    await processDueDeliveries(deps);

    expect(webhooks.sent.map((r) => r.secret)).toEqual(['whsec_old', 'whsec_new']);
  });

  test('an unreadable secret is retried without sending or counting a failure', async () => {
    const broken = await seedWebhookDelivery(t.db);
    await setChannel(broken.channel.id, {
      webhookSecretEnc: encrypt(Buffer.alloc(32, 9), 'whsec_unreadable'),
    });
    const healthy = await seedWebhookDelivery(t.db, {
      userOverrides: { email: 'mary@example.com' },
    });

    expect(await processDueDeliveries(deps)).toBe(2);

    expect(webhooks.sent.map((r) => r.deliveryId)).toEqual([healthy.delivery.id]);
    expect(await stored(broken.delivery.id)).toMatchObject({
      status: 'RETRYING',
      lastError: 'webhook secret could not be decrypted',
    });
    expect((await channelState(broken.channel.id)).consecutiveFailures).toBe(0);
  });

  test('still sends device.offline for a closed outage, unlike Telegram', async () => {
    const hook = await seedWebhookDelivery(t.db, { outageOverrides: closedOutage });
    const chat = await seedDelivery(t.db, {
      user: hook.user,
      device: hook.device,
      outageId: hook.outageId,
    });

    await processDueDeliveries(deps);

    expect(webhooks.sent.map((r) => r.deliveryId)).toEqual([hook.delivery.id]);
    expect(telegram.sent).toEqual([]);
    expect((await stored(chat.delivery.id)).lastError).toBe('skipped: outage closed');
  });

  test('ignores quiet hours', async () => {
    clock.set(new Date('2026-11-21T21:30:00Z'));
    const seeded = await seedWebhookDelivery(t.db, {
      deviceOverrides: { quietHoursStart: '23:00', quietHoursEnd: '07:00' },
    });
    await processDueDeliveries(deps);
    expect(webhooks.sent).toHaveLength(1);
    expect((await stored(seeded.delivery.id)).status).toBe('SENT');
  });

  test('claims no more webhooks than one lease can cover', async () => {
    expect(WEBHOOK_BATCH * 10_000).toBeLessThan(LEASE_MS);
    const first = await seedWebhookDelivery(t.db, { outageOverrides: closedOutage });
    for (let i = 0; i < WEBHOOK_BATCH; i++) {
      await seedDelivery(t.db, {
        user: first.user,
        device: first.device,
        channel: first.channel,
        outageOverrides: closedOutage,
        createdAt: new Date(Date.parse('2026-11-21T16:45:00Z') + i * 1000),
      });
    }

    expect(await processDueDeliveries(deps)).toBe(WEBHOOK_BATCH);
    expect(await processDueDeliveries(deps)).toBe(1);
  });
});

function hangingWebhooks() {
  const hang = Promise.withResolvers<WebhookResult>();
  webhooks.send = (request) => {
    webhooks.sent.push(request);
    return hang.promise;
  };
  return () => hang.resolve({ type: 'SENT', status: 200 });
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('runDeliveryLoop with a hanging webhook', () => {
  test('keeps sending Telegram alerts and beating', async () => {
    const release = hangingWebhooks();
    const hook = await seedWebhookDelivery(t.db);
    const controller = new AbortController();
    const aborted = new Promise((resolve) => controller.signal.addEventListener('abort', resolve));
    let chat: Seeded | undefined;
    let beats = 0;

    const running = runDeliveryLoop({
      ...deps,
      signal: controller.signal,
      beat: () => {
        beats += 1;
        return Promise.resolve();
      },
      sleep: async () => {
        await nextTurn();
        if (webhooks.sent.length === 0) return;
        if (!chat) {
          chat = await seedDelivery(t.db, {
            user: hook.user,
            device: hook.device,
            outageId: hook.outageId,
          });
          clock.advance(10_000);
        } else if (telegram.sent.length === 1) {
          controller.abort();
        }
      },
    });
    await aborted;

    expect(beats).toBeGreaterThanOrEqual(2);
    expect((await stored(chat!.delivery.id)).status).toBe('SENT');
    expect((await stored(hook.delivery.id)).status).toBe('QUEUED');

    release();
    await running;
    expect((await stored(hook.delivery.id)).status).toBe('SENT');
  });

  test('on abort finishes the send in flight and releases the rest of the batch', async () => {
    const release = hangingWebhooks();
    const first = await seedWebhookDelivery(t.db);
    const second = await seedDelivery(t.db, {
      ...sameChannel(first),
      event: 'device.online',
      createdAt: new Date('2026-11-21T16:45:00Z'),
    });
    const controller = new AbortController();

    const running = runDeliveryLoop({
      ...deps,
      signal: controller.signal,
      beat: () => Promise.resolve(),
      sleep: async () => {
        await nextTurn();
        if (webhooks.sent.length === 1) controller.abort();
      },
    });
    await new Promise((resolve) => controller.signal.addEventListener('abort', resolve));
    release();
    await running;

    expect(webhooks.sent).toHaveLength(1);
    expect((await stored(first.delivery.id)).status).toBe('SENT');
    expect(await stored(second.delivery.id)).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      nextAttemptAt: T,
    });
  });
});
