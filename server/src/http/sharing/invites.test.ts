import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { FakeClock, FakeEmailSender, FakeTelegramClient, linkFrom } from '../../../test/fakes.ts';
import { addViewer, seedInvite } from '../../../test/sharing.ts';
import { appUser, deviceInvite } from '../../db/schema/index.ts';
import { sha256 } from '../../lib/crypto.ts';
import type { RateLimiter } from '../../rateLimit/limiter.ts';
import type { User } from '../auth/middleware.ts';

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

let owner: User;
let ownerAuth: string;
let deviceId: string;

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  email = new FakeEmailSender();
  telegram = new FakeTelegramClient(clock);
  owner = await createUser(t.db, { email: 'john@example.com', name: 'John' });
  ownerAuth = await bearerFor(owner);
  deviceId = (await createDevice(t.db, owner.id, { name: 'Home' })).id;
});

const app = (rateLimiter?: RateLimiter) =>
  testApp({ db: t.db, clock, email, telegram, ...(rateLimiter ? { rateLimiter } : {}) });

async function bearerFor(user: User): Promise<string> {
  const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
  return `Bearer ${accessToken}`;
}

const invite = (body: object, auth = ownerAuth, rateLimiter?: RateLimiter) =>
  request(app(rateLimiter))
    .post(`/api/v1/devices/${deviceId}/invites`)
    .set('Authorization', auth)
    .send(body);

const preview = (token: string) => request(app()).get(`/api/v1/invites/${token}`);

const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;

const denyAll: RateLimiter = {
  hit: () => Promise.resolve({ allowed: false, retryAfterS: 30 }),
};

describe('POST /api/v1/devices/:id/invites', () => {
  test('creates an invite and emails a link in uk when there is no account', async () => {
    const res = await invite({ email: ' Mary@Example.com ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'mary@example.com',
      expires_at: '2026-11-28T16:42:00.000Z',
      created_at: '2026-11-21T16:42:00.000Z',
    });
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0]!;
    expect(message.to).toBe('mary@example.com');
    expect(message.subject).toBe('John надає вам доступ до Home');
    const link = linkFrom(message);
    expect(link).toMatch(/^https:\/\/app\.test\/invite\?token=[\w-]{43}$/);
    const [row] = await t.db.select().from(deviceInvite);
    expect(row?.tokenHash).toEqual(sha256(tokenFrom(link)));
    expect(row?.invitedBy).toBe(owner.id);
  });

  test('uses the language of an existing account', async () => {
    await createUser(t.db, { email: 'mary@example.com', name: 'Mary', language: 'en' });
    await invite({ email: 'mary@example.com' });
    expect(email.sent[0]?.subject).toBe('John shared Home with you');
  });

  test('a second invite replaces the first link', async () => {
    await invite({ email: 'mary@example.com' });
    clock.advance(60_000);
    const res = await invite({ email: 'mary@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.expires_at).toBe('2026-11-28T16:43:00.000Z');
    expect(await t.db.select().from(deviceInvite)).toHaveLength(1);
    const [first, second] = email.sent.map((m) => tokenFrom(linkFrom(m)));
    expect((await preview(first!)).status).toBe(410);
    expect((await preview(second!)).status).toBe(200);
  });

  test('rejects the owner email as a member', async () => {
    const res = await invite({ email: 'john@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'email', code: 'already_member' }]);
    expect(email.sent).toHaveLength(0);
  });

  test('rejects a current viewer email', async () => {
    const mary = await createUser(t.db, { email: 'mary@example.com', name: 'Mary' });
    await addViewer(t.db, deviceId, mary.id);
    const res = await invite({ email: 'MARY@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'email', code: 'already_member' }]);
  });

  test('caps viewers and unexpired invites at 10', async () => {
    for (let i = 0; i < 9; i += 1) {
      const v = await createUser(t.db, { email: `v${i}@example.com`, name: `V${i}` });
      await addViewer(t.db, deviceId, v.id);
    }
    await seedInvite(t.db, { deviceId, invitedBy: owner.id, email: 'pending@example.com' });
    await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'old@example.com',
      expiresAt: new Date('2026-11-20T00:00:00Z'),
    });
    const full = await invite({ email: 'new@example.com' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('conflict');
    expect(full.body.error.details).toBeUndefined();
    expect((await invite({ email: 'pending@example.com' })).status).toBe(201);
  });

  test('an expired invite does not count toward the cap', async () => {
    for (let i = 0; i < 9; i += 1) {
      const v = await createUser(t.db, { email: `v${i}@example.com`, name: `V${i}` });
      await addViewer(t.db, deviceId, v.id);
    }
    await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'old@example.com',
      expiresAt: new Date('2026-11-20T00:00:00Z'),
    });
    expect((await invite({ email: 'new@example.com' })).status).toBe(201);
  });

  test('needs a verified email', async () => {
    await t.db.update(appUser).set({ emailVerifiedAt: null }).where(eq(appUser.id, owner.id));
    const res = await invite({ email: 'mary@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_verified');
  });

  test('is rate limited', async () => {
    const res = await invite({ email: 'mary@example.com' }, ownerAuth, denyAll);
    expect(res.status).toBe(429);
  });

  test('rejects unknown keys and bad emails', async () => {
    expect((await invite({ email: 'mary@example.com', role: 'OWNER' })).status).toBe(400);
    expect((await invite({ email: 'not-an-email' })).status).toBe(400);
  });
});

describe('GET /api/v1/devices/:id/invites', () => {
  test('lists pending invites, expired ones included, oldest first', async () => {
    const mary = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'mary@example.com',
    });
    await t.db
      .update(deviceInvite)
      .set({ createdAt: new Date('2026-11-21T10:00:00Z') })
      .where(eq(deviceInvite.id, mary.id));
    const old = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'old@example.com',
      expiresAt: new Date('2026-11-20T00:00:00Z'),
    });
    await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'done@example.com',
      acceptedAt: new Date('2026-11-21T12:00:00Z'),
    });
    const res = await request(app())
      .get(`/api/v1/devices/${deviceId}/invites`)
      .set('Authorization', ownerAuth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([mary.id, old.id]);
    expect(res.body.items[1]).toEqual({
      id: old.id,
      email: 'old@example.com',
      phone: null,
      expires_at: '2026-11-20T00:00:00.000Z',
      created_at: '2026-11-21T16:42:00.000Z',
    });
  });
});

describe('DELETE /api/v1/devices/:id/invites/:inviteId', () => {
  test('revokes the invite and its link', async () => {
    const seeded = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'mary@example.com',
    });
    const res = await request(app())
      .delete(`/api/v1/devices/${deviceId}/invites/${seeded.id}`)
      .set('Authorization', ownerAuth);
    expect(res.status).toBe(204);
    expect((await preview(seeded.token)).status).toBe(410);
  });

  test('an invite accepted in the meantime is not found and stays accepted', async () => {
    const seeded = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'mary@example.com',
      acceptedAt: new Date('2026-11-21T16:00:00Z'),
    });
    const res = await request(app())
      .delete(`/api/v1/devices/${deviceId}/invites/${seeded.id}`)
      .set('Authorization', ownerAuth);
    expect(res.status).toBe(404);
    expect(await t.db.select().from(deviceInvite)).toHaveLength(1);
  });

  test('an invite of another device is not found', async () => {
    const other = await createDevice(t.db, owner.id, { name: 'Cottage' });
    const seeded = await seedInvite(t.db, {
      deviceId: other.id,
      invitedBy: owner.id,
      email: 'mary@example.com',
    });
    const res = await request(app())
      .delete(`/api/v1/devices/${deviceId}/invites/${seeded.id}`)
      .set('Authorization', ownerAuth);
    expect(res.status).toBe(404);
    expect(await t.db.select().from(deviceInvite)).toHaveLength(1);
  });
});

describe('GET /api/v1/invites/:token', () => {
  test('previews a pending invite without auth', async () => {
    const seeded = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'mary@example.com',
    });
    const res = await preview(seeded.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      device_name: 'Home',
      inviter_name: 'John',
      email: 'mary@example.com',
      phone: null,
      expires_at: '2026-11-28T16:42:00.000Z',
      accepted: false,
    });
  });

  test('an expired invite is gone', async () => {
    const seeded = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'mary@example.com',
    });
    clock.set(new Date('2026-11-28T16:42:01Z'));
    const res = await preview(seeded.token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('expired');
  });

  test('an unknown token is gone', async () => {
    expect((await preview('nope')).status).toBe(410);
  });

  test('an accepted invite still previews before it expires', async () => {
    const seeded = await seedInvite(t.db, {
      deviceId,
      invitedBy: owner.id,
      email: 'mary@example.com',
      acceptedAt: new Date('2026-11-21T16:00:00Z'),
    });
    const res = await preview(seeded.token);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
  });
});

describe('phone invites', () => {
  const PHONE = '+380501234567';
  const URL_SHAPE = /^https:\/\/app\.test\/invite\?token=[\w-]{43}$/;

  const mary = (overrides: Parameters<typeof createUser>[1] = {}) =>
    createUser(t.db, { phone: PHONE, name: 'Mary', language: 'en', ...overrides });

  test('returns the link and sends no email', async () => {
    const res = await invite({ phone: '050 123 45 67' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ phone: PHONE, email: null });
    expect(res.body.url).toMatch(URL_SHAPE);
    const [row] = await t.db.select().from(deviceInvite);
    expect(row?.tokenHash).toEqual(sha256(tokenFrom(res.body.url)));
    expect(email.sent).toHaveLength(0);
    expect(telegram.sent).toHaveLength(0);
  });

  test('pushes the link to a bound account, with the same response keys', async () => {
    const unbound = await invite({ phone: PHONE });
    await mary({ telegramUserId: 777n });
    const bound = await invite({ phone: PHONE });
    expect(Object.keys(bound.body).toSorted()).toEqual(Object.keys(unbound.body).toSorted());
    await vi.waitFor(() => expect(telegram.sent).toHaveLength(1));
    expect(telegram.sent[0]!.chatId).toBe(777n);
    expect(telegram.sent[0]!.text).toContain('John shared <b>Home</b> with you');
    expect(telegram.sent[0]!.text).toContain(bound.body.url);
  });

  test("rejects the owner's or a viewer's phone", async () => {
    await t.db.update(appUser).set({ phone: '+380509999999' }).where(eq(appUser.id, owner.id));
    const viewer = await mary();
    await addViewer(t.db, deviceId, viewer.id);
    for (const phone of ['+380509999999', PHONE]) {
      const res = await invite({ phone });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual([{ path: 'phone', code: 'already_member' }]);
    }
  });

  test('counts phone invites toward the member limit', async () => {
    for (let i = 0; i < 9; i += 1) {
      const v = await createUser(t.db, { email: `v${i}@example.com`, name: `V${i}` });
      await addViewer(t.db, deviceId, v.id);
    }
    await seedInvite(t.db, { deviceId, invitedBy: owner.id, phone: PHONE });
    expect((await invite({ email: 'new@example.com' })).status).toBe(409);
    expect((await invite({ phone: '+380509999999' })).status).toBe(409);
    expect((await invite({ phone: PHONE })).status).toBe(201);
  });

  test('counts email invites when inviting a phone', async () => {
    for (let i = 0; i < 9; i += 1) {
      const v = await createUser(t.db, { email: `v${i}@example.com`, name: `V${i}` });
      await addViewer(t.db, deviceId, v.id);
    }
    await seedInvite(t.db, { deviceId, invitedBy: owner.id, email: 'pending@example.com' });
    expect((await invite({ phone: PHONE })).status).toBe(409);
  });

  test('a second invite replaces the first link', async () => {
    const first = await invite({ phone: PHONE });
    const second = await invite({ phone: '0501234567' });
    expect(await t.db.select().from(deviceInvite)).toHaveLength(1);
    expect((await preview(tokenFrom(first.body.url))).status).toBe(410);
    const res = await preview(tokenFrom(second.body.url));
    expect(res.body).toMatchObject({ phone: PHONE, email: null, device_name: 'Home' });
  });

  test('lists phone invites without a link', async () => {
    await invite({ phone: PHONE });
    const res = await request(app())
      .get(`/api/v1/devices/${deviceId}/invites`)
      .set('Authorization', ownerAuth);
    expect(res.body.items).toMatchObject([{ phone: PHONE, email: null }]);
    expect(res.body.items[0]).not.toHaveProperty('url');
  });
});
