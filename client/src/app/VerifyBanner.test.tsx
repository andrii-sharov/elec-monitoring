import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { meFixture } from '../../test/fixtures.ts';
import { renderRoute } from '../../test/render.tsx';
import { server } from '../../test/server.ts';

const base = 'http://localhost:3000';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  server.use(http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [] })));
});

afterEach(() => {
  vi.useRealTimers();
});

test('a verified user sees no banner', async () => {
  renderRoute('/devices', { me: meFixture() });
  await screen.findByText('No devices yet');
  expect(screen.queryByRole('button', { name: 'Resend email' })).toBeNull();
});

test('a verified phone counts as verified', async () => {
  const me = meFixture({
    email: null,
    email_verified: false,
    phone: '+380501234567',
    phone_verified: true,
  });
  renderRoute('/devices', { me });
  await screen.findByText('No devices yet');
  expect(screen.queryByRole('button', { name: 'Resend email' })).toBeNull();
  for (const button of screen.getAllByRole('button', { name: 'Add device' })) {
    expect(button).toBeEnabled();
  }
});

test('an unverified user sees the banner and a disabled Add device', async () => {
  renderRoute('/devices', { me: meFixture({ email_verified: false }) });
  expect(await screen.findByRole('button', { name: 'Resend email' })).toBeInTheDocument();
  await screen.findByText('No devices yet');
  for (const button of screen.getAllByRole('button', { name: 'Add device' })) {
    expect(button).toBeDisabled();
  }
  expect(screen.getByText('Confirm your email or phone to add a device.')).toBeInTheDocument();
});

test('Resend email posts and shows the toast', async () => {
  const spy = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/auth/resend-verification`, () => {
      spy();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute('/devices', { me: meFixture({ email_verified: false }) });
  await user.click(await screen.findByRole('button', { name: 'Resend email' }));
  expect(await screen.findByText('Confirmation email sent')).toBeInTheDocument();
  expect(spy).toHaveBeenCalledTimes(1);
});

test('a 429 shows the wait', async () => {
  server.use(
    http.post(`${base}/api/auth/resend-verification`, () =>
      HttpResponse.json(
        { error: { code: 'rate_limited', message: 'x' } },
        { status: 429, headers: { 'Retry-After': '120' } },
      ),
    ),
  );
  const { user } = renderRoute('/devices', { me: meFixture({ email_verified: false }) });
  await user.click(await screen.findByRole('button', { name: 'Resend email' }));
  expect(await screen.findByText('Too many attempts. Try again in 2 min.')).toBeInTheDocument();
});

test('a phone account confirms its number in Telegram', async () => {
  const spy = vi.fn<(body: unknown) => void>();
  const telegramUrl = 'https://t.me/TestBot?start=p_abc';
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  server.use(
    http.post(`${base}/api/auth/phone`, async ({ request }) => {
      spy(await request.json());
      return HttpResponse.json({ telegram_url: telegramUrl });
    }),
  );
  const me = meFixture({ email: null, email_verified: false, phone: '+380501234567' });
  const { user } = renderRoute('/devices', { me });
  expect(await screen.findByText('Confirm your number in Telegram')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirm number' }));
  expect(await screen.findByRole('link', { name: 'Open Telegram' })).toHaveAttribute(
    'href',
    telegramUrl,
  );
  expect(spy).toHaveBeenCalledWith({ phone: '+380501234567' });
  expect(open).toHaveBeenCalledWith(telegramUrl, '_blank', 'noopener,noreferrer');
  open.mockRestore();
});
