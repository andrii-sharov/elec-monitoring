import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  channelFixture,
  deviceFixture,
  meFixture,
  webhookFixture,
} from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const home = channelFixture();
const office = channelFixture({ id: '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d02', name: 'Office' });
const homeDevice = deviceFixture();
const dacha = deviceFixture({ id: '5d1a7b2c-3e4f-4a5b-8c6d-7e8f9a0b1c02', name: 'Dacha' });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [homeDevice, dacha] })),
  );
});

async function openConnect(user: ReturnType<typeof renderRoute>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Add channel' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Telegram' }));
}

async function pick(user: ReturnType<typeof renderRoute>['user'], filter: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: filter }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function expand(user: ReturnType<typeof renderRoute>['user'], name: string) {
  await user.click(await screen.findByRole('button', { name: `Details for ${name}` }));
}

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

test('lists channels with status, devices and a count', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () =>
      HttpResponse.json({
        items: [
          channelFixture({ ...home, device_ids: [homeDevice.id, dacha.id] }),
          channelFixture({ ...office, enabled: false, disabled_reason: 'USER' }),
        ],
      }),
    ),
  );
  renderRoute('/notifications', { me: meFixture() });
  const row = (await screen.findByText('Home chat')).closest('li') as HTMLElement;
  expect(within(row).getByText('Active')).toBeInTheDocument();
  expect(within(row).getByText('Dacha')).toBeInTheDocument();
  const off = screen.getByText('Office').closest('li') as HTMLElement;
  expect(within(off).getByText('Turned off')).toBeInTheDocument();
  expect(within(off).getByText('No devices send here')).toBeInTheDocument();
  expect(screen.getByText('2 of 2')).toBeInTheDocument();
});

test('connect shows both links and stops polling after a new channel appears', async () => {
  let polls = 0;
  let connected = false;
  server.use(
    linkHandler(),
    http.get(`${base}/api/v1/channels`, () => {
      polls += 1;
      return HttpResponse.json({ items: connected ? [home, office] : [home] });
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await openConnect(user);
  await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
  const open = await screen.findByRole('link', { name: 'Open in Telegram' });
  expect(open).toHaveAttribute('href', 'https://t.me/ElecBot?start=abc');
  expect(open).toHaveAttribute('target', '_blank');
  expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByRole('link', { name: 'Add to a group' })).toHaveAttribute(
    'href',
    'https://t.me/ElecBot?startgroup=abc',
  );
  await vi.advanceTimersByTimeAsync(3000);
  expect(screen.queryByText('Telegram connected')).not.toBeInTheDocument();
  connected = true;
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
  await openConnect(user);
  await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
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
  expect(screen.getByText('Confirm your email or phone to connect Telegram.')).toBeInTheDocument();
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
  await expand(user, 'Home chat');
  await user.click(screen.getByRole('button', { name: 'Remove' }));
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
  await expand(user, 'Home chat');
  await user.click(await screen.findByRole('button', { name: 'Remove' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
  expect(await screen.findByText('Not found.')).toBeInTheDocument();
});

function captureJson(method: 'patch' | 'put' | 'post', path: string, response: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http[method](`${base}${path}`, async ({ request }) => {
      bodies.push(method === 'post' ? null : await request.json());
      return response();
    }),
  );
  return bodies;
}

test('search, status and device filters narrow the list and live in the URL', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () =>
      HttpResponse.json({
        items: [
          channelFixture({ ...home, device_ids: [homeDevice.id] }),
          channelFixture({
            ...office,
            enabled: false,
            disabled_reason: 'USER',
            device_ids: [dacha.id],
          }),
        ],
      }),
    ),
  );
  const { user, router } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await user.type(screen.getByRole('searchbox', { name: 'Search channels' }), 'off');
  expect(screen.queryByText('Home chat')).toBeNull();
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  expect(router.state.location.search).toContain('q=off');
  await user.clear(screen.getByRole('searchbox', { name: 'Search channels' }));
  await pick(user, 'Device', 'Home');
  expect(screen.getByText('Home chat')).toBeInTheDocument();
  expect(screen.queryByText('Office')).toBeNull();
  await pick(user, 'Status', 'Turned off');
  expect(await screen.findByText('No channels match these filters.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByText('Office')).toBeInTheDocument();
});

test('the switch turns a channel off', async () => {
  server.use(http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [home] })));
  const bodies = captureJson('patch', `/api/v1/channels/${home.id}`, () =>
    HttpResponse.json({ ...home, enabled: false, disabled_reason: 'USER' }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await user.click(await screen.findByRole('switch', { name: 'Send alerts to Home chat' }));
  await vi.waitFor(() => expect(bodies).toEqual([{ enabled: false }]));
});

test('a failing channel explains itself and a test message is sent', async () => {
  const failing = channelFixture({ ...home, enabled: false, disabled_reason: 'TOO_MANY_FAILURES' });
  server.use(http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [failing] })));
  const sent = captureJson('post', `/api/v1/channels/${home.id}/test`, () =>
    HttpResponse.json(home),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  expect(await screen.findByRole('switch', { name: 'Send alerts to Home chat' })).toHaveAttribute(
    'data-disabled',
  );
  await expand(user, 'Home chat');
  expect(screen.getByText(/Send a test message to turn it back on/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send test' }));
  expect(await screen.findByText('Test message sent')).toBeInTheDocument();
  expect(sent).toHaveLength(1);
});

test('edit devices saves the chosen devices for the channel', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () =>
      HttpResponse.json({ items: [channelFixture({ ...home, device_ids: [homeDevice.id] })] }),
    ),
  );
  const bodies = captureJson('put', `/api/v1/channels/${home.id}/devices`, () =>
    HttpResponse.json({ device_ids: [homeDevice.id, dacha.id] }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await expand(user, 'Home chat');
  await user.click(screen.getByRole('button', { name: 'Edit devices' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByRole('searchbox', { name: 'Search devices' }), 'dach');
  expect(within(dialog).queryByRole('checkbox', { name: 'Home' })).toBeNull();
  await user.click(within(dialog).getByRole('checkbox', { name: 'Dacha' }));
  await user.click(within(dialog).getByRole('button', { name: 'Save channels' }));
  await vi.waitFor(() => expect(bodies).toEqual([{ device_ids: [homeDevice.id, dacha.id] }]));
  expect(await screen.findByText('Devices saved')).toBeInTheDocument();
});

test('bulk select turns several channels off', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [home, office] })),
  );
  const patched: string[] = [];
  server.use(
    http.patch(`${base}/api/v1/channels/:id`, ({ params }) => {
      patched.push(String(params.id));
      return HttpResponse.json(home);
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await user.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
  expect(screen.getByText('2 selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Turn off' }));
  await vi.waitFor(() => expect(patched.toSorted()).toEqual([home.id, office.id].toSorted()));
  expect(await screen.findByText('Channels updated')).toBeInTheDocument();
});

test('bulk turn on leaves failing channels alone and says how to turn them on', async () => {
  const off = channelFixture({ ...home, enabled: false, disabled_reason: 'USER' });
  const failing = channelFixture({
    ...office,
    enabled: false,
    disabled_reason: 'TOO_MANY_FAILURES',
  });
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [off, failing] })),
  );
  const patched: string[] = [];
  server.use(
    http.patch(`${base}/api/v1/channels/:id`, ({ params }) => {
      patched.push(String(params.id));
      return HttpResponse.json(home);
    }),
  );
  const succeeded = vi.spyOn(toast, 'success');
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Home chat');
  await user.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
  await user.click(screen.getByRole('button', { name: 'Turn on' }));
  expect(
    await screen.findByText('Send a test message to turn these back on: Office'),
  ).toBeInTheDocument();
  expect(patched).toEqual([off.id]);
  expect(screen.queryByText('2 selected')).toBeNull();
  expect(succeeded).not.toHaveBeenCalled();
  succeeded.mockRestore();
});

test('a webhook row shows the host, the events and the failures', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () =>
      HttpResponse.json({ items: [home, webhookFixture({ failures: 3 })] }),
    ),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  const row = (await screen.findByText('Automation')).closest('li') as HTMLElement;
  expect(within(row).getByText('Failures in a row: 3')).toBeInTheDocument();
  await expand(user, 'Automation');
  expect(
    within(row).getByText('hooks.example.com · device.offline, device.online'),
  ).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: 'Send test' })).toBeInTheDocument();
  const telegram = screen.getByText('Home chat').closest('li') as HTMLElement;
  expect(within(telegram).queryByText(/Failures in a row/)).toBeNull();
  await expand(user, 'Home chat');
  expect(within(telegram).queryByRole('button', { name: 'Delivery log' })).toBeNull();
  expect(within(telegram).queryByRole('button', { name: 'New secret' })).toBeNull();
});

test('a healthy webhook has no failure tag', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [webhookFixture()] })),
  );
  renderRoute('/notifications', { me: meFixture() });
  await screen.findByText('Automation');
  expect(screen.queryByText(/Failures in a row/)).toBeNull();
});

test('a failed webhook test says the receiver did not accept it', async () => {
  const hook = webhookFixture({ enabled: false, disabled_reason: 'TOO_MANY_FAILURES' });
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [hook] })),
    http.post(`${base}/api/v1/channels/${hook.id}/test`, () =>
      HttpResponse.json({ error: { code: 'conflict', message: 'x' } }, { status: 409 }),
    ),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await expand(user, 'Automation');
  expect(screen.getByText(/Send a test message to turn it back on/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send test' }));
  expect(await screen.findByText('The receiver did not accept the test.')).toBeInTheDocument();
});

test('edit devices drops a cancelled change and a stale search on reopen', async () => {
  let items = [channelFixture({ ...home, device_ids: [homeDevice.id] })];
  server.use(http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items })));
  const bodies = captureJson('put', `/api/v1/channels/${home.id}/devices`, () =>
    HttpResponse.json({ error: { code: 'internal', message: 'x' } }, { status: 500 }),
  );
  const { user, queryClient } = renderRoute('/notifications', { me: meFixture() });
  await expand(user, 'Home chat');
  await user.click(screen.getByRole('button', { name: 'Edit devices' }));
  let dialog = within(await screen.findByRole('dialog'));
  await user.click(dialog.getByRole('checkbox', { name: 'Dacha' }));
  await user.click(dialog.getByRole('button', { name: 'Save channels' }));
  expect(await dialog.findByRole('alert')).toBeInTheDocument();
  await user.type(dialog.getByRole('searchbox', { name: 'Search devices' }), 'dach');
  await user.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  items = [channelFixture({ ...home, device_ids: [dacha.id] })];
  await queryClient.invalidateQueries({ queryKey: ['channels'] });
  await user.click(screen.getByRole('button', { name: 'Edit devices' }));
  dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole('searchbox', { name: 'Search devices' })).toHaveValue('');
  expect(dialog.queryByRole('alert')).toBeNull();
  expect(dialog.getByRole('checkbox', { name: 'Home' })).not.toBeChecked();
  expect(dialog.getByRole('checkbox', { name: 'Dacha' })).toBeChecked();
  expect(bodies).toHaveLength(1);
});

test('rename starts from the current name after the webhook was edited', async () => {
  let items = [webhookFixture()];
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items })),
    http.patch(`${base}/api/v1/channels/${webhookFixture().id}`, () => {
      items = [webhookFixture({ name: 'Relay' })];
      return HttpResponse.json(items[0]);
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await expand(user, 'Automation');
  await user.click(screen.getByRole('button', { name: 'Edit webhook' }));
  const form = within(await screen.findByRole('dialog', { name: 'Edit webhook' }));
  await user.clear(form.getByRole('textbox', { name: 'Name' }));
  await user.type(form.getByRole('textbox', { name: 'Name' }), 'Relay');
  await user.click(form.getByRole('button', { name: 'Save' }));
  await screen.findByText('Relay');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Relay');
});
