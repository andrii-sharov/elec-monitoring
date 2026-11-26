import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createWebhookChannel, linkChannel } from '../../../test/channels.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { seedDelivery, seedWebhookDelivery, type SeedOptions } from '../../../test/deliveries.ts';
import { pairDevice } from '../../../test/devices.ts';
import {
  FakeClock,
  FakeEmailSender,
  FakeTelegramClient,
  FakeWebhookSender,
  silentLogger,
} from '../../../test/fakes.ts';
import { addViewer } from '../../../test/sharing.ts';
import { appUser, delivery, notificationChannel, rateLimitBucket } from '../../db/schema/index.ts';
import { createI18n } from '../../i18n.ts';
import { processDueDeliveries } from '../../notifications/deliveryLoop.ts';
import { createPacer } from '../../notifications/pacer.ts';
import { createPgRateLimiter, type RateLimiter } from '../../rateLimit/limiter.ts';
import { encodeCursor } from '../pagination.ts';

let t: TestDb;
let clock: FakeClock;
const NOW = new Date('2026-11-21T17:00:00Z');
const CLOSED = {
  endedAt: new Date('2026-11-21T16:48:00Z'),
  cause: 'NETWORK',
  kind: 'LONG',
} as const;
const UNKNOWN_ID = '0193a1c4-0000-7000-8000-0000000000ff';

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  await t.db.delete(rateLimitBucket);
  clock = new FakeClock(NOW);
});

const app = (rateLimiter?: RateLimiter) =>
  testApp({ db: t.db, clock, ...(rateLimiter ? { rateLimiter } : {}) });

async function authFor(userId: string) {
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, userId);
  return `Bearer ${accessToken}`;
}

const list = (auth: string, channelId: string, query: Record<string, string> = {}) =>
  request(app())
    .get(`/api/v1/channels/${channelId}/deliveries`)
    .query(query)
    .set('Authorization', auth);

const redeliver = (auth: string, id: string, limiter?: RateLimiter) =>
  request(app(limiter)).post(`/api/v1/deliveries/${id}/redeliver`).set('Authorization', auth);

const rows = () => t.db.select().from(delivery);
const stored = async (id: string) =>
  (await t.db.select().from(delivery).where(eq(delivery.id, id)))[0]!;

async function seeded(options: SeedOptions = {}) {
  const result = await seedWebhookDelivery(t.db, {
    status: 'FAILED',
    attempts: 6,
    outageOverrides: CLOSED,
    ...options,
  });
  return { ...result, auth: await authFor(result.user.id) };
}

async function seedMany(count: number, createdAt: (index: number) => Date) {
  const first = await seeded({ createdAt: createdAt(0) });
  const created = [first.delivery];
  for (let index = 1; index < count; index += 1) {
    const next = await seedWebhookDelivery(t.db, {
      user: first.user,
      device: first.device,
      channel: first.channel,
      outageOverrides: CLOSED,
      createdAt: createdAt(index),
    });
    created.push(next.delivery);
  }
  const newestFirst = created
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
    .map((d) => d.id);
  return { ...first, newestFirst };
}

const ids = (body: { items: Array<{ id: string }> }) => body.items.map((item) => item.id);

describe('GET /api/v1/channels/:id/deliveries', () => {
  test('returns the delivery with the device of its outage', async () => {
    const s = await seeded();
    await t.db
      .update(delivery)
      .set({ lastAttemptAt: NOW, lastError: 'HTTP 502' })
      .where(eq(delivery.id, s.delivery.id));
    const res = await list(s.auth, s.channel.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: s.delivery.id,
          event: 'device.offline',
          device_id: s.device.id,
          status: 'FAILED',
          attempts: 6,
          last_attempt_at: '2026-11-21T17:00:00.000Z',
          last_error: 'HTTP 502',
          created_at: '2026-11-21T16:44:00.000Z',
        },
      ],
      next_cursor: null,
    });
  });

  test('lists only the deliveries of that channel, for a Telegram channel too', async () => {
    const s = await seeded();
    const other = await seedDelivery(t.db, {
      user: s.user,
      device: s.device,
      outageOverrides: CLOSED,
    });
    const res = await list(s.auth, other.channel.id);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([other.delivery.id]);
  });

  test('pages 20 at a time, newest first', async () => {
    const s = await seedMany(25, (i) => new Date(NOW.getTime() - (25 - i) * 1000));
    const first = await list(s.auth, s.channel.id);
    expect(ids(first.body)).toEqual(s.newestFirst.slice(0, 20));
    expect(first.body.next_cursor).toEqual(expect.any(String));
    const second = await list(s.auth, s.channel.id, { cursor: first.body.next_cursor });
    expect(ids(second.body)).toEqual(s.newestFirst.slice(20));
    expect(second.body.next_cursor).toBeNull();
  });

  test('orders equal timestamps by id without duplicates or gaps', async () => {
    const s = await seedMany(7, (i) => new Date(NOW.getTime() - (i === 0 ? 60_000 : 1000)));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await list(s.auth, s.channel.id, {
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      expect(res.status).toBe(200);
      seen.push(...ids(res.body));
      cursor = res.body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(s.newestFirst);
  });

  test.each(['0', '101', 'x'])('rejects limit=%s', async (limit) => {
    const s = await seeded();
    const res = await list(s.auth, s.channel.id, { limit });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('limit');
  });

  test.each([
    ['not base64url', '!!!'],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    ['too few values', encodeCursor([NOW.toISOString()])],
    ['a bad date', encodeCursor(['yesterday', UNKNOWN_ID])],
    ['an impossible date', encodeCursor(['2026-02-30T00:00:00Z', UNKNOWN_ID])],
    ['year zero', encodeCursor(['0000-01-01T00:00:00Z', UNKNOWN_ID])],
    ['a bad id', encodeCursor([NOW.toISOString(), 'x'])],
  ])('rejects a cursor with %s', async (_name, cursor) => {
    const s = await seeded();
    const res = await list(s.auth, s.channel.id, { cursor });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'cursor', code: 'invalid_cursor' }]);
  });

  test('rejects a channel ID that is not a UUID', async () => {
    const s = await seeded();
    expect((await list(s.auth, 'nope')).status).toBe(400);
  });
});

describe('POST /api/v1/deliveries/:id/redeliver', () => {
  test.each(['FAILED', 'SENT'] as const)('queues a %s delivery again', async (status) => {
    const s = await seeded({ status });
    await t.db
      .update(delivery)
      .set({ lastError: 'HTTP 502', sentAt: NOW, lastAttemptAt: NOW })
      .where(eq(delivery.id, s.delivery.id));
    clock.set(new Date('2026-11-21T18:00:00Z'));
    const res = await redeliver(await authFor(s.user.id), s.delivery.id);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      id: s.delivery.id,
      event: 'device.offline',
      device_id: s.device.id,
      status: 'QUEUED',
      attempts: 0,
      last_attempt_at: '2026-11-21T17:00:00.000Z',
      last_error: null,
      created_at: '2026-11-21T16:44:00.000Z',
    });
    expect(await rows()).toHaveLength(1);
    expect(await stored(s.delivery.id)).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      nextAttemptAt: new Date('2026-11-21T18:00:00Z'),
      lastError: null,
      sentAt: null,
    });
  });

  test('the worker then sends it with the same delivery ID', async () => {
    const s = await seeded();
    expect((await redeliver(s.auth, s.delivery.id)).status).toBe(202);
    const webhooks = new FakeWebhookSender();
    await processDueDeliveries({
      db: t.db,
      clock,
      logger: silentLogger(),
      telegram: new FakeTelegramClient(clock),
      webhooks,
      email: new FakeEmailSender(),
      encryptionKey: testConfig.encryptionKey,
      clientUrl: 'https://app.test',
      i18n: createI18n(),
      pacer: createPacer({ ratePerS: 30, clock, sleep: () => Promise.resolve() }),
    });
    expect(webhooks.sent.map((sent) => sent.deliveryId)).toEqual([s.delivery.id]);
    expect((await stored(s.delivery.id)).status).toBe('SENT');
  });

  test.each(['QUEUED', 'RETRYING'] as const)('refuses a %s delivery', async (status) => {
    const s = await seeded({ status, attempts: 2 });
    const res = await redeliver(s.auth, s.delivery.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(await stored(s.delivery.id)).toMatchObject({ status, attempts: 2 });
  });

  test('refuses a Telegram channel', async () => {
    const s = await seedDelivery(t.db, { status: 'FAILED', outageOverrides: CLOSED });
    const res = await redeliver(await authFor(s.user.id), s.delivery.id);
    expect(res.status).toBe(409);
    expect((await stored(s.delivery.id)).status).toBe('FAILED');
  });

  test('refuses a disabled channel', async () => {
    const s = await seeded();
    await t.db
      .update(notificationChannel)
      .set({ enabled: false, disabledReason: 'USER' })
      .where(eq(notificationChannel.id, s.channel.id));
    const res = await redeliver(s.auth, s.delivery.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Turn the channel on first');
    expect((await stored(s.delivery.id)).status).toBe('FAILED');
  });

  test('rejects an ID that is not a UUID and hides an unknown one', async () => {
    const s = await seeded();
    expect((await redeliver(s.auth, 'nope')).status).toBe(400);
    expect((await redeliver(s.auth, UNKNOWN_ID)).status).toBe(404);
  });

  test('allows 30 per minute per user', async () => {
    const s = await seeded({ status: 'QUEUED' });
    const limiter = createPgRateLimiter(t.db, clock);
    for (let i = 0; i < 30; i += 1) {
      expect((await redeliver(s.auth, s.delivery.id, limiter)).status).toBe(409);
    }
    const res = await redeliver(s.auth, s.delivery.id, limiter);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });
});

async function probe(userId: string, channelId: string, deliveryId: string) {
  const auth = await authFor(userId);
  const responses = [await list(auth, channelId), await redeliver(auth, deliveryId)];
  return {
    responses: responses.map((res) => `${res.status} ${res.body.error?.code}`),
    status: (await stored(deliveryId)).status,
  };
}

const HIDDEN = { responses: ['404 not_found', '404 not_found'], status: 'FAILED' };

describe('access', () => {
  test('hides the log from a stranger', async () => {
    const s = await seeded();
    const stranger = await createUser(t.db, { email: 'other@example.com' });
    expect(await probe(stranger.id, s.channel.id, s.delivery.id)).toEqual(HIDDEN);
  });

  test('hides the owner channel from a device viewer', async () => {
    const s = await seeded();
    const viewer = await createUser(t.db, { email: 'other@example.com' });
    await addViewer(t.db, s.device.id, viewer.id);
    expect(await probe(viewer.id, s.channel.id, s.delivery.id)).toEqual(HIDDEN);
  });

  test('hides a viewer channel from the device owner', async () => {
    const owner = await createUser(t.db);
    const viewer = await createUser(t.db, { email: 'other@example.com' });
    const { device } = await pairDevice(t.db, owner.id);
    await addViewer(t.db, device.id, viewer.id);
    const channel = await createWebhookChannel(t.db, viewer.id);
    await linkChannel(t.db, device.id, channel.id);
    const s = await seeded({ user: viewer, device, channel });
    expect(await probe(owner.id, channel.id, s.delivery.id)).toEqual(HIDDEN);
  });
});
