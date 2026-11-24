import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { meFixture, outageFixture } from '../../test/fixtures.ts';
import { renderInApp } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { PowerStrip } from './PowerStrip.tsx';

const base = 'http://localhost:3000';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T21:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('summarises the last 7 days and labels each segment with its range', async () => {
  server.use(
    http.get(`${base}/api/v1/devices/d1/outages`, () =>
      HttpResponse.json({
        items: [
          outageFixture({ id: 'a' }),
          outageFixture({
            id: 'b',
            type: 'POWER_BLIP',
            started_at: '2026-11-20T08:00:00Z',
            ended_at: '2026-11-20T08:00:02Z',
            duration_s: 2,
            cause: null,
            kind: null,
          }),
        ],
        next_cursor: null,
      }),
    ),
  );
  renderInApp(<PowerStrip deviceId="d1" />, { me: meFixture() });
  expect(await screen.findByText('Last 7 days: outages 1, power blips 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Outage: 18:42 → 20:57$/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Power blip:/ })).toBeInTheDocument();
});
