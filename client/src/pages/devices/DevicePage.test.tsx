import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture, outageFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
  server.use(
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('an online device shows badge, since and signal', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(
        deviceFixture({
          state: 'ONLINE',
          state_since: '2026-11-21T16:42:00Z',
          telemetry: { rssi: -61, uptime_s: 9420, reset_reason: 'POWER_ON' },
        }),
      ),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByRole('heading', { name: /Home/ })).toBeInTheDocument();
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(screen.getByText(/since 21 Nov 18:42/)).toBeInTheDocument();
  expect(screen.getByText(/-61 dBm/)).toBeInTheDocument();
  expect(screen.getByText(/2 h 37 min/)).toBeInTheDocument();
});

test('an offline device shows the open outage start', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(
        deviceFixture({
          state: 'OFFLINE',
          open_outage: outageFixture({ started_at: '2026-11-21T16:42:00Z', ended_at: null }),
        }),
      ),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Offline since 21 Nov 18:42')).toBeInTheDocument();
});

test('an unknown device shows not found with a link back', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 }),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Device not found')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to devices' })).toHaveAttribute('href', '/devices');
});
