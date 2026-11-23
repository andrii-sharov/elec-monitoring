import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';

test('forgot password always shows the same screen', async () => {
  const spy = vi.fn<(body: unknown) => void>();
  server.use(
    http.post(`${base}/api/auth/forgot-password`, async ({ request }) => {
      spy(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute('/forgot-password');
  await user.type(await screen.findByLabelText('Email'), 'johnny@example.com');
  await user.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith({ email: 'johnny@example.com' });
});

test('reset password success tells the user to log in', async () => {
  const spy = vi.fn<(body: unknown) => void>();
  server.use(
    http.post(`${base}/api/auth/reset-password`, async ({ request }) => {
      spy(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute('/reset-password?token=abc');
  await user.type(await screen.findByLabelText('New password'), 'password1');
  await user.type(screen.getByLabelText('Repeat the password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith({ token: 'abc', password: 'password1' });
});

test('mismatched passwords block the request', async () => {
  const spy = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/auth/reset-password`, () => {
      spy();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute('/reset-password?token=abc');
  await user.type(await screen.findByLabelText('New password'), 'password1');
  await user.type(screen.getByLabelText('Repeat the password'), 'password2');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

test('reset with an expired token links to forgot password', async () => {
  server.use(
    http.post(`${base}/api/auth/reset-password`, () =>
      HttpResponse.json({ error: { code: 'expired', message: 'x' } }, { status: 410 }),
    ),
  );
  const { user } = renderRoute('/reset-password?token=abc');
  await user.type(await screen.findByLabelText('New password'), 'password1');
  await user.type(screen.getByLabelText('Repeat the password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
});
