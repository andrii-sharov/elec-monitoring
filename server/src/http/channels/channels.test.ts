import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import {
  createPlatformChannel,
  createWebhookChannel,
  linkChannel,
} from '../../../test/channels.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { addViewer } from '../../../test/sharing.ts';
import { seedDelivery } from '../../../test/deliveries.ts';
import {
  FakeClock,
  FakeTelegramClient,
  FakeWebhookSender,
  silentLogger,
} from '../../../test/fakes.ts';
import {
  appUser,
  delivery,
  deviceChannel,
  notificationChannel,
  oneTimeToken,
} from '../../db/schema/index.ts';
import { decrypt, sha256 } from '../../lib/crypto.ts';
import type { RateLimiter } from '../../rateLimit/limiter.ts';
import { signBody } from '../../webhooks/sender.ts';

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
        device_ids: [],
        failures: 0,
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
    expect(res.body.error.code).toBe('not_verified');
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
    expect(responses[0]!.body.error.code).toBe('not_verified');
  });
});

describe('channel management', () => {
  async function setup() {
    const { user, auth } = await authed();
    const channel = await createPlatformChannel(t.db, user.id, { chatId: -100777n });
    const owned = await createDevice(t.db, user.id, { name: 'Home' });
    const owner = await createUser(t.db, { email: 'jane@example.com' });
    const shared = await createDevice(t.db, owner.id, { name: 'Dacha' });
    await addViewer(t.db, shared.id, user.id);
    const stranger = await createDevice(t.db, owner.id, { name: 'Office' });
    return { user, auth, channel, owned, shared, stranger, owner };
  }

  const put = (auth: string, id: string, body: object) =>
    request(app()).put(`/api/v1/channels/${id}/devices`).set('Authorization', auth).send(body);

  test('links owned and shared devices from the channel side and lists them', async () => {
    const { auth, channel, owned, shared } = await setup();
    const res = await put(auth, channel.id, { device_ids: [owned.id, shared.id, owned.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ device_ids: [owned.id, shared.id] });
    const list = await request(app()).get('/api/v1/channels').set('Authorization', auth);
    expect(list.body.items[0].device_ids.toSorted()).toEqual([owned.id, shared.id].toSorted());
    const cleared = await put(auth, channel.id, { device_ids: [] });
    expect(cleared.body).toEqual({ device_ids: [] });
  });

  test('refuses a device the caller cannot see and a channel that is not theirs', async () => {
    const { auth, channel, owned, stranger, owner } = await setup();
    const res = await put(auth, channel.id, { device_ids: [owned.id, stranger.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'device_ids.1', code: 'not_found' }]);
    const theirs = await createPlatformChannel(t.db, owner.id);
    expect((await put(auth, theirs.id, { device_ids: [] })).status).toBe(404);
  });

  test('renames, turns off and turns on a channel', async () => {
    const { auth, channel } = await setup();
    const patch = (body: object) =>
      request(app()).patch(`/api/v1/channels/${channel.id}`).set('Authorization', auth).send(body);
    expect((await patch({ name: '  Family  ' })).body).toMatchObject({ name: 'Family' });
    expect((await patch({ enabled: false })).body).toMatchObject({
      enabled: false,
      disabled_reason: 'USER',
    });
    expect((await patch({ enabled: true })).body).toMatchObject({
      enabled: true,
      disabled_reason: null,
    });
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: '' })).status).toBe(400);
  });

  test('a channel disabled after failures turns on only through a test message', async () => {
    const { user, auth, channel } = await setup();
    await t.db
      .update(notificationChannel)
      .set({ enabled: false, disabledReason: 'TOO_MANY_FAILURES', consecutiveFailures: 20 })
      .where(eq(notificationChannel.id, channel.id));
    const patch = await request(app())
      .patch(`/api/v1/channels/${channel.id}`)
      .set('Authorization', auth)
      .send({ enabled: true });
    expect(patch.status).toBe(409);

    const telegram = new FakeTelegramClient(clock);
    telegram.script({ type: 'PERMANENT', error: 'HTTP 403: blocked' });
    const test = () =>
      request(testApp({ db: t.db, clock, telegram }))
        .post(`/api/v1/channels/${channel.id}/test`)
        .set('Authorization', auth);
    expect((await test()).status).toBe(409);
    const ok = await test();
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ enabled: true, disabled_reason: null });
    expect(telegram.sent).toEqual([
      expect.objectContaining({ chatId: -100777n, text: expect.stringContaining('✅') }),
    ]);
    const [row] = await t.db
      .select()
      .from(notificationChannel)
      .where(eq(notificationChannel.id, channel.id));
    expect(row?.consecutiveFailures).toBe(0);
    expect(user.id).toBe(row?.userId);
  });

  test('sending test messages is rate limited', async () => {
    const { auth, channel } = await setup();
    const res = await request(app(denyAll))
      .post(`/api/v1/channels/${channel.id}/test`)
      .set('Authorization', auth);
    expect(res.status).toBe(429);
  });
});

async function stored(id: string) {
  const [row] = await t.db.select().from(notificationChannel).where(eq(notificationChannel.id, id));
  return row!;
}

const storedSecret = async (id: string) =>
  decrypt(testConfig.encryptionKey, (await stored(id)).webhookSecretEnc!);

async function disableByUser(id: string, consecutiveFailures: number) {
  await t.db
    .update(notificationChannel)
    .set({ enabled: false, disabledReason: 'USER', consecutiveFailures })
    .where(eq(notificationChannel.id, id));
}

const deleteChannelRow = (id: string) =>
  t.db.delete(notificationChannel).where(eq(notificationChannel.id, id));

describe('webhook channels', () => {
  const url = 'https://hooks.example.com/elec';
  const secretPattern = /^whsec_[A-Za-z0-9_-]{43}$/;
  let webhooks: FakeWebhookSender;
  let logger: ReturnType<typeof silentLogger>;

  beforeEach(() => {
    webhooks = new FakeWebhookSender();
    webhooks.blockedHosts.add('internal.example.com');
    logger = silentLogger();
  });

  const hooked = () => request(testApp({ db: t.db, clock, webhooks, logger }));

  const body = (overrides: object = {}) => ({
    type: 'WEBHOOK',
    name: 'Home Assistant',
    url,
    events: ['device.offline', 'device.online'],
    ...overrides,
  });

  const create = (auth: string, overrides: object = {}) =>
    hooked().post('/api/v1/channels').set('Authorization', auth).send(body(overrides));

  const patch = (auth: string, id: string, changes: object) =>
    hooked().patch(`/api/v1/channels/${id}`).set('Authorization', auth).send(changes);

  const rotate = (auth: string, id: string) =>
    hooked().post(`/api/v1/channels/${id}/rotate-secret`).set('Authorization', auth);

  const sendTest = (auth: string, id: string) =>
    hooked().post(`/api/v1/channels/${id}/test`).set('Authorization', auth);

  const logged = () =>
    [logger.info, logger.warn, logger.error].flatMap((log) => vi.mocked(log).mock.calls);

  test('creates a webhook and returns the secret only once', async () => {
    const { auth } = await authed();
    const res = await create(auth, { name: '  Home Assistant  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'WEBHOOK',
      name: 'Home Assistant',
      enabled: true,
      disabled_reason: null,
      config: { url, events: ['device.offline', 'device.online'] },
      device_ids: [],
      failures: 0,
    });
    expect(res.body.secret).toMatch(secretPattern);
    expect(await storedSecret(res.body.id)).toBe(res.body.secret);

    const list = await hooked().get('/api/v1/channels').set('Authorization', auth);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty('secret');
    expect(JSON.stringify(list.body)).not.toContain('whsec_');
    expect((await patch(auth, res.body.id, { name: 'Renamed' })).body).not.toHaveProperty('secret');
    expect((await sendTest(auth, res.body.id)).body).not.toHaveProperty('secret');
    expect(logged()).toEqual([]);
  });

  test('stores the URL as it was sent', async () => {
    const { auth } = await authed();
    const input = 'https://HOOKS.example.com';
    const res = await create(auth, { url: input });
    expect(res.body.config.url).toBe(input);
    expect((await stored(res.body.id)).webhookUrl).toBe(input);
  });

  test.each([
    ['plain http', 'http://hooks.example.com/'],
    ['a private IP literal', 'https://10.0.0.1/'],
    ['a host that resolves to a private address', 'https://internal.example.com/'],
    ['credentials', 'https://john:pass@hooks.example.com/'],
    ['not a URL', 'hooks'],
  ])('refuses %s', async (_name, target) => {
    const { auth } = await authed();
    const res = await create(auth, { url: target });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('url_not_allowed');
    expect(await t.db.select().from(notificationChannel)).toEqual([]);
  });

  test.each([
    ['duplicate events', { events: ['device.offline', 'device.offline'] }],
    ['no events', { events: [] }],
    ['an unknown event', { events: ['device.exploded'] }],
    ['a blank name', { name: '  ' }],
    ['a long URL', { url: `https://hooks.example.com/${'a'.repeat(2048)}` }],
    ['another type', { type: 'TELEGRAM_PLATFORM' }],
    ['an unknown key', { secret: 'mine' }],
  ])('rejects %s', async (_name, overrides) => {
    const { auth } = await authed();
    const res = await create(auth, overrides);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  test('allows at most 10 webhooks per user', async () => {
    const { user, auth } = await authed();
    const other = await createUser(t.db, { email: 'jane@example.com' });
    await createWebhookChannel(t.db, other.id);
    await createPlatformChannel(t.db, user.id);
    for (let i = 0; i < 9; i += 1) await createWebhookChannel(t.db, user.id);
    expect((await create(auth)).status).toBe(201);
    const res = await create(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'conflict', message: 'Webhook limit reached' });
  });

  test('needs a verified account', async () => {
    const { auth } = await authed({ emailVerifiedAt: null });
    expect((await create(auth)).status).toBe(403);
    expect((await rotate(auth, crypto.randomUUID())).status).toBe(403);
    expect((await hooked().post('/api/v1/channels').send(body())).status).toBe(401);
  });

  test('edits the URL and events without re-enabling or resetting failures', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    await t.db
      .update(notificationChannel)
      .set({ enabled: false, disabledReason: 'TOO_MANY_FAILURES', consecutiveFailures: 20 })
      .where(eq(notificationChannel.id, channel.id));
    const res = await patch(auth, channel.id, {
      url: 'https://new.example.com/hook',
      events: ['device.power_blip'],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      disabled_reason: 'TOO_MANY_FAILURES',
      failures: 20,
      config: { url: 'https://new.example.com/hook', events: ['device.power_blip'] },
    });
  });

  test('checks only a changed URL on edit', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id, {
      url: 'https://internal.example.com/',
    });
    const same = await patch(auth, channel.id, {
      url: 'https://internal.example.com/',
      name: 'Renamed',
    });
    expect(same.status).toBe(200);
    const res = await patch(auth, channel.id, { url: 'https://10.0.0.1/' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('url_not_allowed');
    expect((await stored(channel.id)).webhookUrl).toBe('https://internal.example.com/');
  });

  test.each([
    ['url', { url }],
    ['events', { events: ['device.offline'] }],
  ])('does not accept %s on a Telegram channel', async (path, changes) => {
    const { user, auth } = await authed();
    const channel = await createPlatformChannel(t.db, user.id);
    const res = await patch(auth, channel.id, changes);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual([{ path, code: 'not_allowed' }]);
  });

  test('rotates the secret', async () => {
    const { auth } = await authed();
    const created = await create(auth);
    const before = await stored(created.body.id);
    const res = await rotate(auth, created.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, config: { url } });
    expect(res.body.secret).toMatch(secretPattern);
    expect(res.body.secret).not.toBe(created.body.secret);
    expect((await stored(created.body.id)).webhookSecretEnc).not.toEqual(before.webhookSecretEnc);
    expect(await storedSecret(created.body.id)).toBe(res.body.secret);
    expect(logged()).toEqual([]);
  });

  test('has no secret to rotate on a Telegram channel', async () => {
    const { user, auth } = await authed();
    const channel = await createPlatformChannel(t.db, user.id);
    const res = await rotate(auth, channel.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  test('sends a signed ping as the test', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id, { name: 'Home Assistant' });
    const res = await sendTest(auth, channel.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: channel.id, enabled: true });
    await sendTest(auth, channel.id);

    const [first, second] = webhooks.sent;
    expect(first).toMatchObject({ url, event: 'ping', secret: 'whsec_test_secret' });
    expect(JSON.parse(first!.body)).toEqual({
      event: 'ping',
      channel: { id: channel.id, name: 'Home Assistant' },
      sent_at: '2026-11-21T16:42:00.000Z',
    });
    expect(signBody(first!.secret, first!.body)).toBe(
      signBody(await storedSecret(channel.id), first!.body),
    );
    expect(first!.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second!.deliveryId).not.toBe(first!.deliveryId);
    expect(await t.db.select().from(delivery)).toEqual([]);
  });

  test('only a successful test turns a failing webhook back on', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    await t.db
      .update(notificationChannel)
      .set({ enabled: false, disabledReason: 'TOO_MANY_FAILURES', consecutiveFailures: 20 })
      .where(eq(notificationChannel.id, channel.id));
    webhooks.next.push({ type: 'FAILED', error: 'HTTP 500' });

    const failed = await sendTest(auth, channel.id);
    expect(failed.status).toBe(409);
    expect(failed.body.error).toEqual({
      code: 'conflict',
      message: 'The receiver did not accept the request (HTTP 500)',
    });
    expect(await stored(channel.id)).toMatchObject({ enabled: false, consecutiveFailures: 20 });

    const ok = await sendTest(auth, channel.id);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ enabled: true, disabled_reason: null, failures: 0 });
    expect(logged()).toEqual([]);
  });

  test('turning a disabled channel on resets its failures', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    await disableByUser(channel.id, 19);
    const res = await patch(auth, channel.id, { enabled: true });
    expect(res.body).toMatchObject({ enabled: true, disabled_reason: null, failures: 0 });
    expect(await stored(channel.id)).toMatchObject({ consecutiveFailures: 0 });
  });

  test('turning an enabled channel on keeps its failures', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    await t.db
      .update(notificationChannel)
      .set({ consecutiveFailures: 3 })
      .where(eq(notificationChannel.id, channel.id));
    const res = await patch(auth, channel.id, { enabled: true });
    expect(res.body).toMatchObject({ enabled: true, failures: 3 });
  });

  function duringCheck(change: () => Promise<unknown>) {
    const check = webhooks.check.bind(webhooks);
    vi.spyOn(webhooks, 'check').mockImplementation(async (target) => {
      await change();
      return check(target);
    });
  }

  test('does not overwrite a disable that happens during the URL check', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    duringCheck(() =>
      t.db
        .update(notificationChannel)
        .set({ enabled: false, disabledReason: 'TOO_MANY_FAILURES', consecutiveFailures: 20 })
        .where(eq(notificationChannel.id, channel.id)),
    );
    const res = await patch(auth, channel.id, {
      enabled: true,
      url: 'https://new.example.com/hook',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(await stored(channel.id)).toMatchObject({
      enabled: false,
      disabledReason: 'TOO_MANY_FAILURES',
      consecutiveFailures: 20,
      webhookUrl: url,
    });
  });

  test.each([
    ['an edit', {}],
    ['turning on', { enabled: true }],
  ])('is not found when deleted during %s', async (_name, changes) => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    duringCheck(() => deleteChannelRow(channel.id));
    const res = await patch(auth, channel.id, { ...changes, url: 'https://new.example.com/hook' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  test('is not found when deleted during a test that would turn it on', async () => {
    const { user, auth } = await authed();
    const channel = await createWebhookChannel(t.db, user.id);
    await t.db
      .update(notificationChannel)
      .set({ enabled: false, disabledReason: 'TOO_MANY_FAILURES', consecutiveFailures: 20 })
      .where(eq(notificationChannel.id, channel.id));
    vi.spyOn(webhooks, 'send').mockImplementation(async () => {
      await deleteChannelRow(channel.id);
      return { type: 'SENT', status: 200 };
    });
    const res = await sendTest(auth, channel.id);
    expect(res.status).toBe(404);
  });

  test("another user's webhook is not found", async () => {
    const { auth } = await authed();
    const other = await createUser(t.db, { email: 'jane@example.com' });
    const foreign = await createWebhookChannel(t.db, other.id);
    const responses = [
      await patch(auth, foreign.id, { url: 'https://new.example.com/' }),
      await rotate(auth, foreign.id),
      await sendTest(auth, foreign.id),
    ];
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(webhooks.sent).toEqual([]);
    expect(await stored(foreign.id)).toEqual(foreign);
  });
});
