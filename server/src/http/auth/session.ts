import { loginBodySchema, sessionSchema } from '@elec/shared/api';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { ACCESS_TOKEN_TTL_S, signAccessToken } from '../../auth/jwt.ts';
import { verifyDummyPassword, verifyPassword } from '../../auth/password.ts';
import {
  createSession,
  revokeSessionByToken,
  revokeUserSessions,
  rotateRefreshToken,
} from '../../auth/sessions.ts';
import { appUser } from '../../db/schema/index.ts';
import { AUTH_PER_IP, LOGIN_PER_EMAIL } from '../../rateLimit/limiter.ts';
import { toMe } from '../account/me.ts';
import type { AppDeps } from '../app.ts';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../cookies.ts';
import { requireAppOrigin } from '../cors.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { getAuth, requireUser, type User } from './middleware.ts';

const rateLimited = errorResponse('Too many requests, with `Retry-After`');
const sessionOk = {
  description: 'Signed in. Sets the `em_refresh` cookie',
  content: { 'application/json': { schema: sessionSchema } },
};

export const sessionPaths: ZodOpenApiPathsObject = {
  '/api/auth/login': {
    post: {
      summary: 'Log in with an email or a phone, and a password',
      requestBody: { content: { 'application/json': { schema: loginBodySchema } } },
      responses: {
        '200': sessionOk,
        '400': errorResponse('Invalid body'),
        '401': errorResponse('Wrong email, phone or password (`invalid_credentials`)'),
        '429': rateLimited,
      },
    },
  },
  '/api/auth/refresh': {
    post: {
      summary: 'Rotate the refresh cookie and get a new access token',
      description: 'Needs the `em_refresh` cookie and an `Origin` of the client or admin app.',
      responses: {
        '200': sessionOk,
        '401': errorResponse('Missing, unknown, expired or revoked cookie, or reuse after 10 s'),
        '403': errorResponse('Foreign or missing `Origin`'),
        '409': errorResponse('The cookie was used less than 10 s ago. Retry once'),
        '429': rateLimited,
      },
    },
  },
  '/api/auth/logout': {
    post: {
      summary: 'Log out this session',
      responses: {
        '204': { description: 'Session ended, cookie cleared' },
        '403': errorResponse('Foreign or missing `Origin`'),
        '429': rateLimited,
      },
    },
  },
  '/api/auth/logout-all': {
    post: {
      summary: 'Log out every session of the user',
      security: [{ bearerAuth: [] }],
      responses: {
        '204': { description: 'All sessions revoked' },
        '401': errorResponse('Missing or invalid access token'),
        '429': rateLimited,
      },
    },
  },
};

export async function issueSession(
  res: Response,
  deps: Pick<AppDeps, 'clock' | 'config'>,
  user: User,
  sessionId: string,
  refreshToken: string,
): Promise<void> {
  const accessToken = await signAccessToken(deps.config.jwtSecret, deps.clock, {
    userId: user.id,
    sessionId,
  });
  setRefreshCookie(res, refreshToken);
  res.status(200).json({
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_S,
    user: toMe(user),
  });
}

export function sessionRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, config, rateLimiter } = deps;
  const ipLimit = (name: string) => rateLimit(rateLimiter, name, { ip: AUTH_PER_IP });
  const appOrigin = requireAppOrigin(config.urls);

  router.post(
    '/api/auth/login',
    rateLimit(rateLimiter, 'login', {
      ip: AUTH_PER_IP,
      email: LOGIN_PER_EMAIL,
      phone: LOGIN_PER_EMAIL,
    }),
    async (req, res) => {
      const body = loginBodySchema.parse(req.body);
      const { password } = body;
      const [user] = await db
        .select()
        .from(appUser)
        .where('phone' in body ? eq(appUser.phone, body.phone) : eq(appUser.email, body.email));
      const valid = user?.passwordHash
        ? await verifyPassword(password, user.passwordHash)
        : await verifyDummyPassword(password);
      if (!user || !valid) {
        throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
      }
      const created = await createSession(db, clock, user.id);
      await issueSession(res, deps, user, created.sessionId, created.refreshToken);
    },
  );

  router.post('/api/auth/refresh', appOrigin, ipLimit('refresh'), async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw new HttpError(401, 'unauthorized', 'Unauthorized');
    const result = await rotateRefreshToken(db, clock, token);
    if (!result.ok) {
      if (result.reason === 'racing') {
        throw new HttpError(409, 'conflict', 'The session was just refreshed. Retry once');
      }
      clearRefreshCookie(res);
      throw new HttpError(401, 'unauthorized', 'Unauthorized');
    }
    const [user] = await db.select().from(appUser).where(eq(appUser.id, result.userId));
    if (!user) throw new HttpError(401, 'unauthorized', 'Unauthorized');
    await issueSession(res, deps, user, result.sessionId, result.refreshToken);
  });

  router.post('/api/auth/logout', appOrigin, ipLimit('logout'), async (req, res) => {
    const token = readRefreshCookie(req);
    if (token) await revokeSessionByToken(db, clock, token);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.post(
    '/api/auth/logout-all',
    requireUser(deps),
    ipLimit('logout-all'),
    async (_req, res) => {
      await revokeUserSessions(db, clock, getAuth(res).user.id);
      clearRefreshCookie(res);
      res.status(204).end();
    },
  );

  return router;
}
