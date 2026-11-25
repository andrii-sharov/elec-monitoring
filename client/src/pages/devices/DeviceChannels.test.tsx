import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { channelFixture, deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';
const home = channelFixture();
const office = channelFixture({ id: '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d02', name: 'Office' });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(deviceFixture({ role: 'VIEWER' })),
    ),
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`${base}/api/v1/devices/${id}/members`, () => HttpResponse.json({ items: [] })),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('preselects the linked channel and saves the added one', async () => {
  const body = vi.fn<(value: unknown) => void>();
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [home, office] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () =>
      HttpResponse.json({ channel_ids: [home.id] }),
    ),
    http.put(`${base}/api/v1/devices/${id}/channels`, async ({ request }) => {
      const value = (await request.json()) as { channel_ids: string[] };
      body(value);
      return HttpResponse.json(value);
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  const homeBox = await screen.findByRole('checkbox', { name: 'Home chat' });
  const officeBox = screen.getByRole('checkbox', { name: 'Office' });
  await vi.waitFor(() => expect(homeBox).toBeChecked());
  expect(officeBox).not.toBeChecked();
  await user.click(officeBox);
  await user.click(screen.getByRole('button', { name: 'Save channels' }));
  expect(await screen.findByText('Channels saved')).toBeInTheDocument();
  expect(body).toHaveBeenCalledWith({ channel_ids: [home.id, office.id] });
});

test('without channels it links to the notifications page', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () => HttpResponse.json({ channel_ids: [] })),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  const link = await screen.findByRole('link', { name: 'Connect a channel' });
  expect(link).toHaveAttribute('href', '/notifications');
});

test('a failed save shows the error', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [home] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () => HttpResponse.json({ channel_ids: [] })),
    http.put(`${base}/api/v1/devices/${id}/channels`, () =>
      HttpResponse.json({ error: { code: 'forbidden', message: 'x' } }, { status: 403 }),
    ),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await user.click(await screen.findByRole('checkbox', { name: 'Home chat' }));
  await user.click(screen.getByRole('button', { name: 'Save channels' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
});
