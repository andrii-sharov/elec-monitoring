import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { rateLimitBucket } from '../db/schema/index.ts';
import { createPgRateLimiter, rateLimitKey } from './limiter.ts';

const rule = { limit: 3, windowS: 60 };
let t: TestDb;
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(rateLimitBucket);
  clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
});

test('allows the limit, then denies with the time left in the window', async () => {
  const limiter = createPgRateLimiter(t.db, clock);
  for (let i = 0; i < 3; i++) {
    expect(await limiter.hit('k', rule)).toEqual({ allowed: true, retryAfterS: 0 });
  }
  expect(await limiter.hit('k', rule)).toEqual({ allowed: false, retryAfterS: 60 });
  clock.set(new Date('2026-11-21T16:42:45Z'));
  expect(await limiter.hit('k', rule)).toEqual({ allowed: false, retryAfterS: 15 });
});

test('starts a new window when the old one ends', async () => {
  const limiter = createPgRateLimiter(t.db, clock);
  for (let i = 0; i < 4; i++) await limiter.hit('k', rule);
  clock.set(new Date('2026-11-21T16:43:00Z'));
  expect((await limiter.hit('k', rule)).allowed).toBe(true);
  const [row] = await t.db.select().from(rateLimitBucket);
  expect(row?.count).toBe(1);
  expect(row?.windowStart).toEqual(new Date('2026-11-21T16:43:00Z'));
});

test('keys do not share a count', async () => {
  const limiter = createPgRateLimiter(t.db, clock);
  for (let i = 0; i < 4; i++) await limiter.hit('a', rule);
  expect((await limiter.hit('b', rule)).allowed).toBe(true);
});

test('rateLimitKey stores a hash, never the raw value', () => {
  const key = rateLimitKey('login', 'email', 'a@b.c');
  expect(key).not.toContain('a@b.c');
  expect(key).toMatch(/^login:email:[0-9a-f]{64}$/);
  expect(rateLimitKey('login', 'email', 'a@b.c')).toBe(key);
});
