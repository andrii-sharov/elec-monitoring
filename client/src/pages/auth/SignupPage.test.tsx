import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';

test('a short password shows an inline error and sends nothing', async () => {
  const spy = vi.fn<(body: unknown) => void>();
  server.use(
    http.post(`${base}/api/auth/signup`, async ({ request }) => {
      spy(await request.json());
      return new HttpResponse(null, { status: 201 });
    }),
  );
  const { user } = renderRoute('/signup');
  await user.type(await screen.findByLabelText('Name'), 'Johnny');
  await user.type(screen.getByLabelText('Email'), 'johnny@example.com');
  await user.type(screen.getByLabelText('Password'), '1234567');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('At least 8 characters')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

test('valid sign-up sends language and timezone and shows the check-email screen', async () => {
  const spy = vi.fn<(body: unknown) => void>();
  server.use(
    http.post(`${base}/api/auth/signup`, async ({ request }) => {
      spy(await request.json());
      return new HttpResponse(null, { status: 201 });
    }),
  );
  const { user } = renderRoute('/signup');
  await user.type(await screen.findByLabelText('Name'), 'Johnny');
  await user.type(screen.getByLabelText('Email'), 'johnny@example.com');
  await user.type(screen.getByLabelText('Password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith({
    email: 'johnny@example.com',
    password: 'password1',
    name: 'Johnny',
    language: 'en',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});

test('an empty name shows Required and sends nothing', async () => {
  const spy = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/auth/signup`, () => {
      spy();
      return new HttpResponse(null, { status: 201 });
    }),
  );
  const { user } = renderRoute('/signup');
  await user.type(await screen.findByLabelText('Email'), 'johnny@example.com');
  await user.type(screen.getByLabelText('Password'), 'password1');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Required')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});
