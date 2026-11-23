import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';

function verifyHandler(status: number) {
  const spy = vi.fn<(body: unknown) => void>();
  server.use(
    http.post(`${base}/api/auth/verify-email`, async ({ request }) => {
      spy(await request.json());
      return status === 204
        ? new HttpResponse(null, { status })
        : HttpResponse.json({ error: { code: 'expired', message: 'x' } }, { status });
    }),
  );
  return spy;
}

test('success posts the token once', async () => {
  const spy = verifyHandler(204);
  renderRoute('/verify-email?token=x');
  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith({ token: 'x' });
});

test('signed-in success offers devices', async () => {
  verifyHandler(204);
  renderRoute('/verify-email?token=x', { me: meFixture() });
  expect(await screen.findByRole('link', { name: 'Go to devices' })).toBeInTheDocument();
});

test('an expired link shows the expired text', async () => {
  const spy = verifyHandler(410);
  renderRoute('/verify-email?token=x');
  expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();
  expect(spy).toHaveBeenCalledTimes(1);
});

test('signed-in expired link resends the email', async () => {
  verifyHandler(410);
  const spy = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/auth/resend-verification`, () => {
      spy();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute('/verify-email?token=x', {
    me: meFixture({ email_verified: false }),
  });
  await user.click(await screen.findByRole('button', { name: 'Resend email' }));
  expect(await screen.findByText('Confirmation email sent')).toBeInTheDocument();
  expect(spy).toHaveBeenCalledTimes(1);
});

test('a missing token shows the expired text without a request', async () => {
  const spy = verifyHandler(204);
  renderRoute('/verify-email');
  expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});
