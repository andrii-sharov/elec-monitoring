import { expect, test } from 'vitest';
import { testConfig } from '../../test/app.ts';
import { FakeClock } from '../../test/fakes.ts';
import { signAccessToken } from './jwt.ts';
import { createGoogleClient, signOAuthState, verifyOAuthState, type OAuthState } from './google.ts';

const secret = testConfig.jwtSecret;
const state: OAuthState = {
  state: 'state-1',
  codeVerifier: 'verifier-1',
  app: 'ADMIN',
  intent: 'LINK',
  userId: 'user-1',
};

function clock() {
  return new FakeClock(new Date('2026-11-21T16:42:00Z'));
}

test('OAuth state round-trips', async () => {
  const c = clock();
  const token = await signOAuthState(secret, c, state);
  expect(await verifyOAuthState(secret, c, token)).toEqual(state);
});

test('OAuth state without a user round-trips', async () => {
  const c = clock();
  const { userId: _userId, ...login } = state;
  const token = await signOAuthState(secret, c, { ...login, intent: 'LOGIN' });
  expect(await verifyOAuthState(secret, c, token)).toEqual({ ...login, intent: 'LOGIN' });
});

test('OAuth state expires after 600 s', async () => {
  const c = clock();
  const token = await signOAuthState(secret, c, state);
  c.advance(599_000);
  expect(await verifyOAuthState(secret, c, token)).not.toBeNull();
  c.advance(1_000);
  expect(await verifyOAuthState(secret, c, token)).toBeNull();
});

test('access tokens and OAuth state are not interchangeable', async () => {
  const c = clock();
  const access = await signAccessToken(secret, c, { userId: 'u', sessionId: 's' });
  expect(await verifyOAuthState(secret, c, access)).toBeNull();
  const oauth = await signOAuthState(secret, c, state);
  const { verifyAccessToken } = await import('./jwt.ts');
  expect(await verifyAccessToken(secret, c, oauth)).toBeNull();
  expect(await verifyOAuthState(secret, c, 'garbage')).toBeNull();
});

test('authorizationUrl targets Google with PKCE and the callback', () => {
  const url = createGoogleClient(testConfig).authorizationUrl('s', 'v');
  expect(url.host).toBe('accounts.google.com');
  expect(url.searchParams.get('state')).toBe('s');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe('https://api.test/api/auth/google/callback');
  expect(url.searchParams.get('scope')).toContain('email');
});
