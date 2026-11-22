import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Db } from '../db/client.ts';
import { testApp } from '../../test/app.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';

describe('GET /health', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  test('is ok when the database answers', async () => {
    const res = await request(testApp({ db: t.db })).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('is unavailable when the database fails', async () => {
    const db = {
      execute: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('connection refused')),
    };
    const res = await request(testApp({ db: db as unknown as Db })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  test('is unavailable when the database does not answer in 3 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const db = { execute: vi.fn<() => Promise<never>>(() => new Promise(() => {})) };
      const pending = request(testApp({ db: db as unknown as Db })).get('/health');
      const done = pending.then((res) => res);
      await vi.waitFor(() => expect(db.execute).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(3000);
      const res = await done;
      expect(res.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });
});
