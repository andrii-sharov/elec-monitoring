import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { channelFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const home = channelFixture();
const office = channelFixture({ id: '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d02', name: 'Office' });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function linkHandler(expiresAt = '2026-11-21T18:57:00Z') {
  return http.post(`${base}/api/v1/channels/telegram-link`, () =>
    HttpResponse.json(
      {
        url: 'https://t.me/ElecBot?start=abc',
        group_url: 'https://t.me/ElecBot?startgroup=abc',
        expires_at: expiresAt,
      },
      { status: 201 },
    ),
  );
}

test('lists channels with state and a disabled reason', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () =>
      HttpResponse.json({
        items: [home, channelFixture({ ...office, enabled: false, disabled_reason: 'USER' })],
      }),
    ),
  );
  renderRoute('/notifications', { me: meFixture() });
  expect(await screen.findByText('Home chat')).toBeInTheDocument();
  expect(screen.getByText('Office')).toBeInTheDocument();
  expect(screen.getByText('Disabled by you')).toBeInTheDocument();
});

test('connect shows both links and stops polling after a new channel appears', async () => {
  let polls = 0;
  server.use(
    linkHandler(),
    http.get(`${base}/api/v1/channels`, () => {
      polls += 1;
      return HttpResponse.json({ items: polls < 3 ? [home] : [home, office] });
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await user.click(screen.getByRole('button', { name: 'Connect Telegram' }));
  const open = await screen.findByRole('link', { name: 'Open in Telegram' });
  expect(open).toHaveAttribute('href', 'https://t.me/ElecBot?start=abc');
  expect(open).toHaveAttribute('target', '_blank');
  expect(open).toHaveAttribute('rel', 'noopener');
  expect(screen.getByRole('link', { name: 'Add to a group' })).toHaveAttribute(
    'href',
    'https://t.me/ElecBot?startgroup=abc',
  );
  await vi.advanceTimersByTimeAsync(3000);
  expect(screen.queryByText('Telegram connected')).not.toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await screen.findByText('Telegram connected')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open in Telegram' })).not.toBeInTheDocument();
  const after = polls;
  await vi.advanceTimersByTimeAsync(10000);
  expect(polls).toBe(after);
});

test('an expired link says so and stops polling', async () => {
  let polls = 0;
  server.use(
    linkHandler('2026-11-21T18:42:07Z'),
    http.get(`${base}/api/v1/channels`, () => {
      polls += 1;
      return HttpResponse.json({ items: [home] });
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await user.click(screen.getByRole('button', { name: 'Connect Telegram' }));
  await screen.findByRole('link', { name: 'Open in Telegram' });
  await vi.advanceTimersByTimeAsync(9000);
  expect(await screen.findByText('Link expired, create a new one')).toBeInTheDocument();
  const after = polls;
  await vi.advanceTimersByTimeAsync(10000);
  expect(polls).toBe(after);
});

test('an unverified email disables connect and shows a hint', async () => {
  server.use(http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })));
  renderRoute('/notifications', { me: meFixture({ email_verified: false }) });
  expect(await screen.findByRole('button', { name: 'Connect Telegram' })).toBeDisabled();
  expect(screen.getByText('Confirm your email to connect Telegram.')).toBeInTheDocument();
});

test('a rate limited link shows the wait', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
    http.post(`${base}/api/v1/channels/telegram-link`, () =>
      HttpResponse.json(
        { error: { code: 'rate_limited', message: 'Slow down' } },
        { status: 429, headers: { 'Retry-After': '120' } },
      ),
    ),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 2 min');
});

test('remove asks for confirmation, deletes and the channel disappears', async () => {
  let items = [home, office];
  const deleted = vi.fn<() => void>();
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items })),
    http.delete(`${base}/api/v1/channels/${home.id}`, () => {
      deleted();
      items = [office];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
  await vi.waitFor(() => expect(screen.queryByText('Home chat')).not.toBeInTheDocument());
  expect(deleted).toHaveBeenCalledOnce();
  expect(screen.getByText('Office')).toBeInTheDocument();
});

test('a failed remove shows the error', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [home] })),
    http.delete(`${base}/api/v1/channels/${home.id}`, () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 }),
    ),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Remove' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
});
