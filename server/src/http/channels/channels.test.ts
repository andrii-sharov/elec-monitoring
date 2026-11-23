import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../../test/channels.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { seedDelivery } from '../../../test/deliveries.ts';
import { FakeClock } from '../../../test/fakes.ts';
import {
  appUser,
  delivery,
  deviceChannel,
  notificationChannel,
  oneTimeToken,
} from '../../db/schema/index.ts';
import { sha256 } from '../../lib/crypto.ts';
import type { RateLimiter } from '../../rateLimit/limiter.ts';

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

const app = (rateLimiter?: RateLimiter) =>
  testApp({ db: t.db, clock, ...(rateLimiter ? { rateLimiter } : {}) });

async function authed(overrides: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(t.db, overrides);
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  return { user, auth: `Bearer ${accessToken}` };
}

const denyAll: RateLimiter = {
  hit: () => Promise.resolve({ allowed: false, retryAfterS: 30 }),
};

describe('POST /api/v1/channels/telegram-link', () => {
  test('returns bot links and stores only a hash', async () => {
    const { user, auth } = await authed();
    const res = await request(app())
      .post('/api/v1/channels/telegram-link')
      .set('Authorization', auth);
    expect(res.status).toBe(201);
    const code = /^https:\/\/t\.me\/TestBot\?start=([\w-]{43})$/.exec(res.body.url)?.[1];
    expect(code).toBeDefined();
    expect(res.body.group_url).toBe(`https://t.me/TestBot?startgroup=${code}`);
    expect(res.body.expires_at).toBe('2026-11-21T16:57:00.000Z');
    const [row] = await t.db.select().from(oneTimeToken).where(eq(oneTimeToken.userId, user.id));
    expect(row).toMatchObject({ purpose: 'TELEGRAM_LINK', usedAt: null });
    expect(row!.tokenHash).toEqual(sha256(code!));
  });

  test('a new link expires the previous one', async () => {
    const { user, auth } = await authed();
    await request(app()).post('/api/v1/channels/telegram-link').set('Authorization', auth);
    await request(app()).post('/api/v1/channels/telegram-link').set('Authorization', auth);
    const rows = await t.db.select().from(oneTimeToken).where(eq(oneTimeToken.userId, user.id));
    expect(rows.filter((r) => r.usedAt === null)).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  test('is rate limited', async () => {
    const { auth } = await authed();
    const res = await request(app(denyAll))
      .post('/api/v1/channels/telegram-link')
      .set('Authorization', auth);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
  });
});

describe('GET /api/v1/channels', () => {
  test('lists only the caller channels with a string chat id', async () => {
    const { user, auth } = await authed();
    const other = await createUser(t.db, { email: 'jane@example.com' });
    const mine = await createPlatformChannel(t.db, user.id, {
      chatId: -1001234567890n,
      name: 'Dacha chat',
    });
    await createPlatformChannel(t.db, other.id);
    const res = await request(app()).get('/api/v1/channels').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: mine.id,
        type: 'TELEGRAM_PLATFORM',
        name: 'Dacha chat',
        enabled: true,
        disabled_reason: null,
        config: { chat_id: '-1001234567890' },
        created_at: mine.createdAt.toISOString(),
      },
    ]);
  });
});

const get = (auth: string, id: string) =>
  request(app()).get(`/api/v1/devices/${id}/channels`).set('Authorization', auth);

describe('device channels', () => {
  async function setup() {
    const { user, auth } = await authed();
    const dev = await createDevice(t.db, user.id);
    const a = await createPlatformChannel(t.db, user.id);
    const b = await createPlatformChannel(t.db, user.id);
    return { user, auth, dev, a, b };
  }

  const put = (auth: string, id: string, body: unknown) =>
    request(app())
      .put(`/api/v1/devices/${id}/channels`)
      .set('Authorization', auth)
      .send(body as object);

  test('PUT replaces the set and GET reads it back', async () => {
    const { auth, dev, a, b } = await setup();
    expect(
      (await put(auth, dev.id, { channel_ids: [a.id, b.id] })).body.channel_ids.toSorted(),
    ).toEqual([a.id, b.id].toSorted());
    expect((await get(auth, dev.id)).body.channel_ids.toSorted()).toEqual([a.id, b.id].toSorted());
    expect((await put(auth, dev.id, { channel_ids: [b.id] })).body).toEqual({
      channel_ids: [b.id],
    });
    expect((await put(auth, dev.id, { channel_ids: [] })).body).toEqual({ channel_ids: [] });
    expect((await get(auth, dev.id)).body).toEqual({ channel_ids: [] });
  });

  test("PUT keeps other users' links on the device", async () => {
    const { auth, dev, a } = await setup();
    const other = await createUser(t.db, { email: 'jane@example.com' });
    const foreign = await createPlatformChannel(t.db, other.id);
    await linkChannel(t.db, dev.id, foreign.id);
    await put(auth, dev.id, { channel_ids: [a.id] });
    await put(auth, dev.id, { channel_ids: [] });
    const links = await t.db.select().from(deviceChannel);
    expect(links.map((l) => l.channelId)).toEqual([foreign.id]);
  });

  test('a foreign channel id is a validation error at its index', async () => {
    const { auth, dev, a } = await setup();
    const other = await createUser(t.db, { email: 'jane@example.com' });
    const foreign = await createPlatformChannel(t.db, other.id);
    const res = await put(auth, dev.id, { channel_ids: [a.id, foreign.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'channel_ids.1', code: 'not_found' }]);
    expect((await get(auth, dev.id)).body.channel_ids).toEqual([]);
  });

  test.each([
    ['not uuids', { channel_ids: ['x'] }],
    ['too many', { channel_ids: Array.from({ length: 51 }, () => crypto.randomUUID()) }],
    ['unknown key', { channel_ids: [], extra: 1 }],
    ['missing', {}],
  ])('rejects %s', async (_name, body) => {
    const { auth, dev } = await setup();
    expect((await put(auth, dev.id, body)).status).toBe(400);
  });

  test('duplicates are stored once', async () => {
    const { auth, dev, a } = await setup();
    expect((await put(auth, dev.id, { channel_ids: [a.id, a.id] })).body).toEqual({
      channel_ids: [a.id],
    });
  });

  test('a stranger gets 404 on both routes', async () => {
    const { dev } = await setup();
    const stranger = await authed({ email: 'jane@example.com' });
    expect((await get(stranger.auth, dev.id)).status).toBe(404);
    expect((await put(stranger.auth, dev.id, { channel_ids: [] })).status).toBe(404);
  });
});

describe('DELETE /api/v1/channels/:id', () => {
  const del = (auth: string, id: string) =>
    request(app()).delete(`/api/v1/channels/${id}`).set('Authorization', auth);

  test('deletes the channel with its links and deliveries', async () => {
    const { user, auth } = await authed();
    const seeded = await seedDelivery(t.db, { user });
    const other = await createPlatformChannel(t.db, user.id);
    await linkChannel(t.db, seeded.device.id, other.id);
    const res = await del(auth, seeded.channel.id);
    expect(res.status).toBe(204);
    const channels = await t.db.select().from(notificationChannel);
    expect(channels.map((c) => c.id)).toEqual([other.id]);
    expect(await t.db.select().from(delivery)).toEqual([]);
    const links = await t.db.select().from(deviceChannel);
    expect(links.map((l) => l.channelId)).toEqual([other.id]);
  });

  test("another user's channel is 404 and stays", async () => {
    const { auth } = await authed();
    const other = await createUser(t.db, { email: 'jane@example.com' });
    const foreign = await createPlatformChannel(t.db, other.id);
    const res = await del(auth, foreign.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(await t.db.select().from(notificationChannel)).toHaveLength(1);
  });

  test('unknown id is 404 and a malformed id is 400', async () => {
    const { auth } = await authed();
    expect((await del(auth, crypto.randomUUID())).status).toBe(404);
    const bad = await del(auth, 'not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
  });

  test('requires a verified email and a token', async () => {
    const { auth } = await authed({ emailVerifiedAt: null });
    const id = crypto.randomUUID();
    const res = await del(auth, id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_not_verified');
    expect((await request(app()).delete(`/api/v1/channels/${id}`)).status).toBe(401);
  });
});

describe('auth', () => {
  test('requires a JWT', async () => {
    expect((await request(app()).get('/api/v1/channels')).status).toBe(401);
  });

  test('requires a verified email on every route', async () => {
    const { auth } = await authed({ emailVerifiedAt: null });
    const id = crypto.randomUUID();
    const responses = await Promise.all([
      request(app()).post('/api/v1/channels/telegram-link').set('Authorization', auth),
      request(app()).get('/api/v1/channels').set('Authorization', auth),
      request(app()).get(`/api/v1/devices/${id}/channels`).set('Authorization', auth),
      request(app())
        .put(`/api/v1/devices/${id}/channels`)
        .set('Authorization', auth)
        .send({ channel_ids: [] }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(responses[0]!.body.error.code).toBe('email_not_verified');
  });
});
