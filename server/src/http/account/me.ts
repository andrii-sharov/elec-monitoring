import { eq } from 'drizzle-orm';
import { languageSchema, meDeleteSchema, mePatchSchema, meSchema, type Me } from '@elec/shared/api';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { verifyDummyPassword, verifyPassword } from '../../auth/password.ts';
import { appUser } from '../../db/schema/index.ts';
import { REAUTH_PER_USER } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { clearRefreshCookie } from '../cookies.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { getAuth, requireUser, type User } from '../auth/middleware.ts';
import { rateLimit } from '../rateLimit.ts';

export function toMe(user: User): Me {
  return {
    id: user.id,
    email: user.email,
    email_verified: user.emailVerifiedAt !== null,
    phone: user.phone,
    phone_verified: user.phoneVerifiedAt !== null,
    name: user.name,
    language: languageSchema.catch('uk').parse(user.language),
    timezone: user.timezone,
    has_password: user.passwordHash !== null,
    google_linked: user.googleSub !== null,
    is_admin: user.isAdmin,
  };
}

const REAUTH_WINDOW_MS = 300_000;

const bearer = [{ bearerAuth: [] }];
const unauthorized = errorResponse('Missing or invalid access token');
const meOk = { description: 'The profile', content: { 'application/json': { schema: meSchema } } };

export const mePaths: ZodOpenApiPathsObject = {
  '/api/v1/me': {
    get: {
      summary: 'Get the profile',
      security: bearer,
      responses: { '200': meOk, '401': unauthorized },
    },
    patch: {
      summary: 'Update name, language or timezone',
      security: bearer,
      requestBody: { content: { 'application/json': { schema: mePatchSchema } } },
      responses: {
        '200': meOk,
        '400': errorResponse('Invalid body'),
        '401': unauthorized,
      },
    },
    delete: {
      summary: 'Delete the account',
      description:
        'Needs `password` for accounts with one. A Google-only account must have signed in within the last 5 minutes.',
      security: bearer,
      requestBody: { content: { 'application/json': { schema: meDeleteSchema } } },
      responses: {
        '204': { description: 'Account deleted' },
        '401': unauthorized,
        '403': errorResponse('`invalid_credentials` or `reauth_required`'),
        '429': errorResponse('Too many requests, with `Retry-After`'),
      },
    },
  },
};

export function meRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, rateLimiter } = deps;

  router.get('/api/v1/me', requireUser(deps), (_req, res) => {
    res.json(toMe(getAuth(res).user));
  });

  router.patch('/api/v1/me', requireUser(deps), async (req, res) => {
    const { user } = getAuth(res);
    const changes = mePatchSchema.parse(req.body ?? {});
    if (Object.keys(changes).length === 0) {
      res.json(toMe(user));
      return;
    }
    const [updated] = await db
      .update(appUser)
      .set({ ...changes, updatedAt: clock.now() })
      .where(eq(appUser.id, user.id))
      .returning();
    res.json(toMe(updated ?? user));
  });

  router.delete(
    '/api/v1/me',
    requireUser(deps),
    rateLimit(rateLimiter, 'delete-account', { user: REAUTH_PER_USER }),
    async (req, res) => {
      const { user, sessionCreatedAt } = getAuth(res);
      const { password } = meDeleteSchema.parse(req.body ?? {});
      if (user.passwordHash) {
        const valid = password
          ? await verifyPassword(password, user.passwordHash)
          : await verifyDummyPassword('');
        if (!valid) throw new HttpError(403, 'invalid_credentials', 'Password is wrong');
      } else if (clock.now().getTime() - sessionCreatedAt.getTime() > REAUTH_WINDOW_MS) {
        throw new HttpError(403, 'reauth_required', 'Sign in again to delete the account');
      }
      await db.delete(appUser).where(eq(appUser.id, user.id));
      clearRefreshCookie(res);
      res.status(204).end();
    },
  );

  return router;
}
