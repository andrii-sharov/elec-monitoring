import type { Device, Invite, Member } from '@elec/shared/api';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, inviteFixture, meFixture, memberFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';
const johnny = meFixture();
const mary = memberFixture();
const owner = memberFixture({
  user_id: johnny.id,
  name: 'Johnny',
  email: 'johnny@example.com',
  role: 'OWNER',
});

function serve(o: { role?: Device['role']; members?: Member[]; invites?: Invite[] } = {}) {
  const invitesSeen = vi.fn<() => void>();
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () =>
      HttpResponse.json(deviceFixture({ id, role: o.role ?? 'OWNER' })),
    ),
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [] })),
    http.get(`${base}/api/v1/devices/${id}/channels`, () => HttpResponse.json({ channel_ids: [] })),
    http.get(`${base}/api/v1/devices/${id}/members`, () =>
      HttpResponse.json({ items: o.members ?? [owner, mary] }),
    ),
    http.get(`${base}/api/v1/devices/${id}/invites`, () => {
      invitesSeen();
      return HttpResponse.json({ items: o.invites ?? [] });
    }),
  );
  return { invitesSeen };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const membersSection = async () =>
  screen.findByRole('region', { name: 'Members' }).then((region) => within(region));

test('the owner sees members with emails and pending invites', async () => {
  serve({
    invites: [
      inviteFixture(),
      inviteFixture({
        id: '2d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f02',
        email: 'old@example.com',
        expires_at: '2026-11-20T00:00:00Z',
      }),
    ],
  });
  renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  expect(await section.findByText('mary@example.com')).toBeVisible();
  expect(section.getByText('johnny@example.com')).toBeVisible();
  expect(await section.findByText('anna@example.com')).toBeVisible();
  const old = section.getByText('old@example.com').closest('li')!;
  expect(within(old).getByText('Expired')).toBeVisible();
  expect(within(old).getByRole('button', { name: 'Resend' })).toBeVisible();
});

test('revoking an invite removes it from the list', async () => {
  const invite = inviteFixture();
  let invites = [invite];
  serve();
  server.use(
    http.get(`${base}/api/v1/devices/${id}/invites`, () => HttpResponse.json({ items: invites })),
    http.delete(`${base}/api/v1/devices/${id}/invites/${invite.id}`, () => {
      invites = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  await user.click(await section.findByRole('button', { name: 'Revoke' }));
  await vi.waitFor(() => expect(section.queryByText('anna@example.com')).not.toBeInTheDocument());
});

test('inviting sends the email, clears the field and refetches', async () => {
  const body = vi.fn<(value: unknown) => void>();
  serve();
  server.use(
    http.post(`${base}/api/v1/devices/${id}/invites`, async ({ request }) => {
      body(await request.json());
      return HttpResponse.json(inviteFixture({ email: 'pete@example.com' }), { status: 201 });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  const field = await section.findByLabelText('Email');
  await user.type(field, 'pete@example.com');
  await user.click(section.getByRole('button', { name: 'Send invite' }));
  await vi.waitFor(() => expect(body).toHaveBeenCalledWith({ email: 'pete@example.com' }));
  expect(await screen.findByText('Invite sent to pete@example.com')).toBeVisible();
  await vi.waitFor(() => expect(field).toHaveValue(''));
});

test('an existing member shows on the email field', async () => {
  serve();
  server.use(
    http.post(`${base}/api/v1/devices/${id}/invites`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'conflict',
            message: 'Already a member',
            details: [{ path: 'email', code: 'already_member' }],
          },
        },
        { status: 409 },
      ),
    ),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  await user.type(await section.findByLabelText('Email'), 'mary@example.com');
  await user.click(section.getByRole('button', { name: 'Send invite' }));
  expect(await section.findByText('Already a member of this device')).toBeVisible();
});

test('an invalid email is caught before sending', async () => {
  const body = vi.fn<() => void>();
  serve();
  server.use(
    http.post(`${base}/api/v1/devices/${id}/invites`, () => {
      body();
      return HttpResponse.json(inviteFixture(), { status: 201 });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  await user.type(await section.findByLabelText('Email'), 'not-an-email');
  await user.click(section.getByRole('button', { name: 'Send invite' }));
  expect(await section.findByText('Enter a valid email address')).toBeVisible();
  expect(body).not.toHaveBeenCalled();
});

test('the form is disabled at 10 members and invites', async () => {
  const viewers = Array.from({ length: 8 }, (_, i) =>
    memberFixture({ user_id: `9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e1${i}`, name: `V${i}` }),
  );
  serve({
    members: [owner, mary, ...viewers],
    invites: [inviteFixture()],
  });
  renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  expect(await section.findByText(/the most allowed/)).toBeVisible();
  expect(section.getByRole('button', { name: 'Send invite' })).toBeDisabled();
});

test('removing a viewer asks first, then refetches', async () => {
  let members = [owner, mary];
  serve();
  const removed = vi.fn<() => void>();
  server.use(
    http.get(`${base}/api/v1/devices/${id}/members`, () => HttpResponse.json({ items: members })),
    http.delete(`${base}/api/v1/devices/${id}/members/${mary.user_id}`, () => {
      removed();
      members = [owner];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  await user.click(await section.findByRole('button', { name: 'Remove Mary' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
  await vi.waitFor(() => expect(removed).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(section.queryByText('Mary')).not.toBeInTheDocument());
});

test('a viewer sees the list, no invite tools, and can leave', async () => {
  const me = meFixture({ id: mary.user_id, email: 'mary@example.com', name: 'Mary' });
  const left = vi.fn<() => void>();
  const { invitesSeen } = serve({
    role: 'VIEWER',
    members: [{ ...owner, email: null }, mary],
  });
  server.use(
    http.delete(`${base}/api/v1/devices/${id}/members/${mary.user_id}`, () => {
      left();
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [] })),
  );
  const { user, router } = renderRoute(`/devices/${id}`, { me });
  const section = await membersSection();
  expect(await section.findByText('Johnny')).toBeVisible();
  expect(section.queryByText('johnny@example.com')).not.toBeInTheDocument();
  expect(section.queryByLabelText('Email')).not.toBeInTheDocument();
  expect(section.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  expect(invitesSeen).not.toHaveBeenCalled();

  await user.click(section.getByRole('button', { name: 'Leave device' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
  expect(left).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('You left Home')).toBeVisible();
});

test('the invite form works from the keyboard', async () => {
  const body = vi.fn<(value: unknown) => void>();
  serve();
  server.use(
    http.post(`${base}/api/v1/devices/${id}/invites`, async ({ request }) => {
      body(await request.json());
      return HttpResponse.json(inviteFixture({ email: 'pete@example.com' }), { status: 201 });
    }),
  );
  const { user } = renderRoute(`/devices/${id}`, { me: johnny });
  const section = await membersSection();
  const field = await section.findByLabelText('Email');
  field.focus();
  await user.keyboard('pete@example.com{Enter}');
  await vi.waitFor(() => expect(body).toHaveBeenCalledWith({ email: 'pete@example.com' }));
});
