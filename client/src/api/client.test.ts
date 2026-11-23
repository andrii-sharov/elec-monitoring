import { deviceListSchema, meSchema, sessionSchema } from '@elec/shared/api';
import { delay, http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { meFixture, sessionFixture } from '../../test/fixtures.ts';
import { server } from '../../test/server.ts';
import { createApiClient } from './client.ts';
import { ApiError, isApiError } from './errors.ts';

const base = 'http://localhost:3000';
const oldSession = sessionFixture({ access_token: 'old-token' });
const newSession = sessionFixture({ access_token: 'new-token' });

type Sent = { path: string; auth: string | null; credentials: RequestCredentials | undefined };

function setup() {
  const onSessionLost = vi.fn<() => void>();
  const sent: Sent[] = [];
  const recordingFetch: typeof fetch = (input, init) => {
    sent.push({
      path: new URL(String(input)).pathname,
      auth: new Headers(init?.headers).get('authorization'),
      credentials: init?.credentials,
    });
    return globalThis.fetch(input, init);
  };
  const api = createApiClient({ baseUrl: base, fetch: recordingFetch, onSessionLost });
  return { api, onSessionLost, sent };
}

function unauthorized() {
  return HttpResponse.json(
    { error: { code: 'unauthorized', message: 'Unauthorized' } },
    { status: 401 },
  );
}

function conflict() {
  return HttpResponse.json({ error: { code: 'conflict', message: 'Retry once' } }, { status: 409 });
}

function refreshHandler(answers: (() => Response | Promise<Response>)[]) {
  const calls = { count: 0 };
  server.use(
    http.post(`${base}/api/auth/refresh`, () => {
      const answer = answers[Math.min(calls.count, answers.length - 1)];
      calls.count += 1;
      return answer ? answer() : unauthorized();
    }),
  );
  return calls;
}

function staggeredDevicesHandler() {
  const seen: string[] = [];
  let arrivals = 0;
  server.use(
    http.get(`${base}/api/v1/devices`, async ({ request }) => {
      const auth = request.headers.get('authorization') ?? '';
      seen.push(auth);
      if (auth === 'Bearer new-token') return HttpResponse.json({ items: [] });
      arrivals += 1;
      await delay(arrivals * 25);
      return unauthorized();
    }),
  );
  return seen;
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!isApiError(error)) throw new Error(`Expected ApiError, got ${String(error)}`);
  return error;
}

test('request sends the bearer token after setSession, without credentials', async () => {
  const seen: (string | null)[] = [];
  server.use(
    http.get(`${base}/api/v1/devices`, ({ request }) => {
      seen.push(request.headers.get('authorization'));
      return HttpResponse.json({ items: [] });
    }),
  );
  const { api, sent } = setup();
  api.setSession(oldSession);
  expect(api.hasSession()).toBe(true);

  await expect(api.request('/api/v1/devices', { schema: deviceListSchema })).resolves.toEqual({
    items: [],
  });
  expect(seen).toEqual(['Bearer old-token']);
  expect(sent).toEqual([
    { path: '/api/v1/devices', auth: 'Bearer old-token', credentials: 'omit' },
  ]);
});

test('refresh is sent with credentials and no bearer token, and stores the new token', async () => {
  const seen: (string | null)[] = [];
  server.use(
    http.post(`${base}/api/auth/refresh`, ({ request }) => {
      seen.push(request.headers.get('authorization'));
      return HttpResponse.json(newSession);
    }),
    http.get(`${base}/api/v1/me`, ({ request }) =>
      request.headers.get('authorization') === 'Bearer new-token'
        ? HttpResponse.json(meFixture())
        : unauthorized(),
    ),
  );
  const { api, sent } = setup();
  api.setSession(oldSession);

  await expect(api.refresh()).resolves.toEqual(newSession);
  expect(seen).toEqual([null]);
  expect(sent).toEqual([{ path: '/api/auth/refresh', auth: null, credentials: 'include' }]);
  await expect(api.request('/api/v1/me', { schema: meSchema })).resolves.toEqual(meFixture());
});

test('sends JSON bodies and query parameters, and skips undefined values', async () => {
  let received: { url: string; type: string | null; body: unknown } | null = null;
  server.use(
    http.patch(`${base}/api/v1/devices/d1`, async ({ request }) => {
      received = {
        url: request.url,
        type: request.headers.get('content-type'),
        body: await request.json(),
      };
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { api } = setup();

  await expect(
    api.request('/api/v1/devices/d1', {
      method: 'PATCH',
      body: { name: 'Home' },
      query: { limit: 5, cursor: undefined, type: 'OUTAGE' },
    }),
  ).resolves.toBeUndefined();
  expect(received).toEqual({
    url: `${base}/api/v1/devices/d1?limit=5&type=OUTAGE`,
    type: 'application/json',
    body: { name: 'Home' },
  });
});

test('a response that fails the schema throws invalid_response', async () => {
  server.use(http.get(`${base}/api/v1/me`, () => HttpResponse.json({ id: 1 })));
  const { api } = setup();

  const error = await rejection(api.request('/api/v1/me', { schema: meSchema }));
  expect(error).toBeInstanceOf(ApiError);
  expect(error.code).toBe('invalid_response');
});

test('a body that is not JSON throws invalid_response', async () => {
  server.use(http.get(`${base}/api/v1/me`, () => HttpResponse.text('<html>')));
  const { api } = setup();

  const error = await rejection(api.request('/api/v1/me', { schema: meSchema }));
  expect(error.code).toBe('invalid_response');
});

test('unknown response keys are stripped', async () => {
  server.use(
    http.get(`${base}/api/v1/me`, () => HttpResponse.json({ ...meFixture(), secret: 'x' })),
  );
  const { api } = setup();

  const me = await api.request('/api/v1/me', { schema: meSchema });
  expect(me).toEqual(meFixture());
  expect(me).not.toHaveProperty('secret');
});

test('error bodies become ApiError with status, code and details', async () => {
  const details = [{ path: 'settings.ping_interval_s', code: 'too_small', min: 15 }];
  server.use(
    http.patch(`${base}/api/v1/devices/d1`, () =>
      HttpResponse.json(
        { error: { code: 'validation_error', message: 'Invalid request', details } },
        { status: 400 },
      ),
    ),
  );
  const { api } = setup();

  const error = await rejection(api.request('/api/v1/devices/d1', { method: 'PATCH', body: {} }));
  expect(error).toMatchObject({
    status: 400,
    code: 'validation_error',
    details,
    retryAfterS: null,
  });
  expect(isApiError(error, 'validation_error')).toBe(true);
  expect(isApiError(error, 'not_found')).toBe(false);
});

test('a 401 triggers one refresh and the request is retried with the new token', async () => {
  const seen: (string | null)[] = [];
  server.use(
    http.get(`${base}/api/v1/devices`, ({ request }) => {
      const auth = request.headers.get('authorization');
      seen.push(auth);
      return auth === 'Bearer new-token' ? HttpResponse.json({ items: [] }) : unauthorized();
    }),
  );
  const refresh = refreshHandler([() => HttpResponse.json(newSession)]);
  const { api, onSessionLost } = setup();
  api.setSession(oldSession);

  await expect(api.request('/api/v1/devices', { schema: deviceListSchema })).resolves.toEqual({
    items: [],
  });
  expect(refresh.count).toBe(1);
  expect(seen).toEqual(['Bearer old-token', 'Bearer new-token']);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('four parallel requests that get 401 share exactly one refresh and all resolve', async () => {
  const seen = staggeredDevicesHandler();
  const refresh = refreshHandler([
    async () => {
      await delay(10);
      return HttpResponse.json(newSession);
    },
  ]);
  const { api, onSessionLost } = setup();
  api.setSession(oldSession);

  const results = await Promise.all(
    Array.from({ length: 4 }, () => api.request('/api/v1/devices', { schema: deviceListSchema })),
  );

  expect(results).toEqual(Array.from({ length: 4 }, () => ({ items: [] })));
  expect(refresh.count).toBe(1);
  expect(seen.filter((a) => a === 'Bearer old-token')).toHaveLength(4);
  expect(seen.filter((a) => a === 'Bearer new-token')).toHaveLength(4);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('four simultaneous 401s wait for the same in-flight refresh', async () => {
  const seen: (string | null)[] = [];
  server.use(
    http.get(`${base}/api/v1/devices`, ({ request }) => {
      const auth = request.headers.get('authorization');
      seen.push(auth);
      return auth === 'Bearer new-token' ? HttpResponse.json({ items: [] }) : unauthorized();
    }),
  );
  const refresh = refreshHandler([
    async () => {
      await delay(50);
      return HttpResponse.json(newSession);
    },
  ]);
  const { api, onSessionLost } = setup();
  api.setSession(oldSession);

  const results = await Promise.all(
    Array.from({ length: 4 }, () => api.request('/api/v1/devices', { schema: deviceListSchema })),
  );

  expect(results).toHaveLength(4);
  expect(refresh.count).toBe(1);
  expect(seen.filter((a) => a === 'Bearer new-token')).toHaveLength(4);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('a refresh 401 loses the session once and every request rejects with unauthorized', async () => {
  staggeredDevicesHandler();
  const refresh = refreshHandler([unauthorized]);
  const { api, onSessionLost } = setup();
  api.setSession(oldSession);

  const errors = await Promise.all(
    Array.from({ length: 4 }, () => rejection(api.request('/api/v1/devices'))),
  );

  expect(errors.map((e) => e.code)).toEqual(Array.from({ length: 4 }, () => 'unauthorized'));
  expect(refresh.count).toBe(1);
  expect(onSessionLost).toHaveBeenCalledTimes(1);
  expect(api.hasSession()).toBe(false);
});

test('a second 401 after a successful refresh loses the session', async () => {
  server.use(http.get(`${base}/api/v1/devices`, unauthorized));
  const refresh = refreshHandler([() => HttpResponse.json(newSession)]);
  const { api, onSessionLost } = setup();
  api.setSession(oldSession);

  const error = await rejection(api.request('/api/v1/devices'));
  expect(error.code).toBe('unauthorized');
  expect(refresh.count).toBe(1);
  expect(onSessionLost).toHaveBeenCalledTimes(1);
  expect(api.hasSession()).toBe(false);
});

test('a refresh 409 is retried once after 300 ms and resolves with the session', async () => {
  const refresh = refreshHandler([conflict, () => HttpResponse.json(newSession)]);
  const { api } = setup();

  const started = performance.now();
  await expect(api.refresh()).resolves.toEqual(sessionSchema.parse(newSession));
  expect(performance.now() - started).toBeGreaterThanOrEqual(290);
  expect(refresh.count).toBe(2);
  expect(api.hasSession()).toBe(true);
});

test('two refresh 409s resolve to null with no further call', async () => {
  const refresh = refreshHandler([conflict]);
  const { api, onSessionLost } = setup();

  await expect(api.refresh()).resolves.toBeNull();
  await delay(400);
  expect(refresh.count).toBe(2);
  expect(api.hasSession()).toBe(false);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('a refresh 401 resolves to null without calling onSessionLost', async () => {
  const refresh = refreshHandler([unauthorized]);
  const { api, onSessionLost } = setup();

  await expect(api.refresh()).resolves.toBeNull();
  expect(refresh.count).toBe(1);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('login answering 401 invalid_credentials does not refresh and sends no bearer', async () => {
  let auth: string | null = 'unset';
  server.use(
    http.post(`${base}/api/auth/login`, ({ request }) => {
      auth = request.headers.get('authorization');
      return HttpResponse.json(
        { error: { code: 'invalid_credentials', message: 'Invalid email or password' } },
        { status: 401 },
      );
    }),
  );
  const refresh = refreshHandler([() => HttpResponse.json(newSession)]);
  const { api, onSessionLost, sent } = setup();
  api.setSession(oldSession);

  const error = await rejection(
    api.request('/api/auth/login', {
      method: 'POST',
      body: { email: 'johnny@example.com', password: 'wrong-password' },
      schema: sessionSchema,
    }),
  );
  expect(error).toMatchObject({ status: 401, code: 'invalid_credentials' });
  expect(auth).toBeNull();
  expect(sent).toEqual([{ path: '/api/auth/login', auth: null, credentials: 'include' }]);
  expect(refresh.count).toBe(0);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('a 401 on a request sent without a token does not refresh', async () => {
  server.use(http.get(`${base}/api/v1/devices`, unauthorized));
  const refresh = refreshHandler([() => HttpResponse.json(newSession)]);
  const { api, onSessionLost } = setup();

  const error = await rejection(api.request('/api/v1/devices'));
  expect(error.code).toBe('unauthorized');
  expect(refresh.count).toBe(0);
  expect(onSessionLost).not.toHaveBeenCalled();
});

test('429 fills retryAfterS from Retry-After', async () => {
  server.use(
    http.post(`${base}/api/auth/resend-verification`, () =>
      HttpResponse.json(
        { error: { code: 'rate_limited', message: 'Too many requests' } },
        { status: 429, headers: { 'Retry-After': '30' } },
      ),
    ),
  );
  const { api } = setup();

  const error = await rejection(api.request('/api/auth/resend-verification', { method: 'POST' }));
  expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfterS: 30 });
});

test('a fetch that throws becomes a network error', async () => {
  const api = createApiClient({
    baseUrl: base,
    fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    onSessionLost: vi.fn<() => void>(),
  });

  const error = await rejection(api.request('/api/v1/devices'));
  expect(error).toMatchObject({ status: 0, code: 'network' });
});
