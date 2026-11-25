import {
  changePasswordBodySchema,
  forgotBodySchema,
  languageSchema,
  resetBodySchema,
  telegramUrlSchema,
} from '@elec/shared/api';
import { eq, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  consumeOneTimeToken,
  expireOneTimeTokens,
  issueOneTimeToken,
} from '../../auth/oneTimeTokens.ts';
import { hashPassword, verifyPassword } from '../../auth/password.ts';
import { phoneCodeUrl } from '../../auth/phone.ts';
import { revokeUserSessions } from '../../auth/sessions.ts';
import { appUser } from '../../db/schema/index.ts';
import { createI18n } from '../../i18n.ts';
import { randomToken } from '../../lib/crypto.ts';
import { AUTH_PER_IP, EMAIL_SEND, REAUTH_PER_USER } from '../../rateLimit/limiter.ts';
import { applyPendingInvites } from '../../sharing/invites.ts';
import { renderTelegramAuth, sendTelegramInBackground } from '../../telegram/pushes.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { authEmails } from './emails.ts';
import { getAuth, requireUser, type User } from './middleware.ts';

const rateLimited = errorResponse('Too many requests, with `Retry-After`');
const validation = errorResponse('Invalid body');

export const passwordPaths: ZodOpenApiPathsObject = {
  '/api/auth/forgot-password': {
    post: {
      summary: 'Request a password reset link',
      description:
        'Answers the same whether or not the account exists: `204` for an email, `200` with a Telegram link for a phone.',
      requestBody: { content: { 'application/json': { schema: forgotBodySchema } } },
      responses: {
        '200': {
          description: 'Phone: a Telegram link that recovers the account',
          content: { 'application/json': { schema: telegramUrlSchema } },
        },
        '204': { description: 'Email: accepted' },
        '400': validation,
        '429': rateLimited,
      },
    },
  },
  '/api/auth/reset-password': {
    post: {
      summary: 'Set a new password with the reset token',
      description: 'Verifies the email or phone the link was sent to, and ends every session.',
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
  const emails = authEmails(deps, i18n);

  async function pushResetLink(user: User, phone: string): Promise<void> {
    if (user.telegramUserId === null) return;
    const token = await issueOneTimeToken(db, clock, user.id, 'RESET_PASSWORD', { phone });
    const text = renderTelegramAuth(i18n, 'resetLink', {
      lang: languageSchema.catch('uk').parse(user.language),
      link: `${config.urls.client}/reset-password?token=${token}`,
    });
    sendTelegramInBackground(deps.telegram, logger, user.telegramUserId, text);
  }

  router.post(
    '/api/auth/forgot-password',
    rateLimit(rateLimiter, 'forgot-password', {
      ip: AUTH_PER_IP,
      email: EMAIL_SEND,
      phone: EMAIL_SEND,
    }),
    async (req, res) => {
      const body = forgotBodySchema.parse(req.body);
      if ('phone' in body) {
        const { phone } = body;
        const [user] = await db.select().from(appUser).where(eq(appUser.phone, phone));
        const code = user
          ? await issueOneTimeToken(db, clock, user.id, 'PHONE_RECOVER', { phone })
          : randomToken();
        res.json({ telegram_url: phoneCodeUrl(config.telegram.botUsername, code) });
        if (user) await pushResetLink(user, phone);
        return;
      }
      const [user] = await db.select().from(appUser).where(eq(appUser.email, body.email));
      if (!user) {
        res.status(204).end();
        return;
      }
      const token = await issueOneTimeToken(db, clock, user.id, 'RESET_PASSWORD');
      res.status(204).end();
      emails.resetPassword(user, token);
    },
  );

  router.post(
    '/api/auth/reset-password',
    rateLimit(rateLimiter, 'reset-password', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const { token, password } = resetBodySchema.parse(req.body);
      const passwordHash = await hashPassword(password);
      const reset = await db.transaction(async (tx) => {
        const consumed = await consumeOneTimeToken(tx, clock, token, 'RESET_PASSWORD');
        if (!consumed) return false;
        const { userId } = consumed;
        const [before] = await tx.select().from(appUser).where(eq(appUser.id, userId));
        if (!before) return false;
        const now = sql`${clock.now().toISOString()}::timestamptz`;
        const verified: Partial<Record<'emailVerifiedAt' | 'phoneVerifiedAt', SQL>> = {};
        if (consumed.phone === null) {
          if (before.email) {
            if (!before.emailVerifiedAt) {
              await applyPendingInvites(tx, clock, userId, { email: before.email });
            }
            verified.emailVerifiedAt = sql`coalesce(${appUser.emailVerifiedAt}, ${now})`;
          }
        } else if (consumed.phone === before.phone) {
          if (!before.phoneVerifiedAt) {
            await applyPendingInvites(tx, clock, userId, { phone: consumed.phone });
          }
          verified.phoneVerifiedAt = sql`coalesce(${appUser.phoneVerifiedAt}, ${now})`;
        }
        await tx
          .update(appUser)
          .set({ passwordHash, ...verified })
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
