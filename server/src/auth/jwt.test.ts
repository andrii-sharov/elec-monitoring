import { SignJWT, UnsecuredJWT, decodeJwt } from 'jose';
import { expect, test } from 'vitest';
import { FakeClock } from '../../test/fakes.ts';
import { ACCESS_TOKEN_TTL_S, signAccessToken, verifyAccessToken } from './jwt.ts';

const secret = 'x'.repeat(32);
const claims = { userId: '0198f2a0-0000-7000-8000-000000000001', sessionId: 'session-1' };

function setup() {
  return new FakeClock(new Date('2026-11-21T16:42:00Z'));
}

test('signs and verifies an access token', async () => {
  const clock = setup();
  const token = await signAccessToken(secret, clock, claims);
  expect(await verifyAccessToken(secret, clock, token)).toEqual(claims);
  const payload = decodeJwt(token);
  expect(payload.sub).toBe(claims.userId);
  expect(payload.sid).toBe(claims.sessionId);
  expect(payload.aud).toBe('access');
  expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(ACCESS_TOKEN_TTL_S);
  expect(ACCESS_TOKEN_TTL_S).toBe(900);
});

test('expires after 15 minutes on the injected clock', async () => {
  const clock = setup();
  const token = await signAccessToken(secret, clock, claims);
  clock.advance(899_000);
  expect(await verifyAccessToken(secret, clock, token)).toEqual(claims);
  clock.advance(1_000);
  expect(await verifyAccessToken(secret, clock, token)).toBeNull();
});

test('rejects wrong secret, tampering, alg none, wrong audience and garbage', async () => {
  const clock = setup();
  const nowS = Math.floor(clock.now().getTime() / 1000);
  const token = await signAccessToken(secret, clock, claims);
  expect(await verifyAccessToken('y'.repeat(32), clock, token)).toBeNull();

  const last = token.at(-1) === 'A' ? 'B' : 'A';
  expect(await verifyAccessToken(secret, clock, token.slice(0, -1) + last)).toBeNull();

  const unsecured = new UnsecuredJWT({ sid: 's' })
    .setSubject('u')
    .setAudience('access')
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + 900)
    .encode();
  expect(await verifyAccessToken(secret, clock, unsecured)).toBeNull();

  const oauth = await new SignJWT({ sid: 's' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u')
    .setAudience('oauth-state')
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + 900)
    .sign(new TextEncoder().encode(secret));
  expect(await verifyAccessToken(secret, clock, oauth)).toBeNull();

  expect(await verifyAccessToken(secret, clock, 'garbage')).toBeNull();
});
