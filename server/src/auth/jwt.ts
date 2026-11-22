import { SignJWT, jwtVerify } from 'jose';
import type { Clock } from '../clock.ts';

export const ACCESS_TOKEN_TTL_S = 900;

const AUDIENCE = 'access';

export type AccessClaims = { userId: string; sessionId: string };

const keys = new Map<string, Uint8Array>();

export function keyFor(secret: string): Uint8Array {
  let key = keys.get(secret);
  if (!key) {
    key = new TextEncoder().encode(secret);
    keys.set(secret, key);
  }
  return key;
}

export async function signAccessToken(
  secret: string,
  clock: Clock,
  claims: AccessClaims,
): Promise<string> {
  const nowS = Math.floor(clock.now().getTime() / 1000);
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + ACCESS_TOKEN_TTL_S)
    .sign(keyFor(secret));
}

export async function verifyAccessToken(
  secret: string,
  clock: Clock,
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      currentDate: clock.now(),
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
