import request from 'supertest';
import { expect, test } from 'vitest';
import { testApp, testConfig } from '../../test/app.ts';
import { requireAppOrigin } from './cors.ts';

test('preflight from the client app allows credentials', async () => {
  const res = await request(testApp())
    .options('/api/auth/refresh')
    .set('Origin', 'https://app.test')
    .set('Access-Control-Request-Method', 'POST');
  expect(res.status).toBe(204);
  expect(res.headers['access-control-allow-origin']).toBe('https://app.test');
  expect(res.headers['access-control-allow-credentials']).toBe('true');
});

test('actual requests from the client app expose Retry-After', async () => {
  const res = await request(testApp()).get('/health').set('Origin', 'https://app.test');
  expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
});

test('preflight from another origin gets no CORS headers', async () => {
  const res = await request(testApp())
    .options('/api/auth/refresh')
    .set('Origin', 'https://evil.test')
    .set('Access-Control-Request-Method', 'POST');
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
});

const guarded = testApp({
  routes: (app) => {
    app.post('/test/origin', requireAppOrigin(testConfig.urls), (_req, res) => {
      res.status(204).end();
    });
  },
});

test('requireAppOrigin accepts the client and admin origins', async () => {
  expect(
    (await request(guarded).post('/test/origin').set('Origin', 'https://admin.test')).status,
  ).toBe(204);
  expect(
    (await request(guarded).post('/test/origin').set('Origin', 'https://app.test')).status,
  ).toBe(204);
});

test.each([['https://evil.test'], ['https://app.test.evil.test'], [undefined]])(
  'requireAppOrigin rejects %s',
  async (origin) => {
    const req = request(guarded).post('/test/origin');
    const res = await (origin ? req.set('Origin', origin) : req);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  },
);

function ipApp(trustProxyHops: number) {
  return testApp({
    config: { ...testConfig, trustProxyHops },
    routes: (app) => {
      app.get('/test/ip', (req, res) => {
        res.json({ ip: req.ip });
      });
    },
  });
}

test('trusts X-Forwarded-For only when proxy hops are configured', async () => {
  const trusted = await request(ipApp(1)).get('/test/ip').set('X-Forwarded-For', '203.0.113.7');
  expect(trusted.body.ip).toBe('203.0.113.7');
  const untrusted = await request(ipApp(0)).get('/test/ip').set('X-Forwarded-For', '203.0.113.7');
  expect(untrusted.body.ip).not.toBe('203.0.113.7');
});
