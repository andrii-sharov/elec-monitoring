import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { appUser } from '../db/schema/index.ts';
import { consumeOneTimeToken, expireOneTimeTokens, issueOneTimeToken } from './oneTimeTokens.ts';

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

test('a token works once', async () => {
  const token = await issueOneTimeToken(t.db, clock, userId, 'VERIFY_EMAIL');
  expect(await consumeOneTimeToken(t.db, clock, token, 'VERIFY_EMAIL')).toBe(userId);
  expect(await consumeOneTimeToken(t.db, clock, token, 'VERIFY_EMAIL')).toBeNull();
});

test('VERIFY_EMAIL lasts 24 hours', async () => {
  const early = await issueOneTimeToken(t.db, clock, userId, 'VERIFY_EMAIL');
  const late = await issueOneTimeToken(t.db, clock, userId, 'VERIFY_EMAIL');
  clock.advance(86_400_000 - 1000);
  expect(await consumeOneTimeToken(t.db, clock, early, 'VERIFY_EMAIL')).toBe(userId);
  clock.advance(1000);
  expect(await consumeOneTimeToken(t.db, clock, late, 'VERIFY_EMAIL')).toBeNull();
});

test('RESET_PASSWORD lasts 1 hour', async () => {
  const token = await issueOneTimeToken(t.db, clock, userId, 'RESET_PASSWORD');
  clock.advance(3_600_000);
  expect(await consumeOneTimeToken(t.db, clock, token, 'RESET_PASSWORD')).toBeNull();
});

test('a token only works for its own purpose', async () => {
  const token = await issueOneTimeToken(t.db, clock, userId, 'VERIFY_EMAIL');
  expect(await consumeOneTimeToken(t.db, clock, token, 'RESET_PASSWORD')).toBeNull();
  expect(await consumeOneTimeToken(t.db, clock, token, 'VERIFY_EMAIL')).toBe(userId);
});

test('unknown tokens are rejected', async () => {
  expect(await consumeOneTimeToken(t.db, clock, 'garbage', 'VERIFY_EMAIL')).toBeNull();
});

test('expireOneTimeTokens invalidates every unused token of that purpose', async () => {
  const a = await issueOneTimeToken(t.db, clock, userId, 'RESET_PASSWORD');
  const b = await issueOneTimeToken(t.db, clock, userId, 'RESET_PASSWORD');
  const verify = await issueOneTimeToken(t.db, clock, userId, 'VERIFY_EMAIL');
  await expireOneTimeTokens(t.db, clock, userId, 'RESET_PASSWORD');
  expect(await consumeOneTimeToken(t.db, clock, a, 'RESET_PASSWORD')).toBeNull();
  expect(await consumeOneTimeToken(t.db, clock, b, 'RESET_PASSWORD')).toBeNull();
  expect(await consumeOneTimeToken(t.db, clock, verify, 'VERIFY_EMAIL')).toBe(userId);
});
