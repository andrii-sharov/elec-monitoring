import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { testApp } from '../../test/app.ts';
import { rateLimitBucket } from '../db/schema/index.ts';
import { createPgRateLimiter } from '../rateLimit/limiter.ts';
import { rateLimit } from './rateLimit.ts';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(rateLimitBucket);
});

function appWith(rules: Parameters<typeof rateLimit>[2]) {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const limiter = createPgRateLimiter(t.db, clock);
  return testApp({
    routes: (app) => {
      app.post('/test', rateLimit(limiter, 'test', rules), (_req, res) => {
        res.status(204).end();
      });
    },
  });
}

test('answers 429 with Retry-After once the email rule is exceeded', async () => {
  const app = appWith({ ip: { limit: 5, windowS: 60 }, email: { limit: 1, windowS: 60 } });
  expect((await request(app).post('/test').send({ email: 'a@b.c' })).status).toBe(204);
  const res = await request(app).post('/test').send({ email: 'a@b.c' }).expect(429);
  expect(res.body.error.code).toBe('rate_limited');
  expect(res.headers['retry-after']).toMatch(/^\d+$/);
});

test('Retry-After is the larger value when two rules deny', async () => {
  const app = appWith({ ip: { limit: 1, windowS: 60 }, email: { limit: 1, windowS: 600 } });
  expect((await request(app).post('/test').send({ email: 'a@b.c' })).status).toBe(204);
  const res = await request(app).post('/test').send({ email: 'a@b.c' }).expect(429);
  expect(res.headers['retry-after']).toBe('480');
});

test('a request counts in every bucket, even one that is denied by another', async () => {
  const app = appWith({ ip: { limit: 2, windowS: 60 }, email: { limit: 1, windowS: 60 } });
  expect((await request(app).post('/test').send({ email: 'a@b.c' })).status).toBe(204);
  expect((await request(app).post('/test').send({ email: 'a@b.c' })).status).toBe(429);
  expect((await request(app).post('/test').send({ email: 'other@b.c' })).status).toBe(429);
});

test('normalizes the email before counting', async () => {
  const app = appWith({ email: { limit: 1, windowS: 60 } });
  expect((await request(app).post('/test').send({ email: ' A@B.C ' })).status).toBe(204);
  expect((await request(app).post('/test').send({ email: 'a@b.c' })).status).toBe(429);
});

test('counts every format of a phone as one number', async () => {
  const app = appWith({ phone: { limit: 1, windowS: 60 } });
  expect((await request(app).post('/test').send({ phone: '050 123 45 67' })).status).toBe(204);
  expect((await request(app).post('/test').send({ phone: '+380501234567' })).status).toBe(429);
});

test('without an email field only the IP rule applies', async () => {
  const app = appWith({ ip: { limit: 2, windowS: 60 }, email: { limit: 1, windowS: 60 } });
  expect((await request(app).post('/test').send({})).status).toBe(204);
  expect((await request(app).post('/test').send({})).status).toBe(204);
  expect((await request(app).post('/test').send({})).status).toBe(429);
});

test('a device rule counts per authenticated device', async () => {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
  const limiter = createPgRateLimiter(t.db, clock);
  const app = testApp({
    routes: (a) => {
      a.post(
        '/device-test',
        (req, res, next) => {
          res.locals.device = { deviceId: req.get('X-Device') ?? '', tokenHash: Buffer.alloc(32) };
          next();
        },
        rateLimit(limiter, 'checkin', { device: { limit: 1, windowS: 60 } }),
        (_req, res) => {
          res.status(204).end();
        },
      );
    },
  });
  expect((await request(app).post('/device-test').set('X-Device', 'd1')).status).toBe(204);
  expect((await request(app).post('/device-test').set('X-Device', 'd1')).status).toBe(429);
  expect((await request(app).post('/device-test').set('X-Device', 'd2')).status).toBe(204);
  const keys = (await t.db.select().from(rateLimitBucket)).map((b) => b.key);
  expect(keys).toContain(`checkin:device:${createHash('sha256').update('d1').digest('hex')}`);
});
