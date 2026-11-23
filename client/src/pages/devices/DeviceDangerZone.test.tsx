import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const id = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-21T18:42:00Z'));
  server.use(
    http.get(`${base}/api/v1/devices/${id}`, () => HttpResponse.json(deviceFixture())),
    http.get(`${base}/api/v1/devices/${id}/outages`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get(`${base}/api/v1/devices`, () => HttpResponse.json({ items: [] })),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderOwner() {
  const view = renderRoute(`/devices/${id}`, { me: meFixture() });
  await screen.findByRole('button', { name: 'Delete device' });
  return view;
}

test('delete asks for confirmation, sends DELETE and goes to the list', async () => {
  const deleted = vi.fn<() => void>();
  server.use(
    http.delete(`${base}/api/v1/devices/${id}`, () => {
      deleted();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, router } = await renderOwner();
  await user.click(screen.getByRole('button', { name: 'Delete device' }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete device' }),
  );
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
  expect(deleted).toHaveBeenCalledOnce();
});

test('cancelling the delete dialog sends nothing', async () => {
  const deleted = vi.fn<() => void>();
  server.use(
    http.delete(`${base}/api/v1/devices/${id}`, () => {
      deleted();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, router } = await renderOwner();
  await user.click(screen.getByRole('button', { name: 'Delete device' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
  expect(deleted).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe(`/devices/${id}`);
});

test('rotate token confirms, sends the request and says so', async () => {
  const rotated = vi.fn<() => void>();
  server.use(
    http.post(`${base}/api/v1/devices/${id}/rotate-token`, () => {
      rotated();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user } = await renderOwner();
  await user.click(screen.getByRole('button', { name: 'Rotate token' }));
  const dialog = screen.getByRole('alertdialog');
  expect(
    within(dialog).getByText('The device stops checking in until you pair it again.'),
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Rotate token' }));
  expect(await screen.findByText('Token rotated. Pair the device again.')).toBeInTheDocument();
  expect(rotated).toHaveBeenCalledOnce();
});

test('re-pair shows the new code', async () => {
  server.use(
    http.post(`${base}/api/v1/devices/${id}/pairing-code`, () =>
      HttpResponse.json(
        { pairing_code: 'K7Q2M9XD', pairing_code_expires_at: '2026-11-21T19:12:00Z' },
        { status: 201 },
      ),
    ),
  );
  const { user } = await renderOwner();
  await user.click(screen.getByRole('button', { name: 'Re-pair' }));
  expect(await screen.findByLabelText('Pairing code')).toHaveTextContent('K7Q2 M9XD');
});
