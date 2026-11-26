import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { seedDelivery, seedWebhookDelivery } from '../../test/deliveries.ts';
import { FakeClock } from '../../test/fakes.ts';
import { appUser, delivery, device, notificationChannel } from '../db/schema/index.ts';
import { claimDeliveries, nextRetryAt, recordOutcome, type Outcome } from './deliveries.ts';

let t: TestDb;
const T = new Date('2026-11-21T16:50:00Z');
const at = (s: number) => new Date(T.getTime() + s * 1000);
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(T);
});

async function claimOne(seed: Parameters<typeof seedDelivery>[1] = {}) {
  const seeded = await seedDelivery(t.db, seed);
  const [claimed] = await claimDeliveries(t.db, clock, 10);
  return { seeded, claimed: claimed! };
}

const row = async (id: string) =>
  (await t.db.select().from(delivery).where(eq(delivery.id, id)))[0]!;
const channelRow = async (id: string) =>
  (await t.db.select().from(notificationChannel).where(eq(notificationChannel.id, id)))[0]!;

describe('nextRetryAt', () => {
  test.each([
    [1, 60],
    [2, 300],
    [3, 1800],
    [4, 7200],
    [5, 21_600],
  ])('after attempt %i waits %i s', (attempts, seconds) => {
    expect(nextRetryAt(attempts, T)).toEqual(at(seconds));
  });

  test('gives up after the sixth attempt', () => {
    expect(nextRetryAt(6, T)).toBeNull();
  });
});

describe('claimDeliveries', () => {
  test('claims a due row and leases it for two minutes', async () => {
    const { seeded, claimed } = await claimOne();
    expect(claimed.id).toBe(seeded.delivery.id);
    expect(claimed.attempts).toBe(1);
    expect(claimed.channel).toMatchObject({ type: 'TELEGRAM_PLATFORM', enabled: true });
    expect(claimed.recipient).toEqual({ language: 'uk', timezone: 'Europe/Kyiv' });
    const stored = await row(claimed.id);
    expect(stored.attempts).toBe(1);
    expect(stored.lastAttemptAt).toEqual(T);
    expect(stored.nextAttemptAt).toEqual(at(120));
    expect(await claimDeliveries(t.db, clock, 10)).toEqual([]);
  });

  test('ignores rows that are not due or already finished', async () => {
    const first = await seedDelivery(t.db, { nextAttemptAt: at(60) });
    const shared = {
      user: first.user,
      device: first.device,
      channel: first.channel,
      outageId: first.outageId,
    };
    await seedDelivery(t.db, { ...shared, event: 'device.online', status: 'SENT' });
    await seedDelivery(t.db, { ...shared, event: 'device.power_blip', status: 'FAILED' });
    expect(await claimDeliveries(t.db, clock, 10)).toEqual([]);
  });

  test('a lease that ran out makes the row due again', async () => {
    await claimOne();
    clock.advance(121_000);
    expect(await claimDeliveries(t.db, clock, 10)).toHaveLength(1);
  });

  test('filters by channel type', async () => {
    const chat = await seedDelivery(t.db);
    const hook = await seedWebhookDelivery(t.db, {
      userOverrides: { email: 'mary@example.com', name: 'Mary', language: 'en' },
      webhook: { name: 'Office hook' },
    });

    const webhookRows = await claimDeliveries(t.db, clock, 10, 'WEBHOOK');
    expect(webhookRows.map((d) => d.id)).toEqual([hook.delivery.id]);
    expect(webhookRows[0]!.channel).toMatchObject({
      type: 'WEBHOOK',
      name: 'Office hook',
    });
    expect(webhookRows[0]!.owner).toEqual({
      email: 'mary@example.com',
      name: 'Mary',
      language: 'en',
    });
    const chatRows = await claimDeliveries(t.db, clock, 10, 'TELEGRAM_PLATFORM');
    expect(chatRows.map((d) => d.id)).toEqual([chat.delivery.id]);
  });

  test('reads quiet hours and outage state at claim time', async () => {
    const { claimed } = await claimOne({
      deviceOverrides: { quietHoursStart: '23:00', quietHoursEnd: '07:00' },
      outageOverrides: { offAlertQueuedAt: at(-10) },
    });
    expect(claimed.quietHours).toEqual({ start: '23:00:00', end: '07:00:00' });
    expect(claimed.offAlertQueued).toBe(true);
    expect(claimed.outageEndedAt).toBeNull();
  });
});

describe('recordOutcome', () => {
  test('SENT marks the row and resets channel failures', async () => {
    const { claimed } = await claimOne();
    await t.db
      .update(notificationChannel)
      .set({ consecutiveFailures: 3 })
      .where(eq(notificationChannel.id, claimed.channel.id));
    await recordOutcome(t.db, clock, claimed, { type: 'SENT' });
    const stored = await row(claimed.id);
    expect(stored.status).toBe('SENT');
    expect(stored.sentAt).toEqual(T);
    expect((await channelRow(claimed.channel.id)).consecutiveFailures).toBe(0);
  });

  test('TRANSIENT on the first attempt retries in a minute', async () => {
    const { claimed } = await claimOne();
    await recordOutcome(t.db, clock, claimed, {
      type: 'TRANSIENT',
      error: 'HTTP 502: Bad Gateway',
    });
    const stored = await row(claimed.id);
    expect(stored).toMatchObject({ status: 'RETRYING', lastError: 'HTTP 502: Bad Gateway' });
    expect(stored.nextAttemptAt).toEqual(at(60));
    expect((await channelRow(claimed.channel.id)).consecutiveFailures).toBe(0);
  });

  test('TRANSIENT on the sixth attempt fails the delivery', async () => {
    const { claimed } = await claimOne({ attempts: 5 });
    await recordOutcome(t.db, clock, claimed, { type: 'TRANSIENT', error: 'timeout' });
    expect((await row(claimed.id)).status).toBe('FAILED');
    expect((await channelRow(claimed.channel.id)).enabled).toBe(true);
  });

  test('RETRY_AFTER waits without counting the attempt', async () => {
    const { claimed } = await claimOne();
    await recordOutcome(t.db, clock, claimed, { type: 'RETRY_AFTER', seconds: 7 });
    const stored = await row(claimed.id);
    expect(stored.status).toBe('RETRYING');
    expect(stored.attempts).toBe(0);
    expect(stored.nextAttemptAt).toEqual(at(7));
  });

  test('PERMANENT fails the delivery and counts a channel failure', async () => {
    const { claimed } = await claimOne();
    await recordOutcome(t.db, clock, claimed, { type: 'PERMANENT', error: 'HTTP 403: blocked' });
    expect((await row(claimed.id)).status).toBe('FAILED');
    expect((await channelRow(claimed.channel.id)).consecutiveFailures).toBe(1);
  });

  test('the 20th permanent failure disables the channel', async () => {
    const { claimed } = await claimOne();
    await t.db
      .update(notificationChannel)
      .set({ consecutiveFailures: 19 })
      .where(eq(notificationChannel.id, claimed.channel.id));
    await recordOutcome(t.db, clock, claimed, { type: 'PERMANENT', error: 'HTTP 403: blocked' });
    expect(await channelRow(claimed.channel.id)).toMatchObject({
      enabled: false,
      disabledReason: 'TOO_MANY_FAILURES',
      consecutiveFailures: 20,
    });
  });

  test('WEBHOOK_FAILED retries, counts the failure and reports only the disabling update', async () => {
    const seeded = await seedWebhookDelivery(t.db);
    const [claimed] = await claimDeliveries(t.db, clock, 10);
    await t.db
      .update(notificationChannel)
      .set({ consecutiveFailures: 18 })
      .where(eq(notificationChannel.id, seeded.channel.id));
    const fail = () =>
      recordOutcome(t.db, clock, claimed!, { type: 'WEBHOOK_FAILED', error: 'timeout' });

    expect(await fail()).toEqual({ disabled: false });
    expect(await row(claimed!.id)).toMatchObject({
      status: 'RETRYING',
      lastError: 'timeout',
      nextAttemptAt: at(60),
    });
    expect(await fail()).toEqual({ disabled: true });
    expect(await fail()).toEqual({ disabled: false });
    expect((await channelRow(seeded.channel.id)).consecutiveFailures).toBe(21);
  });

  test('MIGRATED updates the chat and makes the row due now', async () => {
    const { claimed } = await claimOne();
    await recordOutcome(t.db, clock, claimed, { type: 'MIGRATED', chatId: -100999n });
    expect((await channelRow(claimed.channel.id)).telegramChatId).toBe(-100999n);
    const stored = await row(claimed.id);
    expect(stored.attempts).toBe(0);
    expect(stored.nextAttemptAt).toEqual(T);
  });

  test('MIGRATED to a chat the user already has becomes permanent', async () => {
    const { claimed, seeded } = await claimOne();
    const other = await seedDelivery(t.db, {
      user: seeded.user,
      channelOverrides: { chatId: -100999n },
    });
    await recordOutcome(t.db, clock, claimed, { type: 'MIGRATED', chatId: -100999n });
    expect((await row(claimed.id)).status).toBe('FAILED');
    expect(other.channel.telegramChatId).toBe(-100999n);
  });

  test('SKIPPED fails the row without touching the channel', async () => {
    const { claimed } = await claimOne();
    await recordOutcome(t.db, clock, claimed, { type: 'SKIPPED', reason: 'outage closed' });
    expect(await row(claimed.id)).toMatchObject({
      status: 'FAILED',
      lastError: 'skipped: outage closed',
    });
    expect((await channelRow(claimed.channel.id)).consecutiveFailures).toBe(0);
  });

  test('a device deleted while the send was in flight is not an error', async () => {
    const { claimed, seeded } = await claimOne();
    await t.db.delete(device).where(eq(device.id, seeded.device.id));
    const outcome: Outcome = { type: 'SENT' };
    await expect(recordOutcome(t.db, clock, claimed, outcome)).resolves.toEqual({
      disabled: false,
    });
    expect(await t.db.select().from(delivery)).toEqual([]);
  });
});
