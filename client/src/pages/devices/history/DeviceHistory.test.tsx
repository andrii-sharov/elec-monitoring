import { screen, within } from '@testing-library/react';
import { act } from 'react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture, outageFixture } from '../../../../test/fixtures.ts';
import { renderRoute } from '../../../../test/render.tsx';
import { server } from '../../../../test/server.ts';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';
const outagesUrl = `${base}/api/v1/devices/${id}/outages`;

type Request = { from: string | null; to: string | null; cursor: string | null };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T21:00:00Z'));
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () => HttpResponse.json({ channel_ids: [] })),
    http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture())),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function serveOutages(items: ReturnType<typeof outageFixture>[]) {
  const requests: Request[] = [];
  server.use(
    http.get(outagesUrl, ({ request }) => {
      const url = new URL(request.url);
      requests.push({
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        cursor: url.searchParams.get('cursor'),
      });
      return HttpResponse.json({ items, next_cursor: null });
    }),
  );
  return requests;
}

test('loads the current local week and shows an empty state', async () => {
  const requests = serveOutages([]);
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('No outages this week')).toBeInTheDocument();
  expect(screen.getByText('16 – 22 Nov 2026')).toBeInTheDocument();
  expect(requests[0]).toMatchObject({
    from: '2026-11-15T22:00:00.000Z',
    to: '2026-11-22T22:00:00.000Z',
  });
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
});

test('the timeline groups outages by day with range, duration, cause and kind', async () => {
  serveOutages([outageFixture()]);
  renderRoute(`/devices/${id}`, { me: meFixture() });
  const day = await screen.findByRole('region', { name: 'Saturday 21 November' });
  const item = within(day).getByText('Power outage').closest('li') as HTMLElement;
  expect(within(item).getByText(/18:42 → 20:57/)).toBeInTheDocument();
  expect(within(item).getByText('2 h 15 min')).toBeInTheDocument();
  expect(within(item).getByText('Long')).toBeInTheDocument();
  expect(screen.getByText('Outages 1 · without power 2 h 15 min')).toBeInTheDocument();
  const days = screen.getByRole('navigation', { name: 'Days of the week' });
  expect(
    within(days)
      .getAllByRole('button')
      .filter((b) => !b.hasAttribute('disabled')),
  ).toHaveLength(1);
});

test('an open outage is ongoing with a live duration', async () => {
  serveOutages([
    outageFixture({
      id: 'open',
      started_at: '2026-11-21T20:59:30Z',
      ended_at: null,
      duration_s: null,
      cause: null,
      kind: null,
    }),
  ]);
  renderRoute(`/devices/${id}`, { me: meFixture() });
  const item = (await screen.findByText(/Ongoing since/)).closest('li') as HTMLElement;
  expect(within(item).getByText('30 s')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(within(item).getByText('31 s')).toBeInTheDocument();
});

test('week navigation moves the range and keeps it in the URL', async () => {
  const requests = serveOutages([]);
  const { user, router } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByText('No outages this week');
  await user.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(await screen.findByText('9 – 15 Nov 2026')).toBeInTheDocument();
  expect(router.state.location.search).toContain('week=2026-11-09');
  await vi.waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ from: '2026-11-08T22:00:00.000Z' }),
  );
  await user.click(screen.getByRole('button', { name: 'This week' }));
  expect(await screen.findByText('16 – 22 Nov 2026')).toBeInTheDocument();
  expect(router.state.location.search).not.toContain('week=');
});

test('a future or malformed week falls back to the current week', async () => {
  serveOutages([]);
  renderRoute(`/devices/${id}?week=2027-01-04`, { me: meFixture() });
  expect(await screen.findByText('16 – 22 Nov 2026')).toBeInTheDocument();
});

test('follows cursors until the week is loaded', async () => {
  const cursors: (string | null)[] = [];
  server.use(
    http.get(outagesUrl, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      cursors.push(cursor);
      return cursor
        ? HttpResponse.json({ items: [outageFixture({ id: 'b' })], next_cursor: null })
        : HttpResponse.json({ items: [outageFixture({ id: 'a' })], next_cursor: 'next' });
    }),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  await vi.waitFor(() => expect(screen.getAllByText('Power outage')).toHaveLength(2));
  expect(cursors).toEqual([null, 'next']);
});

test('the grid shows time without power per hour', async () => {
  serveOutages([outageFixture()]);
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByText('Power outage');
  await user.click(screen.getByRole('tab', { name: 'Grid' }));
  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(8);
  expect(within(table).getByText('Sat 21 18:00–19:00 · 18 min without power')).toBeInTheDocument();
  expect(within(table).getByText('Sat 21 19:00–20:00 · 1 h without power')).toBeInTheDocument();
  expect(within(table).getByText('Sat 21 23:00–24:00 · Not yet')).toBeInTheDocument();
  expect(localStorage.getItem('em.historyView')).toBe('grid');
});

test('the table lists outages and the choice is remembered', async () => {
  localStorage.setItem('em.historyView', 'table');
  serveOutages([
    outageFixture(),
    outageFixture({ id: 'blip', type: 'POWER_BLIP', cause: null, kind: null }),
  ]);
  renderRoute(`/devices/${id}`, { me: meFixture() });
  const table = await screen.findByRole('table');
  expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(3);
  expect(within(rows[1] as HTMLElement).getByText('2 h 15 min')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).getByText('Power blip')).toBeInTheDocument();
});
