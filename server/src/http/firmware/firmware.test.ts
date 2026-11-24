import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { silentLogger } from '../../../test/fakes.ts';
import { firmwareRelease } from '../../db/schema/index.ts';
import { versionCode } from '../../firmware/releases.ts';
import { memoryStore, type FirmwareStore } from '../../firmware/store.ts';
import type { RateLimiter, RateRule } from '../../rateLimit/limiter.ts';

const published = new Date('2026-11-01T00:00:00Z');

let t: TestDb;
let store: ReturnType<typeof memoryStore>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(firmwareRelease);
  store = memoryStore();
});

async function release(
  version: string,
  opts: { channel?: 'STABLE' | 'BETA'; publishedAt?: Date | null } = {},
) {
  await t.db.insert(firmwareRelease).values({
    version,
    versionCode: versionCode(version),
    channel: opts.channel ?? 'STABLE',
    sizeBytes: 3,
    sha256: Buffer.alloc(32),
    signature: Buffer.from([1]),
    imagePath: version,
    publishedAt: opts.publishedAt === undefined ? published : opts.publishedAt,
  });
}

function app(overrides: { firmware?: FirmwareStore; rateLimiter?: RateLimiter } = {}) {
  return testApp({ db: t.db, firmware: store, ...overrides });
}

describe('GET /api/v1/firmware/manifest.json', () => {
  test('points at the newest published stable release', async () => {
    await release('2.0.0');
    await release('2.1.0');
    await release('2.2.0', { publishedAt: null });
    await release('3.0.0', { channel: 'BETA' });
    const res = await request(app()).get('/api/v1/firmware/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      name: 'Electricity Monitor',
      version: '2.1.0',
      new_install_prompt_erase: true,
      builds: [
        {
          chipFamily: 'ESP32-C3',
          parts: [
            {
              path: `${testConfig.urls.api}/api/v1/firmware/images/2.1.0/factory.bin`,
              offset: 0,
            },
          ],
        },
      ],
    });
  });

  test('is 404 without a published release', async () => {
    await release('2.0.0', { publishedAt: null });
    const res = await request(app()).get('/api/v1/firmware/manifest.json');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  test('allows the client origin', async () => {
    await release('2.0.0');
    const res = await request(app())
      .get('/api/v1/firmware/manifest.json')
      .set('Origin', testConfig.urls.client);
    expect(res.headers['access-control-allow-origin']).toBe(testConfig.urls.client);
  });
});

describe('GET /api/v1/firmware/images/:version/factory.bin', () => {
  test('streams the stored factory image', async () => {
    await release('2.0.0');
    await store.put('2.0.0/factory.bin', new Uint8Array([1, 2, 3]));
    const res = await request(app())
      .get('/api/v1/firmware/images/2.0.0/factory.bin')
      .set('Origin', testConfig.urls.client)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-length']).toBe('3');
    expect(res.headers['cache-control']).toBe('public, max-age=86400, immutable');
    expect(res.headers['access-control-allow-origin']).toBe(testConfig.urls.client);
    expect([...(res.body as Buffer)]).toEqual([1, 2, 3]);
  });

  test('omits Content-Length when the store does not know the size', async () => {
    await release('2.0.0');
    const unsized: FirmwareStore = {
      get: async () => ({
        size: 0,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([7, 8]));
            controller.close();
          },
        }),
      }),
      put: async () => {},
    };
    const res = await request(app({ firmware: unsized }))
      .get('/api/v1/firmware/images/2.0.0/factory.bin')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBeUndefined();
    expect([...(res.body as Buffer)]).toEqual([7, 8]);
  });

  test('is 404 for a draft or unknown version', async () => {
    await release('2.1.0', { publishedAt: null });
    await store.put('2.1.0/factory.bin', new Uint8Array([1]));
    expect((await request(app()).get('/api/v1/firmware/images/2.1.0/factory.bin')).status).toBe(
      404,
    );
    expect((await request(app()).get('/api/v1/firmware/images/9.9.9/factory.bin')).status).toBe(
      404,
    );
  });

  test('never asks the store for a malformed version', async () => {
    const calls: string[] = [];
    const spy: FirmwareStore = {
      get: async (path) => {
        calls.push(path);
        return null;
      },
      put: async () => {},
    };
    for (const path of ['..%2Fx', '2.0', '0.0.0-dev', '..']) {
      const res = await request(app({ firmware: spy })).get(
        `/api/v1/firmware/images/${path}/factory.bin`,
      );
      expect([400, 404]).toContain(res.status);
    }
    expect(calls).toEqual([]);
  });

  test('is 404 and logged when the store lost the file', async () => {
    await release('2.0.0');
    const logger = silentLogger();
    const res = await request(testApp({ db: t.db, firmware: store, logger })).get(
      '/api/v1/firmware/images/2.0.0/factory.bin',
    );
    expect(res.status).toBe(404);
    expect(logger.error).toHaveBeenCalled();
  });

  test('is rate limited per IP at 20 a minute', async () => {
    const rules: RateRule[] = [];
    const deny: RateLimiter = {
      hit: (_key, rule) => {
        rules.push(rule);
        return Promise.resolve({ allowed: false, retryAfterS: 12 });
      },
    };
    const res = await request(app({ rateLimiter: deny })).get(
      '/api/v1/firmware/images/2.0.0/factory.bin',
    );
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('12');
    expect(rules).toEqual([{ limit: 20, windowS: 60 }]);
  });
});
