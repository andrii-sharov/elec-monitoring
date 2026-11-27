import { fireEvent, screen, within } from '@testing-library/react';
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
  expect(await screen.findByText('No outages in this period')).toBeInTheDocument();
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
  await screen.findByText('No outages in this period');
  await user.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(await screen.findByText('9 – 15 Nov 2026')).toBeInTheDocument();
  expect(router.state.location.search).toContain('from=2026-11-09');
  await vi.waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ from: '2026-11-08T22:00:00.000Z' }),
  );
  await user.click(screen.getByRole('button', { name: 'This week' }));
  expect(await screen.findByText('16 – 22 Nov 2026')).toBeInTheDocument();
  expect(router.state.location.search).not.toContain('from=');
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
  const grid = await screen.findByRole('region', { name: 'Grid' });
  expect(within(grid).getAllByRole('button')).toHaveLength(7 * 24);
  const cell = (name: string) => within(grid).getByRole('button', { name });
  expect(cell('Sat 21 18:00–19:00 · 18 min without power')).toBeInTheDocument();
  expect(cell('Sat 21 19:00–20:00 · 1 h without power')).toBeInTheDocument();
  expect(cell('Sat 21 23:00–24:00 · Not yet')).toBeInTheDocument();
  expect(localStorage.getItem('em.historyView')).toBe('grid');
});

test('a grid cell opens a card with its outages and arrow keys move between cells', async () => {
  serveOutages([outageFixture()]);
  const { user } = renderRoute(`/devices/${id}?view=grid`, { me: meFixture() });
  const grid = await screen.findByRole('region', { name: 'Grid' });
  const first = within(grid).getByRole('button', { name: /^Mon 16 00:00–01:00/ });
  expect(first).toHaveAttribute('tabindex', '0');
  first.focus();
  await user.keyboard('{ArrowDown}{ArrowRight}');
  expect(document.activeElement).toBe(
    within(grid).getByRole('button', { name: /^Tue 17 01:00–02:00/ }),
  );
  await user.click(within(grid).getByRole('button', { name: /^Sat 21 19:00–20:00/ }));
  const card = await screen.findByRole('dialog');
  expect(within(card).getByText('Without power')).toBeInTheDocument();
  expect(within(card).getByText(/18:42 → 20:57/)).toBeInTheDocument();
  expect(within(card).getByText('Long')).toBeInTheDocument();
  await user.click(within(card).getByRole('button', { name: 'Show this day in the timeline' }));
  expect(await screen.findByRole('tab', { name: 'Timeline', selected: true })).toBeInTheDocument();
});

test('a busy cell card scrolls its outage list and keeps the totals in view', async () => {
  serveOutages([outageFixture()]);
  const { user } = renderRoute(`/devices/${id}?view=grid`, { me: meFixture() });
  const grid = await screen.findByRole('region', { name: 'Grid' });
  await user.click(within(grid).getByRole('button', { name: /^Sat 21 19:00–20:00/ }));
  const card = await screen.findByRole('dialog');
  const list = within(card).getByRole('list');
  expect(list.parentElement).toHaveClass('overflow-y-auto');
  expect(list.parentElement).not.toContainElement(within(card).getByText('Without power'));
});

test('a cell card shows time without internet only when there was some', async () => {
  serveOutages([
    outageFixture({
      cause: 'NETWORK',
      kind: 'SHORT',
      started_at: '2026-11-21T17:00:00Z',
      ended_at: '2026-11-21T17:12:00Z',
    }),
  ]);
  const { user } = renderRoute(`/devices/${id}?view=grid`, { me: meFixture() });
  const grid = await screen.findByRole('region', { name: 'Grid' });
  await user.click(within(grid).getByRole('button', { name: /^Sat 21 19:00–20:00/ }));
  const card = await screen.findByRole('dialog');
  expect(within(card).getByText('No internet')).toBeInTheDocument();
  expect(within(card).getByText('12 min')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await user.click(within(grid).getByRole('button', { name: /^Sat 21 20:00–21:00/ }));
  expect(within(await screen.findByRole('dialog')).queryByText('No internet')).toBeNull();
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

test('the month period loads the whole local month', async () => {
  const requests = serveOutages([]);
  const { user, router } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByText('No outages in this period');
  await user.click(screen.getByRole('button', { name: 'Month' }));
  expect(await screen.findByText('November 2026')).toBeInTheDocument();
  expect(router.state.location.search).toContain('period=month');
  await vi.waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      from: '2026-10-31T22:00:00.000Z',
      to: '2026-11-30T22:00:00.000Z',
    }),
  );
  expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(await screen.findByText('October 2026')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'This month' }));
  expect(await screen.findByText('November 2026')).toBeInTheDocument();
});

test('a year loads month by month and the grid becomes a calendar', async () => {
  const requests = serveOutages([outageFixture()]);
  renderRoute(`/devices/${id}?period=year&view=grid`, { me: meFixture() });
  const calendar = await screen.findByRole('region', { name: 'Grid' });
  expect(within(calendar).getAllByRole('button')).toHaveLength(365);
  expect(
    within(calendar).getByRole('button', { name: 'Sat 21 Nov · 2 h 15 min without power' }),
  ).toBeInTheDocument();
  expect(new Set(requests.map((r) => r.from)).size).toBe(12);
  expect(screen.queryByRole('navigation', { name: 'Days of the week' })).toBeNull();
});

test('a custom range is picked with two dates', async () => {
  serveOutages([]);
  const { user, router } = renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByText('No outages in this period');
  await user.click(screen.getByRole('button', { name: 'Custom' }));
  const from = await screen.findByLabelText('From');
  fireEvent.change(from, { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
  await user.click(screen.getByRole('button', { name: 'Show' }));
  expect(await screen.findByText('1 – 10 Nov 2026')).toBeInTheDocument();
  expect(router.state.location.search).toContain('period=custom');
  expect(router.state.location.search).toContain('to=2026-11-10');
  expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
});

test('the day period shows one row of hours', async () => {
  serveOutages([outageFixture()]);
  renderRoute(`/devices/${id}?period=day&view=grid`, { me: meFixture() });
  const grid = await screen.findByRole('region', { name: 'Grid' });
  expect(within(grid).getAllByRole('button')).toHaveLength(24);
  expect(screen.getByText('Sat, 21 Nov 2026')).toBeInTheDocument();
});

function phoneScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(width < 40rem)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

test('on a phone a month grid becomes a calendar of days', async () => {
  const original = window.matchMedia;
  phoneScreen();
  try {
    serveOutages([outageFixture()]);
    renderRoute(`/devices/${id}?period=month&view=grid`, { me: meFixture() });
    const calendar = await screen.findByRole('region', { name: 'Grid' });
    expect(within(calendar).getAllByRole('button')).toHaveLength(30);
  } finally {
    vi.stubGlobal('matchMedia', original);
  }
});

test('on a phone a week keeps the hour grid', async () => {
  const original = window.matchMedia;
  phoneScreen();
  try {
    serveOutages([outageFixture()]);
    renderRoute(`/devices/${id}?view=grid`, { me: meFixture() });
    const grid = await screen.findByRole('region', { name: 'Grid' });
    expect(within(grid).getAllByRole('button')).toHaveLength(7 * 24);
  } finally {
    vi.stubGlobal('matchMedia', original);
  }
});

test('on a wide screen a month keeps the hour grid', async () => {
  serveOutages([outageFixture()]);
  renderRoute(`/devices/${id}?period=month&view=grid`, { me: meFixture() });
  const grid = await screen.findByRole('region', { name: 'Grid' });
  expect(within(grid).getAllByRole('button')).toHaveLength(30 * 24);
});

test('on a phone a custom range opens as a sheet with stacked dates', async () => {
  const original = window.matchMedia;
  phoneScreen();
  try {
    serveOutages([]);
    const { user, router } = renderRoute(`/devices/${id}`, { me: meFixture() });
    await screen.findByText('No outages in this period');
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const sheet = await screen.findByRole('dialog', { name: 'Choose a date range' });
    expect(sheet.closest('[data-slot="dialog-content"]') ?? sheet).toHaveAttribute(
      'data-slot',
      'dialog-content',
    );
    fireEvent.change(within(sheet).getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(sheet).getByLabelText('To'), { target: { value: '2026-11-10' } });
    await user.click(within(sheet).getByRole('button', { name: 'Show' }));
    expect(router.state.location.search).toContain('to=2026-11-10');
  } finally {
    vi.stubGlobal('matchMedia', original);
  }
});
