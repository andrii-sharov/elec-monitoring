import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { deviceFixture, meFixture, webhookFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const hook = webhookFixture();

beforeEach(() => {
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [deviceFixture()] })),
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [hook] })),
  );
});

type User = ReturnType<typeof renderRoute>['user'];

async function openCreate(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Add channel' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Webhook' }));
  return within(await screen.findByRole('dialog', { name: 'Add a webhook' }));
}

async function fill(user: User, form: ReturnType<typeof within>, url: string) {
  await user.type(form.getByRole('textbox', { name: 'Name' }), 'Automation');
  await user.type(form.getByRole('textbox', { name: 'URL' }), url);
}

function captureCreate(response: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${base}/api/v1/channels`, async ({ request }) => {
      bodies.push(await request.json());
      return response();
    }),
  );
  return bodies;
}

test('an http URL is rejected before anything is sent', async () => {
  const bodies = captureCreate(() => HttpResponse.json({}, { status: 500 }));
  const { user } = renderRoute('/notifications', { me: meFixture() });
  const form = await openCreate(user);
  await fill(user, form, 'http://hooks.example.com/elec');
  await user.click(form.getByRole('button', { name: 'Add webhook' }));
  expect(await form.findByText('Enter an address that starts with https://')).toBeInTheDocument();
  expect(form.getByRole('textbox', { name: 'URL' })).toHaveAttribute('aria-invalid', 'true');
  expect(bodies).toEqual([]);
});

test('at least one event has to be chosen', async () => {
  const bodies = captureCreate(() => HttpResponse.json({}, { status: 500 }));
  const { user } = renderRoute('/notifications', { me: meFixture() });
  const form = await openCreate(user);
  await fill(user, form, 'https://hooks.example.com/elec');
  for (const name of ['device.offline', 'device.online', 'device.power_blip']) {
    await user.click(form.getByRole('checkbox', { name }));
  }
  await user.click(form.getByRole('button', { name: 'Add webhook' }));
  expect(await form.findByText('Choose at least one event.')).toBeInTheDocument();
  expect(bodies).toEqual([]);
});

test('create sends the chosen events', async () => {
  const bodies = captureCreate(() =>
    HttpResponse.json({ ...hook, secret: 'whsec_created' }, { status: 201 }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  const form = await openCreate(user);
  await fill(user, form, 'https://hooks.example.com/elec');
  await user.click(form.getByRole('checkbox', { name: 'device.online' }));
  await user.click(form.getByRole('button', { name: 'Add webhook' }));
  expect(await screen.findByText('whsec_created')).toBeInTheDocument();
  expect(bodies).toEqual([
    {
      type: 'WEBHOOK',
      name: 'Automation',
      url: 'https://hooks.example.com/elec',
      events: ['device.offline', 'device.power_blip'],
    },
  ]);
  expect(screen.queryByRole('dialog', { name: 'Add a webhook' })).toBeNull();
});

test.each([
  ['url_not_allowed', 400, 'This address is not allowed. Use a public https URL.'],
  ['conflict', 409, 'You already have the most webhooks allowed: 10.'],
])('a server %s error is translated', async (code, status, message) => {
  captureCreate(() => HttpResponse.json({ error: { code, message: 'x' } }, { status }));
  const { user } = renderRoute('/notifications', { me: meFixture() });
  const form = await openCreate(user);
  await fill(user, form, 'https://hooks.example.com/elec');
  await user.click(form.getByRole('button', { name: 'Add webhook' }));
  expect(await form.findByText(message)).toBeInTheDocument();
  expect(form.getByRole('textbox', { name: 'URL' }).getAttribute('aria-invalid')).toBe(
    code === 'url_not_allowed' ? 'true' : null,
  );
});

test('edit starts from the current webhook and saves the changes', async () => {
  const bodies: unknown[] = [];
  server.use(
    http.patch(`${base}/api/v1/channels/${hook.id}`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(hook);
    }),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Details for Automation' }));
  await user.click(screen.getByRole('button', { name: 'Edit webhook' }));
  const form = within(await screen.findByRole('dialog', { name: 'Edit webhook' }));
  const url = form.getByRole('textbox', { name: 'URL' });
  expect(url).toHaveValue('https://hooks.example.com/elec');
  expect(form.getByRole('checkbox', { name: 'device.offline' })).toBeChecked();
  expect(form.getByRole('checkbox', { name: 'device.power_blip' })).not.toBeChecked();
  await user.clear(url);
  await user.type(url, 'https://hooks.example.com/new');
  await user.click(form.getByRole('checkbox', { name: 'device.power_blip' }));
  await user.click(form.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Webhook saved')).toBeInTheDocument();
  expect(bodies).toEqual([
    {
      name: 'Automation',
      url: 'https://hooks.example.com/new',
      events: ['device.offline', 'device.online', 'device.power_blip'],
    },
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the add form links to the webhook guide', async () => {
  const { user, router } = renderRoute('/notifications', { me: meFixture() });
  const form = await openCreate(user);
  await user.click(form.getByRole('link', { name: 'How to connect a webhook' }));
  expect(router.state.location.pathname).toBe('/notifications/webhooks/guide');
});
