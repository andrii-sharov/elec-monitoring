import { screen, within } from '@testing-library/react';
import { act } from 'react';
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

test('an online device shows badge, since and signal', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(
        deviceFixture({
          state: 'ONLINE',
          state_since: '2026-11-21T16:42:00Z',
          last_seen_at: '2026-11-21T18:41:30Z',
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

test('last seen and uptime tick every second while online', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(
        deviceFixture({
          state: 'ONLINE',
          last_seen_at: '2026-11-21T18:41:50Z',
          telemetry: { rssi: -61, uptime_s: 30, reset_reason: 'POWER_ON' },
        }),
      ),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Last seen 21 Nov 20:41 · 10 s')).toBeInTheDocument();
  expect(screen.getByText('Uptime 40 s')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('Last seen 21 Nov 20:41 · 11 s')).toBeInTheDocument();
  expect(screen.getByText('Uptime 41 s')).toBeInTheDocument();
});

test('an offline device keeps the last reported uptime', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(
        deviceFixture({
          state: 'OFFLINE',
          last_seen_at: '2026-11-21T18:30:00Z',
          telemetry: { rssi: -61, uptime_s: 100, reset_reason: 'POWER_ON' },
        }),
      ),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('Uptime 1 min')).toBeInTheDocument();
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

test('a failed background poll keeps the page and unsaved settings', async () => {
  let calls = 0;
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () => {
      calls += 1;
      if (calls > 1) {
        return HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 });
      }
      return HttpResponse.json(deviceFixture({ name: 'Home' }));
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByRole('heading', { name: /Home/ });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const name = await screen.findByLabelText('Name');
  await user.type(name, ' edited');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(calls).toBeGreaterThan(1);
  expect(screen.getByRole('heading', { name: /Home/, hidden: true })).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveValue('Home edited');
});

test('has a link back to the devices list', async () => {
  server.use(http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture())));
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByRole('link', { name: 'Back to devices' })).toHaveAttribute(
    'href',
    '/devices',
  );
});

test('a pending device shows setup at the top with a new pairing code', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(deviceFixture({ state: 'PENDING', last_seen_at: null })),
    ),
    http.post(`${base}/api/v1/devices/${id}/pairing-code`, () =>
      HttpResponse.json(
        { pairing_code: 'K7Q2M9XD', pairing_code_expires_at: '2026-11-21T19:12:00Z' },
        { status: 201 },
      ),
    ),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  const setup = await screen.findByRole('region', { name: 'Finish setting up' });
  const sections = screen.getByRole('tablist', { name: 'Device sections' });
  expect(setup.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(setup).getByRole('button', { name: 'Flash firmware' })).toBeInTheDocument();
  await user.click(within(setup).getByRole('button', { name: 'Get pairing code' }));
  expect(await within(setup).findByText('K7Q2 M9XD')).toBeInTheDocument();
});

test('a viewer of a pending device sees no setup', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(deviceFixture({ state: 'PENDING', role: 'VIEWER', last_seen_at: null })),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByRole('tablist', { name: 'Device sections' });
  expect(screen.queryByRole('region', { name: 'Finish setting up' })).toBeNull();
});

test('an online device shows no setup', async () => {
  server.use(http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture())));
  renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByRole('tablist', { name: 'Device sections' });
  expect(screen.queryByRole('region', { name: 'Finish setting up' })).toBeNull();
});

test('tabs switch sections and keep the choice in the URL', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture())),
    http.get(`${base}/api/v1/devices/${id}/members`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/devices/${id}/invites`, () => HttpResponse.json({ items: [] })),
  );
  const { user, router } = renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByRole('tab', { name: 'History' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.click(screen.getByRole('tab', { name: 'Members' }));
  expect(await screen.findByRole('region', { name: 'Members' })).toBeInTheDocument();
  expect(router.state.location.search).toBe('?tab=members');
  expect(screen.queryByRole('navigation', { name: 'Days of the week' })).toBeNull();
});

test('an offline device counts from its last check-in, like its open outage', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(
        deviceFixture({
          state: 'OFFLINE',
          state_since: '2026-11-21T16:42:00Z',
          last_seen_at: '2026-11-21T16:40:00Z',
          open_outage: outageFixture({
            started_at: '2026-11-21T16:40:00Z',
            ended_at: null,
            duration_s: null,
            cause: null,
            kind: null,
          }),
        }),
      ),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText(/since 21 Nov 18:40 · 2 h 2 min/)).toBeInTheDocument();
});
