import { screen, within } from '@testing-library/react';
import { act } from 'react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function devicesHandler(items: unknown[]) {
  server.use(http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items })));
}

test('lists devices with translated state and since', async () => {
  devicesHandler([
    deviceFixture({
      id: 'a',
      name: 'Home',
      state: 'ONLINE',
      state_since: '2026-11-21T16:42:00Z',
    }),
    deviceFixture({ id: 'b', name: 'Cabin', state: 'OFFLINE', last_seen_at: null }),
  ]);
  renderRoute('/devices', { me: meFixture() });
  const home = (await screen.findByRole('link', { name: /Home/ })).closest('a') as HTMLElement;
  expect(home).toHaveAttribute('href', '/devices/a');
  expect(within(home).getByText('Online')).toBeInTheDocument();
  expect(within(home).getByText(/since 21 Nov 18:42/)).toBeInTheDocument();
  const cabin = screen.getByRole('link', { name: /Cabin/ });
  expect(within(cabin).getByText('Offline')).toBeInTheDocument();
});

test('a pending device shows Never as last seen', async () => {
  devicesHandler([deviceFixture({ name: 'New', state: 'PENDING', last_seen_at: null })]);
  renderRoute('/devices', { me: meFixture() });
  const card = await screen.findByRole('link', { name: /New/ });
  expect(within(card).getByText('Pending')).toBeInTheDocument();
  expect(within(card).getByText(/Never/)).toBeInTheDocument();
});

test('a viewer device shows Shared', async () => {
  devicesHandler([
    deviceFixture({ name: 'Mine' }),
    deviceFixture({ id: 'v', name: 'Theirs', role: 'VIEWER' }),
  ]);
  renderRoute('/devices', { me: meFixture() });
  const theirs = await screen.findByRole('link', { name: /Theirs/ });
  expect(within(theirs).getByText('Shared')).toBeInTheDocument();
  expect(within(screen.getByRole('link', { name: /Mine/ })).queryByText('Shared')).toBeNull();
});

test('an empty list shows the empty state', async () => {
  devicesHandler([]);
  renderRoute('/devices', { me: meFixture() });
  expect(await screen.findByText('No devices yet')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Add device' })[0]).toBeEnabled();
});

test('the list refetches after 30 seconds', async () => {
  let calls = 0;
  server.use(
    http.get(`${base}/api/v1/devices`, () => {
      calls += 1;
      return HttpResponse.json({
        items: [deviceFixture({ name: 'Home', state: calls === 1 ? 'ONLINE' : 'OFFLINE' })],
      });
    }),
  );
  renderRoute('/devices', { me: meFixture() });
  expect(await screen.findByText('Online')).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(await screen.findByText('Offline')).toBeInTheDocument();
});

test('the UI follows the account language', async () => {
  devicesHandler([]);
  renderRoute('/devices', { me: meFixture({ language: 'uk' }) });
  expect(await screen.findByRole('heading', { name: 'Пристрої' })).toBeInTheDocument();
});

test('a failed background poll keeps the list', async () => {
  let calls = 0;
  server.use(
    http.get(`${base}/api/v1/devices`, () => {
      calls += 1;
      if (calls > 1) {
        return HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 });
      }
      return HttpResponse.json({ items: [deviceFixture({ name: 'Home' })] });
    }),
  );
  renderRoute('/devices', { me: meFixture() });
  await screen.findByRole('link', { name: /Home/ });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(calls).toBeGreaterThan(1);
  expect(screen.getByRole('link', { name: /Home/ })).toBeInTheDocument();
});

test('links to the flash firmware page', async () => {
  devicesHandler([]);
  renderRoute('/devices', { me: meFixture() });
  expect(await screen.findByRole('link', { name: 'Flash firmware' })).toHaveAttribute(
    'href',
    '/flash',
  );
});
