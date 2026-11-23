import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { server } from './server.ts';

test('requests without a handler fail instead of reaching the network', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = await fetch('http://localhost:3000/api/v1/devices').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(TypeError);
  expect(String((error as TypeError).cause)).toContain('"error" strategy');
});

test('handlers answer requests', async () => {
  server.use(http.get('http://localhost:3000/ping', () => HttpResponse.json({ ok: true })));
  const response = await fetch('http://localhost:3000/ping');
  expect(await response.json()).toEqual({ ok: true });
});
