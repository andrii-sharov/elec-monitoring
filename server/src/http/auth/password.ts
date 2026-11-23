import {
  changePasswordBodySchema,
  forgotBodySchema,
  languageSchema,
  resetBodySchema,
} from '@elec/shared/api';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  consumeOneTimeToken,
  expireOneTimeTokens,
  issueOneTimeToken,
} from '../../auth/oneTimeTokens.ts';
import { hashPassword, verifyPassword } from '../../auth/password.ts';
import { revokeUserSessions } from '../../auth/sessions.ts';
import { appUser } from '../../db/schema/index.ts';
import { sendInBackground } from '../../email/sender.ts';
import { renderEmail } from '../../email/templates.ts';
import { createI18n } from '../../i18n.ts';
import { AUTH_PER_IP, EMAIL_SEND, REAUTH_PER_USER } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { getAuth, requireUser } from './middleware.ts';

const rateLimited = errorResponse('Too many requests, with `Retry-After`');
const validation = errorResponse('Invalid body');

export const passwordPaths: ZodOpenApiPathsObject = {
  '/api/auth/forgot-password': {
    post: {
      summary: 'Request a password reset email',
      description: 'Always answers `204`, whether or not the email is registered.',
      requestBody: { content: { 'application/json': { schema: forgotBodySchema } } },
      responses: {
        '204': { description: 'Accepted' },
        '400': validation,
        '429': rateLimited,
      },
    },
  },
  '/api/auth/reset-password': {
    post: {
      summary: 'Set a new password with the emailed token',
      description: 'Verifies the email, and ends every session of the user.',
      requestBody: { content: { 'application/json': { schema: resetBodySchema } } },
      responses: {
        '204': { description: 'Password changed' },
        '400': validation,
        '410': errorResponse('The token is unknown, used, expired or for another purpose'),
        '429': rateLimited,
      },
    },
  },
  '/api/auth/change-password': {
    post: {
      summary: 'Change the password of the signed-in user',
      description: 'Ends every other session.',
      security: [{ bearerAuth: [] }],
      requestBody: { content: { 'application/json': { schema: changePasswordBodySchema } } },
      responses: {
        '204': { description: 'Password changed' },
        '400': validation,
        '401': errorResponse('Missing or invalid access token'),
        '403': errorResponse('Wrong current password (`invalid_credentials`)'),
        '409': errorResponse('The account has no password'),
        '429': rateLimited,
      },
    },
  },
};

export function passwordRouter(deps: AppDeps): Router {
  const router = Router();
  const i18n = createI18n();
  const { db, clock, logger, config, rateLimiter } = deps;

  router.post(
    '/api/auth/forgot-password',
    rateLimit(rateLimiter, 'forgot-password', { ip: AUTH_PER_IP, email: EMAIL_SEND }),
    async (req, res) => {
      const { email } = forgotBodySchema.parse(req.body);
      const [user] = await db.select().from(appUser).where(eq(appUser.email, email));
      if (!user) {
        res.status(204).end();
        return;
      }
      const token = await issueOneTimeToken(db, clock, user.id, 'RESET_PASSWORD');
      res.status(204).end();
      const rendered = renderEmail(i18n, 'resetPassword', {
        lang: languageSchema.catch('uk').parse(user.language),
        name: user.name,
        link: `${config.urls.client}/reset-password?token=${token}`,
      });
      sendInBackground(deps.email, logger, { to: user.email, ...rendered });
    },
  );

  router.post(
    '/api/auth/reset-password',
    rateLimit(rateLimiter, 'reset-password', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const { token, password } = resetBodySchema.parse(req.body);
      const passwordHash = await hashPassword(password);
      const reset = await db.transaction(async (tx) => {
        const userId = await consumeOneTimeToken(tx, clock, token, 'RESET_PASSWORD');
        if (!userId) return false;
        await tx
          .update(appUser)
          .set({
            passwordHash,
            emailVerifiedAt: sql`coalesce(${appUser.emailVerifiedAt}, ${clock.now().toISOString()}::timestamptz)`,
          })
          .where(eq(appUser.id, userId));
        await expireOneTimeTokens(tx, clock, userId, 'RESET_PASSWORD');
        await revokeUserSessions(tx, clock, userId);
        return true;
      });
      if (!reset) throw new HttpError(410, 'expired', 'The link is invalid or has expired');
      res.status(204).end();
    },
  );

  router.post(
    '/api/auth/change-password',
    requireUser(deps),
    rateLimit(rateLimiter, 'change-password', { user: REAUTH_PER_USER }),
    async (req, res) => {
      const body = changePasswordBodySchema.parse(req.body);
      const { user, sessionId } = getAuth(res);
      if (!user.passwordHash) {
        throw new HttpError(409, 'conflict', 'The account has no password');
      }
      if (!(await verifyPassword(body.current_password, user.passwordHash))) {
        throw new HttpError(403, 'invalid_credentials', 'Current password is wrong');
      }
      const passwordHash = await hashPassword(body.new_password);
      await db.transaction(async (tx) => {
        await tx.update(appUser).set({ passwordHash }).where(eq(appUser.id, user.id));
        await revokeUserSessions(tx, clock, user.id, sessionId);
      });
      res.status(204).end();
    },
  );

  return router;
}
