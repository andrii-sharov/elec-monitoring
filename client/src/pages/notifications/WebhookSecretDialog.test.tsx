import { screen, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture, webhookFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const hook = webhookFixture();
const secret = 'whsec_only_once';

beforeEach(() => {
  server.use(
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [deviceFixture()] })),
  );
});

function cached(queryClient: QueryClient) {
  return JSON.stringify([
    queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
  ]);
}

function occurrences() {
  return document.documentElement.innerHTML.split(secret).length - 1;
}

test('after create the secret shows once, then the device picker opens', async () => {
  let items = [] as (typeof hook)[];
  const picked: unknown[] = [];
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items })),
    http.post(`${base}/api/v1/channels`, () => {
      items = [hook];
      return HttpResponse.json({ ...hook, secret }, { status: 201 });
    }),
    http.put(`${base}/api/v1/channels/${hook.id}/devices`, async ({ request }) => {
      picked.push(await request.json());
      return HttpResponse.json({ device_ids: [deviceFixture().id] });
    }),
  );
  const { user, router, queryClient } = renderRoute('/notifications', { me: meFixture() });
  const copy = vi.spyOn(navigator.clipboard, 'writeText');
  await user.click(await screen.findByRole('button', { name: 'Add channel' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Webhook' }));
  const form = within(await screen.findByRole('dialog', { name: 'Add a webhook' }));
  await user.type(form.getByRole('textbox', { name: 'Name' }), 'Automation');
  await user.type(form.getByRole('textbox', { name: 'URL' }), 'https://hooks.example.com/elec');
  await user.click(form.getByRole('button', { name: 'Add webhook' }));

  const dialog = within(await screen.findByRole('dialog', { name: 'Signing secret' }));
  expect(dialog.getByText(secret)).toBeInTheDocument();
  expect(dialog.getByText(/shown only once/)).toBeInTheDocument();
  expect(occurrences()).toBe(1);
  await user.click(dialog.getByRole('button', { name: 'Copy' }));
  expect(copy).toHaveBeenCalledWith(secret);
  expect(await dialog.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(cached(queryClient)).not.toContain(secret);
  expect(JSON.stringify({ ...localStorage })).not.toContain(secret);
  expect(JSON.stringify(router.state.location)).not.toContain(secret);

  await user.click(dialog.getByRole('button', { name: 'Done' }));
  const picker = within(await screen.findByRole('dialog', { name: 'Devices for Automation' }));
  expect(occurrences()).toBe(0);
  expect(cached(queryClient)).not.toContain(secret);
  await user.click(picker.getByRole('checkbox', { name: 'Home' }));
  await user.click(picker.getByRole('button', { name: 'Save channels' }));
  await vi.waitFor(() => expect(picked).toEqual([{ device_ids: [deviceFixture().id] }]));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('rotate asks first, then shows the new secret without keeping it', async () => {
  const rotate = vi.fn<() => void>();
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [hook] })),
    http.post(`${base}/api/v1/channels/${hook.id}/rotate-secret`, () => {
      rotate();
      return HttpResponse.json({ ...hook, secret });
    }),
  );
  const { user, queryClient } = renderRoute('/notifications', { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Details for Automation' }));
  await user.click(screen.getByRole('button', { name: 'New secret' }));
  const confirm = within(screen.getByRole('alertdialog'));
  expect(rotate).not.toHaveBeenCalled();
  await user.click(confirm.getByRole('button', { name: 'New secret' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Signing secret' }));
  expect(dialog.getByText(secret)).toBeInTheDocument();
  expect(rotate).toHaveBeenCalledOnce();
  expect(cached(queryClient)).not.toContain(secret);
  await user.click(dialog.getByRole('button', { name: 'Done' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(occurrences()).toBe(0);
});

test('a click outside does not lose the secret', async () => {
  server.use(
    http.get(`${base}/api/v1/channels`, () => HttpResponse.json({ items: [hook] })),
    http.post(`${base}/api/v1/channels/${hook.id}/rotate-secret`, () =>
      HttpResponse.json({ ...hook, secret }),
    ),
  );
  const { user } = renderRoute('/notifications', { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Details for Automation' }));
  await user.click(screen.getByRole('button', { name: 'New secret' }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'New secret' }),
  );
  await screen.findByRole('dialog', { name: 'Signing secret' });
  await user.click(document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement);
  expect(screen.getByText(secret)).toBeInTheDocument();
});
