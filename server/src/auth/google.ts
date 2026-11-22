import { appTargets, googleIntents, type AppTarget, type GoogleIntent } from '@elec/shared';
import { Google, decodeIdToken } from 'arctic';
import { SignJWT, jwtVerify } from 'jose';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import { keyFor } from './jwt.ts';

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

export interface GoogleClient {
  authorizationUrl(state: string, codeVerifier: string): URL;
  exchange(code: string, codeVerifier: string): Promise<GoogleIdentity>;
}

const SCOPES = ['openid', 'email', 'profile'];
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const STATE_AUDIENCE = 'oauth-state';
const STATE_TTL_S = 600;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createGoogleClient(config: Config): GoogleClient {
  const google = new Google(
    config.google.clientId,
    config.google.clientSecret,
    `${config.urls.api}/api/auth/google/callback`,
  );
  return {
    authorizationUrl: (state, codeVerifier) =>
      google.createAuthorizationURL(state, codeVerifier, SCOPES),
    async exchange(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audience.includes(config.google.clientId)) throw new Error('Wrong ID token audience');
      if (!ISSUERS.has(String(claims.iss))) throw new Error('Wrong ID token issuer');
      const sub = asString(claims.sub);
      const email = asString(claims.email);
      if (!sub || !email) throw new Error('ID token has no subject or email');
      return {
        sub,
        email: email.toLowerCase(),
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        name: asString(claims.name),
      };
    },
  };
}

export type OAuthState = {
  state: string;
  codeVerifier: string;
  app: AppTarget;
  intent: GoogleIntent;
  userId?: string;
};

export async function signOAuthState(
  secret: string,
  clock: Clock,
  value: OAuthState,
): Promise<string> {
  const nowS = Math.floor(clock.now().getTime() / 1000);
  return new SignJWT({
    st: value.state,
    cv: value.codeVerifier,
    app: value.app,
    intent: value.intent,
    uid: value.userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + STATE_TTL_S)
    .sign(keyFor(secret));
}

export async function verifyOAuthState(
  secret: string,
  clock: Clock,
  token: string,
): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      algorithms: ['HS256'],
      audience: STATE_AUDIENCE,
      currentDate: clock.now(),
    });
    const app = appTargets.find((target) => target === payload.app);
    const intent = googleIntents.find((value) => value === payload.intent);
    if (typeof payload.st !== 'string' || typeof payload.cv !== 'string' || !app || !intent) {
      return null;
    }
    const base = { state: payload.st, codeVerifier: payload.cv, app, intent };
    return typeof payload.uid === 'string' ? { ...base, userId: payload.uid } : base;
  } catch {
    return null;
  }
}
