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

function outage(n: number) {
  return outageFixture({
    id: `o${n}`,
    started_at: `2026-11-${String(n).padStart(2, '0')}T10:00:00Z`,
    ended_at: `2026-11-${String(n).padStart(2, '0')}T10:05:00Z`,
    duration_s: 300,
  });
}

test('shows an empty state', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText('No outages yet')).toBeInTheDocument();
});

test('renders range, duration, cause and kind', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [outageFixture()], next_cursor: null }),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  const item = (await screen.findByText('Power outage')).closest('li') as HTMLElement;
  expect(within(item).getByText(/18:42 → 20:57/)).toBeInTheDocument();
  expect(within(item).getByText('2 h 15 min')).toBeInTheDocument();
  expect(within(item).getByText('Long')).toBeInTheDocument();
  expect(within(item).getByText('Outage')).toBeInTheDocument();
});

test('an open outage is ongoing and a blip is labelled', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({
        items: [
          outageFixture({ id: 'open', ended_at: null, duration_s: null, cause: null, kind: null }),
          outageFixture({ id: 'blip', type: 'POWER_BLIP', cause: 'POWER', kind: 'SHORT' }),
        ],
        next_cursor: null,
      }),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  expect(await screen.findByText(/Ongoing since 21 Nov 18:42/)).toBeInTheDocument();
  expect(screen.getByText('Power blip')).toBeInTheDocument();
});

test('an open outage shows a live duration instead of a placeholder', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({
        items: [
          outageFixture({
            id: 'open',
            started_at: '2026-11-21T20:59:30Z',
            ended_at: null,
            duration_s: null,
            cause: null,
            kind: null,
          }),
        ],
        next_cursor: null,
      }),
    ),
  );
  renderRoute(`/devices/${id}`, { me: meFixture() });
  const item = (await screen.findByText(/Ongoing since/)).closest('li') as HTMLElement;
  expect(within(item).getByText('30 s')).toBeInTheDocument();
  expect(within(item).queryByText('ongoing')).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(within(item).getByText('31 s')).toBeInTheDocument();
});

test('Show more fetches the next page with the cursor and hides at the end', async () => {
  const cursors: (string | null)[] = [];
  const limits: (string | null)[] = [];
  server.use(
    http.get(`${base}/api/v1/devices/${id}/outages`, ({ request }) => {
      const url = new URL(request.url);
      cursors.push(url.searchParams.get('cursor'));
      limits.push(url.searchParams.get('limit'));
      return url.searchParams.get('cursor')
        ? HttpResponse.json({ items: [outage(1)], next_cursor: null })
        : HttpResponse.json({
            items: Array.from({ length: 20 }, (_, i) => outage(i + 2)),
            next_cursor: 'abc',
          });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: meFixture() });
  const button = await screen.findByRole('button', { name: 'Show more' });
  expect(screen.getAllByRole('listitem')).toHaveLength(20);
  await user.click(button);
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(21));
  expect(cursors).toContain('abc');
  expect(limits[0]).toBe('20');
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});
