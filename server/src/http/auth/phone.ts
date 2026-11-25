import { addEmailBodySchema, addPhoneBodySchema, telegramUrlSchema } from '@elec/shared/api';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { issueOneTimeToken } from '../../auth/oneTimeTokens.ts';
import { phoneCodeUrl } from '../../auth/phone.ts';
import { appUser } from '../../db/schema/index.ts';
import { createI18n } from '../../i18n.ts';
import { AUTH_PER_IP, EMAIL_SEND } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { authEmails } from './emails.ts';
import { getAuth, isVerified, requireUser, requireVerified } from './middleware.ts';

const rateLimited = errorResponse('Too many requests, with `Retry-After`');
const validation = errorResponse('Invalid body');
const unauthorized = errorResponse('Missing or invalid access token');
const bearer = [{ bearerAuth: [] }];

export const phonePaths: ZodOpenApiPathsObject = {
  '/api/auth/phone': {
    post: {
      summary: 'Add a phone number, or resend its confirmation link',
      description:
        'Returns a Telegram link. The number is set on the account once it is confirmed in the bot.',
      security: bearer,
      requestBody: { content: { 'application/json': { schema: addPhoneBodySchema } } },
      responses: {
        '200': {
          description: 'Open the link in Telegram',
          content: { 'application/json': { schema: telegramUrlSchema } },
        },
        '400': validation,
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '409': errorResponse(
          'Another account has confirmed the number (`already_in_use`), or this account already has a phone',
        ),
        '429': rateLimited,
      },
    },
  },
  '/api/auth/email': {
    post: {
      summary: 'Add an email address to a phone account',
      security: bearer,
      requestBody: { content: { 'application/json': { schema: addEmailBodySchema } } },
      responses: {
        '204': { description: 'Verification email queued (or an account-exists email)' },
        '400': validation,
        '401': unauthorized,
        '403': errorResponse('`not_verified`'),
        '409': errorResponse('The account already has an email'),
        '429': rateLimited,
      },
    },
  },
};

export function phoneRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, config, rateLimiter } = deps;
  const emails = authEmails(deps, createI18n());

  router.post(
    '/api/auth/phone',
    requireUser(deps),
    rateLimit(rateLimiter, 'add-phone', { ip: AUTH_PER_IP, phone: EMAIL_SEND }),
    async (req, res) => {
      const { user } = getAuth(res);
      const { phone } = addPhoneBodySchema.parse(req.body);
      const [holder] = await db
        .select({ id: appUser.id })
        .from(appUser)
        .where(
          and(
            eq(appUser.phone, phone),
            ne(appUser.id, user.id),
            isNotNull(appUser.phoneVerifiedAt),
          ),
        );
      if (holder) {
        throw new HttpError(409, 'conflict', 'The number is already used', [
          { path: 'phone', code: 'already_in_use' },
        ]);
      }
      if (user.phone && (user.phone !== phone || user.phoneVerifiedAt)) {
        throw new HttpError(409, 'conflict', 'The account already has a phone');
      }
      if (!user.phone && !isVerified(user)) {
        throw new HttpError(403, 'not_verified', 'Email or phone is not verified');
      }
      const token = await issueOneTimeToken(db, clock, user.id, 'PHONE_VERIFY', { phone });
      res.json({ telegram_url: phoneCodeUrl(config.telegram.botUsername, token) });
    },
  );

  router.post(
    '/api/auth/email',
    requireUser(deps),
    requireVerified,
    rateLimit(rateLimiter, 'add-email', {
      ip: AUTH_PER_IP,
      user: EMAIL_SEND,
      email: EMAIL_SEND,
    }),
    async (req, res) => {
      const { user } = getAuth(res);
      const { email } = addEmailBodySchema.parse(req.body);
      if (user.email) throw new HttpError(409, 'conflict', 'The account already has an email');
      const [existing] = await db.select().from(appUser).where(eq(appUser.email, email));
      if (existing) {
        res.status(204).end();
        emails.accountExists(existing);
        return;
      }
      const token = await issueOneTimeToken(db, clock, user.id, 'VERIFY_EMAIL', { email });
      res.status(204).end();
      emails.verifyEmail({ ...user, email }, token);
    },
  );

  return router;
}
