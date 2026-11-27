import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';

function serveDevice(overrides: Parameters<typeof deviceFixture>[0] = {}) {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture(overrides))),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () => HttpResponse.json({ channel_ids: [] })),
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('the owner pauses network alerts for router work', async () => {
  serveDevice();
  const bodies: unknown[] = [];
  server.use(
    http.put(`${base}/api/v1/devices/${id}/network-pause`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ until: '2026-11-21T18:57:00.000Z' });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Router work' }));
  expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
    '10 min',
    '15 min',
    '30 min',
    '1 h',
  ]);
  await user.click(screen.getByRole('menuitem', { name: '15 min' }));
  await vi.waitFor(() => expect(bodies).toEqual([{ minutes: 15 }]));
});

test('while paused the owner sees until when and can cancel', async () => {
  serveDevice({ network_pause_until: '2026-11-21T18:57:00Z' });
  let cancelled = false;
  server.use(
    http.delete(`${base}/api/v1/devices/${id}/network-pause`, () => {
      cancelled = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Network alerts paused until 20:57')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Resume alerts' }));
  await vi.waitFor(() => expect(cancelled).toBe(true));
});

test('a pause that already ended is not shown', async () => {
  serveDevice({ network_pause_until: '2026-11-21T18:00:00Z' });
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByRole('button', { name: 'Router work' })).toBeInTheDocument();
  expect(screen.queryByText(/Network alerts paused/)).toBeNull();
});

test('a viewer sees the pause but has no controls', async () => {
  serveDevice({ role: 'VIEWER', network_pause_until: '2026-11-21T18:57:00Z' });
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Network alerts paused until 20:57')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume alerts' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Router work' })).toBeNull();
});

test('the banner goes away when the pause ends', async () => {
  serveDevice({ network_pause_until: '2026-11-21T18:43:00Z' });
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Network alerts paused until 20:43')).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(61_000);
  expect(screen.queryByText(/Network alerts paused/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Router work' })).toBeInTheDocument();
});
