import {
  languageSchema,
  signupBodySchema,
  telegramUrlSchema,
  tokenBodySchema,
} from '@elec/shared/api';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { consumeOneTimeToken, issueOneTimeToken } from '../../auth/oneTimeTokens.ts';
import { hashPassword } from '../../auth/password.ts';
import { phoneCodeUrl } from '../../auth/phone.ts';
import { appUser } from '../../db/schema/index.ts';
import { randomToken } from '../../lib/crypto.ts';
import { createI18n } from '../../i18n.ts';
import { applyPendingInvites } from '../../sharing/invites.ts';
import { renderTelegramAuth, sendTelegramInBackground } from '../../telegram/pushes.ts';
import { AUTH_PER_IP, EMAIL_SEND } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { authEmails } from './emails.ts';
import { getAuth, requireUser } from './middleware.ts';

const rateLimited = errorResponse('Too many requests, with `Retry-After`');
const validation = errorResponse('Invalid body');

export const signupPaths: ZodOpenApiPathsObject = {
  '/api/auth/signup': {
    post: {
      summary: 'Sign up with an email or a phone, and a password',
      description:
        'Always answers `201`, whether or not the account exists. With an email there is no body and the user must verify it. With a phone the body holds a Telegram link that confirms the number or recovers the account.',
      requestBody: { content: { 'application/json': { schema: signupBodySchema } } },
      responses: {
        '201': {
          description: 'Email: no body. Phone: a Telegram link',
          content: { 'application/json': { schema: telegramUrlSchema } },
        },
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

type Profile = {
  passwordHash: string;
  name: string;
  language: string;
  timezone: string;
};

export function signupRouter(deps: AppDeps): Router {
  const router = Router();
  const i18n = createI18n();
  const { db, clock, logger, config, rateLimiter } = deps;
  const emails = authEmails(deps, i18n);

  async function signUpWithPhone(phone: string, profile: Profile): Promise<string> {
    const [created] = await db
      .insert(appUser)
      .values({ phone, ...profile })
      .onConflictDoNothing({ target: appUser.phone })
      .returning();
    if (created) {
      return issueOneTimeToken(db, clock, created.id, 'PHONE_VERIFY', { phone });
    }
    const [existing] = await db.select().from(appUser).where(eq(appUser.phone, phone));
    if (!existing) return randomToken();
    const token = await issueOneTimeToken(db, clock, existing.id, 'PHONE_RECOVER', { phone });
    if (existing.telegramUserId !== null) {
      const text = renderTelegramAuth(i18n, 'signupAttempt', {
        lang: languageSchema.catch('uk').parse(existing.language),
        link: `${config.urls.client}/login`,
      });
      sendTelegramInBackground(deps.telegram, logger, existing.telegramUserId, text);
    }
    return token;
  }

  router.post(
    '/api/auth/signup',
    rateLimit(rateLimiter, 'signup', { ip: AUTH_PER_IP, email: EMAIL_SEND, phone: EMAIL_SEND }),
    async (req, res) => {
      const body = signupBodySchema.parse(req.body);
      const profile = {
        passwordHash: await hashPassword(body.password),
        name: body.name,
        language: body.language,
        timezone: body.timezone,
      };
      if ('phone' in body) {
        const token = await signUpWithPhone(body.phone, profile);
        res.status(201).json({ telegram_url: phoneCodeUrl(config.telegram.botUsername, token) });
        return;
      }
      const [created] = await db
        .insert(appUser)
        .values({ email: body.email, ...profile })
        .onConflictDoNothing({ target: appUser.email })
        .returning();

      if (created) {
        const token = await issueOneTimeToken(db, clock, created.id, 'VERIFY_EMAIL');
        res.status(201).end();
        emails.verifyEmail(created, token);
        return;
      }
      const [existing] = await db.select().from(appUser).where(eq(appUser.email, body.email));
      res.status(201).end();
      if (existing) emails.accountExists(existing);
    },
  );

  router.post(
    '/api/auth/verify-email',
    rateLimit(rateLimiter, 'verify-email', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const { token } = tokenBodySchema.parse(req.body);
      const verified = await db.transaction(async (tx) => {
        const consumed = await consumeOneTimeToken(tx, clock, token, 'VERIFY_EMAIL');
        if (!consumed) return false;
        const { userId } = consumed;
        const [before] = await tx.select().from(appUser).where(eq(appUser.id, userId));
        if (before?.email && !before.emailVerifiedAt) {
          await applyPendingInvites(tx, clock, userId, { email: before.email });
        }
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
      if (user.emailVerifiedAt || !user.email) {
        res.status(204).end();
        return;
      }
      const token = await issueOneTimeToken(db, clock, user.id, 'VERIFY_EMAIL');
      res.status(204).end();
      emails.verifyEmail(user, token);
    },
  );

  return router;
}
