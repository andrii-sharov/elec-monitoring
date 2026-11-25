import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
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

function serveDevice(overrides = {}) {
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture(overrides))),
  );
}

function capturePatch(response: () => Response = () => HttpResponse.json(deviceFixture())) {
  const bodies: unknown[] = [];
  server.use(
    http.patch(`${base}/api/v1/devices/${id}`, async ({ request }) => {
      bodies.push(await request.json());
      return response();
    }),
  );
  return bodies;
}

async function renderOwner() {
  const view = renderRoute(`/devices/${id}`, { me: meFixture() });
  await view.user.click(await screen.findByRole('button', { name: 'Settings' }));
  await screen.findByLabelText('Ping interval (s)');
  return view;
}

test('offline timeout below twice the ping interval is blocked before any request', async () => {
  serveDevice();
  const bodies = capturePatch();
  const { user } = await renderOwner();
  await user.clear(screen.getByLabelText('Ping interval (s)'));
  await user.type(screen.getByLabelText('Ping interval (s)'), '60');
  await user.clear(screen.getByLabelText('Offline timeout (s)'));
  await user.type(screen.getByLabelText('Offline timeout (s)'), '100');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('At least 120')).toBeInTheDocument();
  expect(bodies).toEqual([]);
});

test('a server detail on the threshold lands on that field and an unknown path is a form error', async () => {
  serveDevice();
  capturePatch(() =>
    HttpResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'x',
          details: [
            { path: 'settings.short_outage_threshold_s', code: 'too_big', max: 86400 },
            { path: 'settings.unknown', code: 'invalid' },
          ],
        },
      },
      { status: 400 },
    ),
  );
  const { user } = await renderOwner();
  await user.clear(screen.getByLabelText('Short outage threshold (min)'));
  await user.type(screen.getByLabelText('Short outage threshold (min)'), '5');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('At most 1440')).toBeInTheDocument();
  expect(await screen.findByText('Check the highlighted fields.')).toBeInTheDocument();
});

test('a detail with an unknown path alone shows a form-level error', async () => {
  serveDevice();
  capturePatch(() =>
    HttpResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'x',
          details: [{ path: 'settings.unknown', code: 'invalid' }],
        },
      },
      { status: 400 },
    ),
  );
  const { user } = await renderOwner();
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'Cabin');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Check the highlighted fields.')).toBeInTheDocument();
});

test('changing only the threshold sends only the threshold in seconds', async () => {
  serveDevice();
  const bodies = capturePatch(() =>
    HttpResponse.json(
      deviceFixture({
        settings: { ...deviceFixture().settings, short_outage_threshold_s: 300 },
      }),
    ),
  );
  const { user } = await renderOwner();
  await user.clear(screen.getByLabelText('Short outage threshold (min)'));
  await user.type(screen.getByLabelText('Short outage threshold (min)'), '5');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies).toEqual([{ settings: { short_outage_threshold_s: 300 } }]));
});

test('quiet hours with the same start and end show an error and send nothing', async () => {
  serveDevice({ settings: { ...deviceFixture().settings, quiet_hours: null } });
  const bodies = capturePatch();
  const { user } = await renderOwner();
  await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
  fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '23:00' } });
  fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '23:00' } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Start and end must differ')).toBeInTheDocument();
  expect(bodies).toEqual([]);
});

test('turning quiet hours off sends null', async () => {
  serveDevice();
  const bodies = capturePatch();
  const { user } = await renderOwner();
  await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies).toEqual([{ settings: { quiet_hours: null } }]));
});

test('pending settings sync shows the waiting hint', async () => {
  serveDevice({ settings_sync: { desired_version: 4, applied_version: 3, pending: true } });
  await renderOwner();
  expect(screen.getByText('Waiting for the device to apply')).toHaveClass('text-warning');
});

test('a viewer sees neither the settings form nor the danger zone', async () => {
  serveDevice({ role: 'VIEWER' });
  renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByRole('heading', { name: /Home/ });
  expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Ping interval (s)')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete device' })).not.toBeInTheDocument();
});
