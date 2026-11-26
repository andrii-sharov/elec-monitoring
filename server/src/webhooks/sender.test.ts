import { once } from 'node:events';
import http from 'node:http';
import type https from 'node:https';
import type { AddressInfo, LookupFunction } from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FakeWebhookSender } from '../../test/fakes.ts';
import { createWebhookSender, signBody, type WebhookRequest } from './sender.ts';
import type { LookupAll } from './ssrf.ts';

type Received = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

const secret = 'whsec_test_secret';
const loopback = () => vi.fn<LookupAll>(async () => [{ address: '127.0.0.1', family: 4 }]);
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function receiver(respond: (res: http.ServerResponse) => void = (res) => res.end()) {
  const requests: Received[] = [];
  let connections = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const { method, url, headers } = req;
      requests.push({ method, url, headers, body: Buffer.concat(chunks).toString() });
      respond(res);
    });
  });
  server.on('connection', () => (connections += 1));
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { port, requests, connections: () => connections };
}

function webhook(port: number, overrides: Partial<WebhookRequest> = {}): WebhookRequest {
  return {
    url: `https://hook.test:${port}/hook?token=query-token`,
    secret,
    event: 'device.offline',
    deliveryId: '0190a000-0000-7000-8000-000000000003',
    body: '{"event":"device.offline","device":{"name":"Дім"}}',
    ...overrides,
  };
}

function localSender(opts: Parameters<typeof createWebhookSender>[0] = {}) {
  return createWebhookSender({
    lookup: loopback(),
    request: http.request,
    isAllowed: () => true,
    ...opts,
  });
}

async function closedPort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function capturedOptions(url: string) {
  const request = vi.fn<(options: https.RequestOptions) => never>(() => {
    throw new Error('captured');
  });
  const sender = createWebhookSender({
    lookup: async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
    request: request as unknown as typeof https.request,
  });
  const result = await sender.send(webhook(443, { url }));
  expect(result).toEqual({ type: 'FAILED', error: 'network: captured' });
  return request.mock.calls[0]![0];
}

function resolveWith(lookup: LookupFunction, all: boolean) {
  return new Promise((resolve) => {
    lookup('rebound.test', { all }, (error, address, family) => resolve([error, address, family]));
  });
}

test('signBody matches the test vector', () => {
  const body =
    '{"event":"device.offline","device":{"id":"0190a000-0000-7000-8000-000000000001","name":"Home"},"outage":{"id":"0190a000-0000-7000-8000-000000000002","type":"OUTAGE","started_at":"2026-11-21T16:42:00.000Z","ended_at":null,"duration_s":null,"cause":null,"kind":null,"ota_attempt_id":null},"sent_at":"2026-11-21T16:42:05.000Z"}';
  expect(signBody('whsec_test_secret', body)).toBe(
    'sha256=41fb456c5318b16f0baa3c41640285a49ce87998d07c8aa1c696762012939f71',
  );
});

describe('send', () => {
  test('posts the signed body with the webhook headers', async () => {
    const { port, requests } = await receiver();
    const req = webhook(port);

    expect(await localSender().send(req)).toEqual({ type: 'SENT', status: 200 });

    const [received] = requests;
    expect(received).toMatchObject({
      method: 'POST',
      url: '/hook?token=query-token',
      body: req.body,
      headers: {
        host: `hook.test:${port}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(req.body)),
        'user-agent': 'ElecMonitor-Webhook/1',
        'x-elec-event': 'device.offline',
        'x-elec-delivery': req.deliveryId,
        'x-elec-signature': signBody(secret, received!.body),
      },
    });
    expect(JSON.stringify(received)).not.toContain(secret);
  });

  test('treats any 2xx as sent', async () => {
    const { port } = await receiver((res) => res.writeHead(204).end());
    expect(await localSender().send(webhook(port))).toEqual({ type: 'SENT', status: 204 });
  });

  test.each([404, 500])('fails on %i', async (status) => {
    const { port } = await receiver((res) => res.writeHead(status).end('nope'));
    expect(await localSender().send(webhook(port))).toEqual({
      type: 'FAILED',
      error: `HTTP ${status}`,
    });
  });

  test('does not follow redirects', async () => {
    const { port, requests } = await receiver((res) =>
      res.writeHead(302, { location: '/elsewhere' }).end(),
    );
    expect(await localSender().send(webhook(port))).toEqual({
      type: 'FAILED',
      error: 'HTTP 302: redirect not followed',
    });
    expect(requests).toHaveLength(1);
  });

  test('stops reading the response after 1 KiB', async () => {
    const { port } = await receiver((res) => res.writeHead(200).write('x'.repeat(2048)));
    expect(await localSender().send(webhook(port))).toEqual({ type: 'SENT', status: 200 });
  });

  test('times out when the body stalls after the headers', async () => {
    const { port } = await receiver((res) => res.writeHead(200).flushHeaders());
    expect(await localSender({ timeoutMs: 200 }).send(webhook(port))).toEqual({
      type: 'FAILED',
      error: 'timeout',
    });
  });

  test('limits the total time, not the idle time', async () => {
    const { port } = await receiver((res) => {
      res.writeHead(200);
      const trickle = setInterval(() => res.write('x'), 20);
      res.on('close', () => clearInterval(trickle));
    });
    expect(await localSender({ timeoutMs: 200 }).send(webhook(port))).toEqual({
      type: 'FAILED',
      error: 'timeout',
    });
  });

  test('includes the DNS check in the timeout and sends nothing afterwards', async () => {
    const resolved = Promise.withResolvers<Awaited<ReturnType<LookupAll>>>();
    const request = vi.fn<() => void>();
    const sender = localSender({
      lookup: () => resolved.promise,
      request: request as unknown as typeof https.request,
      timeoutMs: 50,
    });

    expect(await sender.send(webhook(443))).toEqual({ type: 'FAILED', error: 'timeout' });
    resolved.resolve([{ address: '127.0.0.1', family: 4 }]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(request).not.toHaveBeenCalled();
  });

  test('reports a refused connection as a network error', async () => {
    const result = await localSender().send(webhook(await closedPort()));
    expect(result).toEqual({ type: 'FAILED', error: expect.stringMatching(/^network: /) });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('query-token');
  });

  test('reports a dropped response as a network error', async () => {
    const { port } = await receiver((res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('partial', () => res.destroy());
    });
    expect(await localSender().send(webhook(port))).toEqual({
      type: 'FAILED',
      error: expect.stringMatching(/^network: /),
    });
  });

  test('cuts long errors to 300 characters', async () => {
    const sender = localSender({
      request: (() => {
        throw new Error('x'.repeat(1000));
      }) as unknown as typeof https.request,
    });
    const result = await sender.send(webhook(443));
    expect(result).toMatchObject({ type: 'FAILED' });
    expect(result.type === 'FAILED' && result.error).toHaveLength(300);
  });

  test('does not throw on a header value Node rejects', async () => {
    const { port } = await receiver();
    const result = await localSender().send(webhook(port, { event: 'bad\r\nX-Injected: 1' }));
    expect(result).toEqual({ type: 'FAILED', error: expect.stringMatching(/^network: /) });
  });

  test('does not connect when the host resolves to a private address', async () => {
    const { port, connections } = await receiver();
    const sender = createWebhookSender({ lookup: loopback(), request: http.request });

    expect(await sender.send(webhook(port))).toEqual({
      type: 'FAILED',
      error: 'address not allowed',
    });
    expect(connections()).toBe(0);
  });

  test('does not connect to a private IP literal', async () => {
    const { port, connections } = await receiver();
    const sender = createWebhookSender({ request: http.request });

    expect(await sender.send(webhook(port, { url: `https://127.0.0.1:${port}/` }))).toEqual({
      type: 'FAILED',
      error: 'address not allowed',
    });
    expect(connections()).toBe(0);
  });

  test('gives up on a hanging DNS check', async () => {
    const sender = createWebhookSender({
      lookup: () => new Promise(() => {}),
      checkTimeoutMs: 20,
    });
    expect(await sender.check('https://hooks.example.com/')).toEqual({ ok: false, reason: 'dns' });
  });

  test('checks the address again on every send', async () => {
    const { port, connections } = await receiver();
    const lookup = loopback().mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }]);
    const sender = createWebhookSender({ lookup, request: http.request });

    expect(await sender.check(webhook(port).url)).toMatchObject({ ok: true });
    expect(await sender.send(webhook(port))).toEqual({
      type: 'FAILED',
      error: 'address not allowed',
    });
    expect(connections()).toBe(0);
  });

  test('connects to the checked address without resolving again or reusing sockets', async () => {
    const { port, connections } = await receiver();
    const lookup = loopback();
    const sender = localSender({ lookup });

    await sender.send(webhook(port));
    await sender.send(webhook(port));

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(connections()).toBe(2);
  });

  test('uses the pinned address with the default https request', async () => {
    const { port, connections, requests } = await receiver();
    const sender = createWebhookSender({ lookup: loopback(), isAllowed: () => true });

    expect(await sender.send(webhook(port))).toEqual({
      type: 'FAILED',
      error: expect.stringMatching(/^network: /),
    });
    expect(connections()).toBe(1);
    expect(requests).toHaveLength(0);
  });

  test('reports a failed DNS lookup', async () => {
    const sender = localSender({ lookup: () => Promise.reject(new Error('ENOTFOUND')) });
    expect(await sender.send(webhook(443))).toEqual({
      type: 'FAILED',
      error: 'DNS lookup failed',
    });
  });
});

describe('request options', () => {
  test('pins the checked addresses and verifies TLS against the hostname', async () => {
    const options = await capturedOptions('https://hooks.example.com/a?b=1');

    expect(options).toMatchObject({
      hostname: 'hooks.example.com',
      servername: 'hooks.example.com',
      port: 443,
      path: '/a?b=1',
      method: 'POST',
      agent: false,
    });
    expect(options).not.toHaveProperty('protocol');
    expect(options).not.toHaveProperty('rejectUnauthorized');
    expect(await resolveWith(options.lookup!, true)).toEqual([
      null,
      [
        { address: '93.184.215.14', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
      undefined,
    ]);
    expect(await resolveWith(options.lookup!, false)).toEqual([null, '93.184.215.14', 4]);
  });

  test.each([
    ['https://93.184.215.14:8443/', '93.184.215.14'],
    ['https://[2606:4700:4700::1111]:8443/', '2606:4700:4700::1111'],
  ])('sends no SNI for the IP literal %s', async (url, hostname) => {
    const options = await capturedOptions(url);
    expect(options).toMatchObject({ hostname, port: '8443' });
    expect(options.servername).toBeUndefined();
  });
});

describe('FakeWebhookSender', () => {
  test('records sends and returns the scripted results first', async () => {
    const fake = new FakeWebhookSender();
    fake.next.push({ type: 'FAILED', error: 'HTTP 500' });

    expect(await fake.send(webhook(443))).toEqual({ type: 'FAILED', error: 'HTTP 500' });
    expect(await fake.send(webhook(443))).toEqual({ type: 'SENT', status: 200 });
    expect(fake.sent).toHaveLength(2);
  });

  test('applies the real URL rules and the blocked hosts', async () => {
    const fake = new FakeWebhookSender();
    fake.blockedHosts.add('private.example.com');

    expect(await fake.check('https://hooks.example.com/')).toMatchObject({ ok: true });
    expect(await fake.check('http://hooks.example.com/')).toEqual({ ok: false, reason: 'scheme' });
    expect(await fake.check('https://10.0.0.1/')).toEqual({ ok: false, reason: 'address' });
    expect(await fake.check('https://private.example.com/')).toEqual({
      ok: false,
      reason: 'address',
    });
  });
});
