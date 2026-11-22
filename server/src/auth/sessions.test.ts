import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { appUser, refreshToken, session } from '../db/schema/index.ts';
import { sha256 } from '../lib/crypto.ts';
import {
  REFRESH_TTL_S,
  createSession,
  findActiveSession,
  revokeSessionByToken,
  revokeUserSessions,
  rotateRefreshToken,
} from './sessions.ts';

const DAY_MS = 86_400_000;
let t: TestDb;
let clock: FakeClock;
let userId: string;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const [user] = await t.db
    .insert(appUser)
    .values({ email: 'john@example.com', name: 'John', passwordHash: 'x' })
    .returning();
  userId = user!.id;
});

test('createSession stores only the hash of the refresh token', async () => {
  const { sessionId, refreshToken: token } = await createSession(t.db, clock, userId);
  const [row] = await t.db.select().from(refreshToken);
  expect(row?.sessionId).toBe(sessionId);
  expect(row?.tokenHash.equals(sha256(token))).toBe(true);
  expect(row?.expiresAt).toEqual(new Date(clock.now().getTime() + REFRESH_TTL_S * 1000));
  expect(row?.tokenHash.toString('utf8')).not.toContain(token);
});

test('rotate returns a new token on the same session', async () => {
  const first = await createSession(t.db, clock, userId);
  clock.advance(60_000);
  const result = await rotateRefreshToken(t.db, clock, first.refreshToken);
  expect(result).toMatchObject({ ok: true, userId, sessionId: first.sessionId });
  if (!result.ok) throw new Error('expected ok');
  expect(result.refreshToken).not.toBe(first.refreshToken);

  const old = await t.db
    .select()
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, sha256(first.refreshToken)));
  expect(old[0]?.usedAt).toEqual(clock.now());
  const next = await t.db
    .select()
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, sha256(result.refreshToken)));
  expect(next[0]?.expiresAt).toEqual(new Date(clock.now().getTime() + REFRESH_TTL_S * 1000));
  const [row] = await t.db.select().from(session);
  expect(row?.lastUsedAt).toEqual(clock.now());
});

test('reusing a token within 10 s is racing and keeps the session alive', async () => {
  const first = await createSession(t.db, clock, userId);
  const rotated = await rotateRefreshToken(t.db, clock, first.refreshToken);
  if (!rotated.ok) throw new Error('expected ok');
  clock.advance(10_000);
  expect(await rotateRefreshToken(t.db, clock, first.refreshToken)).toEqual({
    ok: false,
    reason: 'racing',
  });
  const [row] = await t.db.select().from(session);
  expect(row?.revokedAt).toBeNull();
  expect((await rotateRefreshToken(t.db, clock, rotated.refreshToken)).ok).toBe(true);
});

test('reusing a token after 10 s revokes the session', async () => {
  const first = await createSession(t.db, clock, userId);
  const rotated = await rotateRefreshToken(t.db, clock, first.refreshToken);
  if (!rotated.ok) throw new Error('expected ok');
  clock.advance(11_000);
  expect(await rotateRefreshToken(t.db, clock, first.refreshToken)).toEqual({
    ok: false,
    reason: 'reused',
  });
  const [row] = await t.db.select().from(session);
  expect(row?.revokedAt).toEqual(clock.now());
  expect(await rotateRefreshToken(t.db, clock, rotated.refreshToken)).toEqual({
    ok: false,
    reason: 'revoked',
  });
});

test('unknown and expired tokens are rejected', async () => {
  expect(await rotateRefreshToken(t.db, clock, 'nope')).toEqual({ ok: false, reason: 'unknown' });
  const first = await createSession(t.db, clock, userId);
  clock.advance(30 * DAY_MS);
  expect(await rotateRefreshToken(t.db, clock, first.refreshToken)).toEqual({
    ok: false,
    reason: 'expired',
  });
});

test('a revoked session cannot rotate', async () => {
  const first = await createSession(t.db, clock, userId);
  await revokeUserSessions(t.db, clock, userId);
  expect(await rotateRefreshToken(t.db, clock, first.refreshToken)).toEqual({
    ok: false,
    reason: 'revoked',
  });
});

test('findActiveSession accepts only the newest live token', async () => {
  const first = await createSession(t.db, clock, userId);
  expect(await findActiveSession(t.db, clock, first.refreshToken)).toEqual({
    userId,
    sessionId: first.sessionId,
  });
  const rotated = await rotateRefreshToken(t.db, clock, first.refreshToken);
  if (!rotated.ok) throw new Error('expected ok');
  expect(await findActiveSession(t.db, clock, first.refreshToken)).toBeNull();
  expect(await findActiveSession(t.db, clock, rotated.refreshToken)).not.toBeNull();
  clock.advance(30 * DAY_MS);
  expect(await findActiveSession(t.db, clock, rotated.refreshToken)).toBeNull();
});

test('findActiveSession rejects a revoked session', async () => {
  const first = await createSession(t.db, clock, userId);
  await revokeSessionByToken(t.db, clock, first.refreshToken);
  expect(await findActiveSession(t.db, clock, first.refreshToken)).toBeNull();
});

test('revokeUserSessions spares the excepted session', async () => {
  const a = await createSession(t.db, clock, userId);
  const b = await createSession(t.db, clock, userId);
  await revokeUserSessions(t.db, clock, userId, a.sessionId);
  expect(await findActiveSession(t.db, clock, a.refreshToken)).not.toBeNull();
  expect(await findActiveSession(t.db, clock, b.refreshToken)).toBeNull();
});

test('revokeSessionByToken works with an already used token', async () => {
  const first = await createSession(t.db, clock, userId);
  const rotated = await rotateRefreshToken(t.db, clock, first.refreshToken);
  if (!rotated.ok) throw new Error('expected ok');
  await revokeSessionByToken(t.db, clock, first.refreshToken);
  expect(await findActiveSession(t.db, clock, rotated.refreshToken)).toBeNull();
});
