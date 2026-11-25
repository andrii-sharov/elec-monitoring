import { languageSchema, signupBodySchema, tokenBodySchema } from '@elec/shared/api';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { consumeOneTimeToken, issueOneTimeToken } from '../../auth/oneTimeTokens.ts';
import { hashPassword } from '../../auth/password.ts';
import { appUser } from '../../db/schema/index.ts';
import { sendInBackground } from '../../email/sender.ts';
import { renderEmail, type EmailKind } from '../../email/templates.ts';
import { createI18n } from '../../i18n.ts';
import { applyPendingInvites } from '../../sharing/invites.ts';
import { AUTH_PER_IP, EMAIL_SEND } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { getAuth, requireUser } from './middleware.ts';

const rateLimited = errorResponse('Too many requests, with `Retry-After`');
const validation = errorResponse('Invalid body');

export const signupPaths: ZodOpenApiPathsObject = {
  '/api/auth/signup': {
    post: {
      summary: 'Sign up with email and password',
      description:
        'Always answers `201` with no body, whether or not the email is already registered. The user must verify the email, then log in.',
      requestBody: { content: { 'application/json': { schema: signupBodySchema } } },
      responses: {
        '201': { description: 'Verification email queued (or an account-exists email)' },
        '400': validation,
        '429': rateLimited,
      },
    },
  },
  '/api/auth/verify-email': {
    post: {
      summary: 'Verify an email address with the link token',
      requestBody: { content: { 'application/json': { schema: tokenBodySchema } } },
      responses: {
        '204': { description: 'Email verified' },
        '400': validation,
        '410': errorResponse('The token is unknown, used, expired or for another purpose'),
        '429': rateLimited,
      },
    },
  },
  '/api/auth/resend-verification': {
    post: {
      summary: 'Send a new verification email',
      security: [{ bearerAuth: [] }],
      responses: {
        '204': { description: 'Sent, or the address is already verified' },
        '401': errorResponse('Missing or invalid access token'),
        '429': rateLimited,
      },
    },
  },
};

export function signupRouter(deps: AppDeps): Router {
  const router = Router();
  const i18n = createI18n();
  const { db, clock, logger, config, rateLimiter } = deps;
  const link = (path: string, token?: string) =>
    `${config.urls.client}${path}${token ? `?token=${token}` : ''}`;

  function send(
    kind: EmailKind,
    user: { email: string; name: string; language: string },
    url: string,
  ) {
    const lang = languageSchema.catch('uk').parse(user.language);
    const rendered = renderEmail(i18n, kind, { lang, name: user.name, link: url });
    sendInBackground(deps.email, logger, { to: user.email, ...rendered });
  }

  router.post(
    '/api/auth/signup',
    rateLimit(rateLimiter, 'signup', { ip: AUTH_PER_IP, email: EMAIL_SEND }),
    async (req, res) => {
      const body = signupBodySchema.parse(req.body);
      const passwordHash = await hashPassword(body.password);
      const [created] = await db
        .insert(appUser)
        .values({
          email: body.email,
          passwordHash,
          name: body.name,
          language: body.language,
          timezone: body.timezone,
        })
        .onConflictDoNothing({ target: appUser.email })
        .returning();

      if (created) {
        const token = await issueOneTimeToken(db, clock, created.id, 'VERIFY_EMAIL');
        res.status(201).end();
        send('verifyEmail', created, link('/verify-email', token));
        return;
      }
      const [existing] = await db.select().from(appUser).where(eq(appUser.email, body.email));
      res.status(201).end();
      if (existing) send('accountExists', existing, link('/login'));
    },
  );

  router.post(
    '/api/auth/verify-email',
    rateLimit(rateLimiter, 'verify-email', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const { token } = tokenBodySchema.parse(req.body);
      const verified = await db.transaction(async (tx) => {
        const userId = await consumeOneTimeToken(tx, clock, token, 'VERIFY_EMAIL');
        if (!userId) return false;
        const [before] = await tx.select().from(appUser).where(eq(appUser.id, userId));
        if (before && !before.emailVerifiedAt) await applyPendingInvites(tx, clock, before);
        await tx
          .update(appUser)
          .set({
            emailVerifiedAt: sql`coalesce(${appUser.emailVerifiedAt}, ${clock.now().toISOString()}::timestamptz)`,
          })
          .where(eq(appUser.id, userId));
        return true;
      });
      if (!verified) throw new HttpError(410, 'expired', 'The link is invalid or has expired');
      res.status(204).end();
    },
  );

  router.post(
    '/api/auth/resend-verification',
    requireUser(deps),
    rateLimit(rateLimiter, 'resend-verification', { ip: AUTH_PER_IP, user: EMAIL_SEND }),
    async (_req, res) => {
      const { user } = getAuth(res);
      if (user.emailVerifiedAt) {
        res.status(204).end();
        return;
      }
      const token = await issueOneTimeToken(db, clock, user.id, 'VERIFY_EMAIL');
      res.status(204).end();
      send('verifyEmail', user, link('/verify-email', token));
    },
  );

  return router;
}
