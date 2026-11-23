import { screen } from '@testing-library/react';
import { act } from 'react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deviceFixture, meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { server } from '../../../test/server.ts';

const base = 'http://localhost:3000';
const deviceId = '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01';
const now = new Date('2026-11-21T18:42:00Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

function expiresIn(seconds: number) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function handlers(options: { expiresInS?: number } = {}) {
  const calls = { create: 0, get: 0, renew: 0, state: 'PENDING' as 'PENDING' | 'ONLINE' };
  const createBody = vi.fn<(body: unknown) => void>();
  server.use(
    http.post(`${base}/api/v1/devices`, async ({ request }) => {
      calls.create += 1;
      createBody(await request.json());
      return HttpResponse.json(
        {
          device: deviceFixture({
            id: deviceId,
            name: 'Home',
            state: 'PENDING',
            last_seen_at: null,
          }),
          pairing_code: 'K7Q2M9XD',
          pairing_code_expires_at: expiresIn(options.expiresInS ?? 1800),
        },
        { status: 201 },
      );
    }),
    http.get(`${base}/api/v1/devices/${deviceId}`, () => {
      calls.get += 1;
      return HttpResponse.json(deviceFixture({ id: deviceId, state: calls.state }));
    }),
    http.post(`${base}/api/v1/devices/${deviceId}/pairing-code`, () => {
      calls.renew += 1;
      return HttpResponse.json({
        pairing_code: 'A1B2C3D4',
        pairing_code_expires_at: expiresIn(3600),
      });
    }),
  );
  return { calls, createBody };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function createHome(user: ReturnType<typeof renderRoute>['user']) {
  await user.type(await screen.findByLabelText('Name'), 'Home');
  await user.click(screen.getByRole('button', { name: 'Create' }));
}

test('empty name shows an inline error and sends nothing', async () => {
  const { calls } = handlers();
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await user.click(await screen.findByRole('button', { name: 'Create' }));
  expect(await screen.findByText('Required')).toBeInTheDocument();
  expect(calls.create).toBe(0);
});

test('a 65 character name shows an error and sends nothing', async () => {
  const { calls } = handlers();
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await user.type(await screen.findByLabelText('Name'), 'a'.repeat(65));
  await user.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText('At most 64 characters')).toBeInTheDocument();
  expect(calls.create).toBe(0);
});

test('create shows the grouped code, polls while pending and finishes when online', async () => {
  const { calls, createBody } = handlers();
  const { user, queryClient } = renderRoute('/devices/new', { me: meFixture() });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  await createHome(user);
  expect(await screen.findByText('K7Q2 M9XD')).toBeInTheDocument();
  expect(createBody).toHaveBeenCalledWith({ name: 'Home' });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['devices'] });
  expect(screen.getByText(/Expires in 30 min/)).toBeInTheDocument();

  await advance(3100);
  expect(screen.getByText('K7Q2 M9XD')).toBeInTheDocument();
  expect(screen.getByText('Waiting for the device to connect…')).toBeInTheDocument();

  calls.state = 'ONLINE';
  await advance(3100);
  expect(await screen.findByText('The device is online')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open device' })).toHaveAttribute(
    'href',
    `/devices/${deviceId}`,
  );
  const before = calls.get;
  await advance(10_000);
  expect(calls.get).toBe(before);
});

test('the copy button copies the code without spaces', async () => {
  handlers();
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await createHome(user);
  await screen.findByText('K7Q2 M9XD');
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await navigator.clipboard.readText()).toBe('K7Q2M9XD');
  expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

test('an expired code hides the code, stops polling, and a new code resumes it', async () => {
  const { calls } = handlers({ expiresInS: 20 });
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await createHome(user);
  await screen.findByText('K7Q2 M9XD');

  await advance(21_000);
  expect(screen.queryByText('K7Q2 M9XD')).toBeNull();
  const renew = await screen.findByRole('button', { name: 'Get a new code' });
  await advance(100);
  const before = calls.get;
  await advance(10_000);
  expect(calls.get).toBe(before);

  await user.click(renew);
  expect(await screen.findByText('A1B2 C3D4')).toBeInTheDocument();
  expect(calls.renew).toBe(1);
  await advance(3100);
  expect(calls.get).toBeGreaterThan(before);
});

test('409 on create shows the device limit message', async () => {
  server.use(
    http.post(`${base}/api/v1/devices`, () =>
      HttpResponse.json({ error: { code: 'conflict', message: 'x' } }, { status: 409 }),
    ),
  );
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await createHome(user);
  expect(await screen.findByText('You can have up to 20 devices')).toBeInTheDocument();
});

test('a device that claims the code at expiry shows done, not the expired state', async () => {
  const { calls } = handlers({ expiresInS: 20 });
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await createHome(user);
  await screen.findByText('K7Q2 M9XD');
  await advance(19_000);
  calls.state = 'ONLINE';
  await advance(1500);
  expect(await screen.findByText('The device is online')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Get a new code' })).toBeNull();
});

test('a poll error is shown instead of waiting forever', async () => {
  handlers();
  server.use(
    http.get(`${base}/api/v1/devices/${deviceId}`, () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 }),
    ),
  );
  const { user } = renderRoute('/devices/new', { me: meFixture() });
  await createHome(user);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Waiting for the device to connect…')).toBeNull();
});
