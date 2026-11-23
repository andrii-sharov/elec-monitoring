import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startGoogle, takeGoogleState } from './google.ts';

const assign = vi.fn<(url: string) => void>();

beforeEach(() => {
  vi.stubGlobal('location', { assign });
});

afterEach(() => {
  assign.mockReset();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

test('startGoogle stores the state and navigates to the API', () => {
  startGoogle('LOGIN', '/devices/d1');
  expect(assign).toHaveBeenCalledWith(
    'http://localhost:3000/api/auth/google?app=CLIENT&intent=LOGIN',
  );
  expect(takeGoogleState()).toEqual({ intent: 'LOGIN', next: '/devices/d1' });
});

test('takeGoogleState consumes the state', () => {
  startGoogle('LINK');
  expect(takeGoogleState()).toEqual({ intent: 'LINK', next: '/account' });
  expect(takeGoogleState()).toBeNull();
});

test('an unsafe next falls back to /devices', () => {
  sessionStorage.setItem('em.google', JSON.stringify({ intent: 'LOGIN', next: '//evil.example' }));
  expect(takeGoogleState()).toEqual({ intent: 'LOGIN', next: '/devices' });
});

test('garbage state is ignored', () => {
  sessionStorage.setItem('em.google', 'not json');
  expect(takeGoogleState()).toBeNull();
});
