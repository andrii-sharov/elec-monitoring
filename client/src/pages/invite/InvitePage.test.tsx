import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { deviceFixture, invitePreviewFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const mary = meFixture({ email: 'mary@example.com', name: 'Mary' });
const shared = deviceFixture({ id: '4c0f5e1a-0b2c-4d3e-8f4a-5b6c7d8e9f01', role: 'VIEWER' });

function servePreview(status = 200, overrides = {}) {
  server.use(
    http.get(`${base}/api/v1/invites/t1`, () =>
      status === 200
        ? HttpResponse.json(invitePreviewFixture(overrides))
        : HttpResponse.json({ error: { code: 'expired', message: 'x' } }, { status }),
    ),
  );
}

function serveAccept(status = 200) {
  const spy = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/v1/invites/t1/accept`, () => {
      spy();
      if (status !== 200) {
        const code = status === 403 ? 'forbidden' : 'expired';
        return HttpResponse.json({ error: { code, message: 'x' } }, { status });
      }
      return HttpResponse.json(shared);
    }),
    http.get(`${base}/api/v1/devices/${shared.id}`, () => HttpResponse.json(shared)),
    http.get(`${base}/api/v1/devices/${shared.id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`${base}/api/v1/devices/${shared.id}/channels`, () =>
      HttpResponse.json({ channel_ids: [] }),
    ),
    http.get(`${base}/api/v1/devices/${shared.id}/members`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
  );
  return spy;
}

test('signed out, it offers sign-up and log in for the invited email', async () => {
  servePreview();
  renderRoute('/invite?token=t1');
  expect(await screen.findByRole('heading', { name: 'John invited you to Home' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
    'href',
    '/signup?email=mary%40example.com&invite=1',
  );
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
    'href',
    '/login?email=mary%40example.com&next=%2Finvite%3Ftoken%3Dt1',
  );
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('an expired invite says so without buttons', async () => {
  servePreview(410);
  renderRoute('/invite?token=t1');
  expect(await screen.findByRole('heading', { name: 'Invite expired' })).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Create account' })).not.toBeInTheDocument();
});

test('a missing token is expired', async () => {
  renderRoute('/invite');
  expect(await screen.findByRole('heading', { name: 'Invite expired' })).toBeVisible();
});

test('signed in as another account, it shows both emails and sign out', async () => {
  servePreview();
  renderRoute('/invite?token=t1', { me: meFixture({ email: 'pete@example.com' }) });
  expect(await screen.findByRole('heading', { name: 'Wrong account' })).toBeVisible();
  expect(
    screen.getByText("This invite is for mary@example.com. You're signed in as pete@example.com."),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
});

test('signed in as the invitee, Accept opens the device', async () => {
  servePreview();
  const spy = serveAccept();
  const { user, router } = renderRoute('/invite?token=t1', { me: mary });
  await user.click(await screen.findByRole('button', { name: 'Accept' }));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/devices/${shared.id}`));
  expect(spy).toHaveBeenCalledTimes(1);
});

test('an accepted invite offers to open the device', async () => {
  servePreview(200, { accepted: true });
  const spy = serveAccept();
  const { user, router } = renderRoute('/invite?token=t1', { me: mary });
  await user.click(await screen.findByRole('button', { name: 'Open device' }));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/devices/${shared.id}`));
  expect(spy).toHaveBeenCalledTimes(1);
});

test('accept 403 shows the wrong-account message', async () => {
  servePreview();
  serveAccept(403);
  const { user } = renderRoute('/invite?token=t1', { me: mary });
  await user.click(await screen.findByRole('button', { name: 'Accept' }));
  expect(await screen.findByRole('heading', { name: 'Wrong account' })).toBeVisible();
});

test('accept 410 shows the expired message', async () => {
  servePreview();
  serveAccept(410);
  const { user } = renderRoute('/invite?token=t1', { me: mary });
  await user.click(await screen.findByRole('button', { name: 'Accept' }));
  expect(await screen.findByRole('heading', { name: 'Invite expired' })).toBeVisible();
});
