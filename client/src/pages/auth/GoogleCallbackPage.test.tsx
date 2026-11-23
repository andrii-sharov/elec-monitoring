import { screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';

test('an error is shown translated', async () => {
  renderRoute('/auth/google?error=google_account_in_use');
  expect(
    await screen.findByText('This Google account is already used by another user.'),
  ).toBeInTheDocument();
});

test('an unknown error falls back to the generic Google error', async () => {
  renderRoute('/auth/google?error=whatever');
  expect(await screen.findByText('Google sign-in failed. Try again.')).toBeInTheDocument();
});

test('a linked account goes to /account', async () => {
  sessionStorage.setItem('em.google', JSON.stringify({ intent: 'LINK' }));
  const { router } = renderRoute('/auth/google', { me: meFixture({ google_linked: true }) });
  await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
  expect(sessionStorage.getItem('em.google')).toBeNull();
});

test('a login goes to /devices by default', async () => {
  const { router } = renderRoute('/auth/google', { me: meFixture() });
  await waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
});

test('without a session the user is sent to login', async () => {
  const { router } = renderRoute('/auth/google');
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
});
