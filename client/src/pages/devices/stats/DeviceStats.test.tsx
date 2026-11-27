import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture, statsFixture } from '../../../../test/fixtures.ts';
import { renderRoute } from '../../../../test/render.tsx';
import { server } from '../../../../test/server.ts';
import { pollMs, statsPollMs } from '@/api/queries';
import { periodRange } from '@/lib/period';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';
const statsUrl = `${base}/api/v1/devices/${id}/stats`;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T21:00:00Z'));
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () => HttpResponse.json({ channel_ids: [] })),
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture())),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function serveStats(body = statsFixture()) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(statsUrl, ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
  return requests;
}

const open = (query = '') => renderRoute(`/devices/${id}?tab=stats${query}`, { me: meFixture() });

function tile(label: string): HTMLElement {
  return screen.getByText(label, { selector: '[data-stat-label]' }).closest('[data-stat]')!;
}

test('shows the summary tiles for the current week', async () => {
  const requests = serveStats();
  open();
  expect(await screen.findByText('95.24%')).toBeInTheDocument();
  expect(requests[0]?.get('period')).toBe('WEEK');
  expect(requests[0]?.get('from')).toBe('2026-11-16');
  expect(requests[0]?.has('to')).toBe(false);
  expect(within(tile('Without power')).getByText('8 h')).toBeInTheDocument();
  expect(within(tile('Outages')).getByText('7')).toBeInTheDocument();
  expect(within(tile('Outages')).getByText('Long: 3')).toBeInTheDocument();
  expect(within(tile('Average outage')).getByText('1 h 8 min')).toBeInTheDocument();
  expect(within(tile('Average outage')).getByText('Longest: 4 h')).toBeInTheDocument();
  expect(within(tile('Power blips')).getByText('2')).toBeInTheDocument();
});

test('time without internet shows under time without power only when there was some', async () => {
  serveStats(statsFixture({ network_downtime_s: 720 }));
  open();
  await screen.findByText('95.24%');
  expect(within(tile('Without power')).getByText('No internet: 12 min')).toBeInTheDocument();
});

test('no internet hint is hidden when there was none', async () => {
  serveStats();
  open();
  await screen.findByText('95.24%');
  expect(within(tile('Without power')).queryByText(/No internet/)).toBeNull();
});

test('the period is shared with the History tab through the URL', async () => {
  const requests = serveStats();
  const { user, router } = open();
  await screen.findByText('95.24%');
  await user.click(screen.getByRole('button', { name: 'Month' }));
  await waitFor(() => expect(requests.at(-1)?.get('period')).toBe('MONTH'));
  expect(requests.at(-1)?.get('from')).toBe('2026-11-01');
  await user.click(screen.getByRole('tab', { name: 'History' }));
  expect(router.state.location.search).toContain('period=month');
  expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
});

test('polls only while the range includes today', () => {
  expect(statsPollMs(periodRange('week', '2026-11-21'), '2026-11-21')).toBe(pollMs.device);
  expect(statsPollMs(periodRange('month', '2026-10-01'), '2026-11-21')).toBe(false);
});

test('a device that never checked in explains when stats start', async () => {
  serveStats(
    statsFixture({
      monitoring_since: null,
      outages: 0,
      long_outages: 0,
      availability_pct: null,
      buckets: statsFixture().buckets.map((b) => ({ ...b, availability_pct: null })),
    }),
  );
  open();
  expect(await screen.findByText('Statistics start after the first check-in.')).toBeInTheDocument();
  expect(screen.queryByText('Availability')).toBeNull();
});

test('a table lists every bucket for screen readers', async () => {
  serveStats();
  open();
  const table = await screen.findByRole('table', { name: 'Time without power by period' });
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(8);
  expect(within(rows[2]!).getByText('1 h')).toBeInTheDocument();
  expect(within(rows[2]!).getByText('95.83%')).toBeInTheDocument();
});

test('the chart loads lazily and causes show shares and an open outage', async () => {
  serveStats(statsFixture({ open_outage: true, outages: 8 }));
  open();
  await screen.findByText('95.24%');
  await waitFor(() => expect(document.querySelector('[data-slot="chart"]')).not.toBeNull());
  expect(document.querySelector('[aria-hidden="true"] [tabindex]:not([tabindex="-1"])')).toBeNull();
  const causes = screen.getByRole('region', { name: 'Causes' });
  expect(within(causes).getByText('Power')).toBeInTheDocument();
  expect(within(causes).getByText('5')).toBeInTheDocument();
  expect(within(causes).getByText('Still going: 1')).toBeInTheDocument();
});

test('an unavailable range shows "No data yet"', async () => {
  serveStats(statsFixture({ availability_pct: null }));
  open();
  await screen.findByText('Without power', { selector: '[data-stat-label]' });
  expect(within(tile('Availability')).getByText('No data yet')).toBeInTheDocument();
});

test('an error offers a retry', async () => {
  server.use(
    http.get(statsUrl, () =>
      HttpResponse.json({ error: { code: 'internal', message: 'Boom' } }, { status: 500 }),
    ),
  );
  open();
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
