import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const phoneOnly = meFixture({
  email: null,
  email_verified: false,
  phone: '+380501234567',
  phone_verified: true,
});

async function renderSection(me: ReturnType<typeof meFixture>) {
  const view = renderRoute('/account', { me });
  const region = await screen.findByRole('region', { name: 'Email and phone' });
  return { ...view, section: within(region) };
}

test('a phone account adds an email and is told to check the inbox', async () => {
  const body = vi.fn<(value: unknown) => void>();
  server.use(
    http.post(`${base}/api/auth/email`, async ({ request }) => {
      body(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${base}/api/v1/me`, () =>
      HttpResponse.json({ ...phoneOnly, email: 'john@example.com' }),
    ),
  );
  const { user, section } = await renderSection(phoneOnly);
  expect(section.getByText('+380 50 123 4567')).toBeVisible();
  expect(section.getByText('Confirmed')).toBeVisible();
  await user.click(section.getByRole('button', { name: 'Add email' }));
  await user.type(section.getByLabelText('Email'), 'john@example.com');
  await user.click(section.getByRole('button', { name: 'Continue' }));
  expect(await section.findByText('Check your inbox for the confirmation link.')).toBeVisible();
  expect(body).toHaveBeenCalledWith({ email: 'john@example.com' });
  expect(await section.findByText('Not confirmed')).toBeVisible();
});

test('an email account adds a phone and gets the Telegram link', async () => {
  const body = vi.fn<(value: unknown) => void>();
  const telegramUrl = 'https://t.me/TestBot?start=p_abc';
  server.use(
    http.post(`${base}/api/auth/phone`, async ({ request }) => {
      body(await request.json());
      return HttpResponse.json({ telegram_url: telegramUrl });
    }),
  );
  const { user, section } = await renderSection(meFixture());
  await user.click(section.getByRole('button', { name: 'Add phone' }));
  await user.type(section.getByLabelText('Phone number'), '050 123 45 67');
  await user.click(section.getByRole('button', { name: 'Continue' }));
  expect(await section.findByRole('link', { name: 'Open Telegram' })).toHaveAttribute(
    'href',
    telegramUrl,
  );
  expect(body).toHaveBeenCalledWith({ phone: '+380501234567' });
});

test('the phone field always shows the country', async () => {
  const { user, section } = await renderSection(meFixture());
  await user.click(section.getByRole('button', { name: 'Add phone' }));
  expect(section.getByRole('button', { name: 'Country code: Ukraine +380' })).toBeVisible();
  expect(section.getByLabelText('Phone number')).toHaveAttribute('placeholder', '050 123 4567');
  await user.type(section.getByLabelText('Phone number'), '05a01');
  expect(section.getByLabelText('Phone number')).toHaveValue('050 1');
});

test('a number used by another account is reported on the field', async () => {
  server.use(
    http.post(`${base}/api/auth/phone`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'conflict',
            message: 'x',
            details: [{ path: 'phone', code: 'already_in_use' }],
          },
        },
        { status: 409 },
      ),
    ),
  );
  const { user, section } = await renderSection(meFixture());
  await user.click(section.getByRole('button', { name: 'Add phone' }));
  await user.type(section.getByLabelText('Phone number'), '0501234567');
  await user.click(section.getByRole('button', { name: 'Continue' }));
  expect(await section.findByText('This number is used by another account')).toBeVisible();
});

test('an unverified account is not offered a new identifier', async () => {
  const { section } = await renderSection(meFixture({ email_verified: false }));
  expect(section.getByText('Not confirmed')).toBeVisible();
  expect(section.queryByRole('button', { name: 'Add phone' })).not.toBeInTheDocument();
});
