import { appTargets, googleIntents, type AppTarget } from '@elec/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { generateCodeVerifier, generateState } from 'arctic';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { signOAuthState, verifyOAuthState, type GoogleIdentity } from '../../auth/google.ts';
import { createSession, findActiveSession, revokeUserSessions } from '../../auth/sessions.ts';
import { appUser } from '../../db/schema/index.ts';
import { AUTH_PER_IP } from '../../rateLimit/limiter.ts';
import { applyPendingInvites } from '../../sharing/invites.ts';
import type { AppDeps } from '../app.ts';
import {
  clearOAuthCookie,
  readOAuthCookie,
  readRefreshCookie,
  setOAuthCookie,
  setRefreshCookie,
} from '../cookies.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';
import { getAuth, isVerified, requireUser } from './middleware.ts';

const startQuerySchema = z.object({ app: z.enum(appTargets), intent: z.enum(googleIntents) });

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

type GoogleError =
  | 'google_failed'
  | 'google_email_unverified'
  | 'google_account_in_use'
  | 'google_already_linked';

type Outcome = { error: GoogleError } | { error?: undefined; refreshToken?: string };

const redirectResponse = (description: string) => ({
  '302': { description, headers: z.object({ Location: z.string() }) },
});

export const googlePaths: ZodOpenApiPathsObject = {
  '/api/auth/google': {
    get: {
      summary: 'Start Google sign-in or linking',
      requestParams: { query: startQuerySchema },
      responses: {
        ...redirectResponse('Redirect to Google, with the `em_oauth` state cookie'),
        '400': errorResponse('Invalid query'),
        '429': errorResponse('Too many requests, with `Retry-After`'),
      },
    },
    delete: {
      summary: 'Unlink Google from the signed-in user',
      security: [{ bearerAuth: [] }],
      responses: {
        '204': { description: 'Unlinked' },
        '401': errorResponse('Missing or invalid access token'),
        '409': errorResponse('Google is the only sign-in method'),
      },
    },
  },
  '/api/auth/google/callback': {
    get: {
      summary: 'Google redirects here after consent',
      description:
        'Redirects to `<app origin>/auth/google`, with `?error=google_failed`, `google_email_unverified`, `google_account_in_use` or `google_already_linked` on failure. Never answers with JSON.',
      requestParams: { query: callbackQuerySchema },
      responses: redirectResponse('Redirect to the client or admin app'),
    },
  },
};

export function googleRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, clock, logger, config, google, rateLimiter } = deps;
  const appOrigin = (target: AppTarget) =>
    target === 'ADMIN' ? config.urls.admin : config.urls.client;

  async function signInWithGoogle(identity: GoogleIdentity): Promise<Outcome> {
    return db.transaction(async (tx): Promise<Outcome> => {
      const now = clock.now();
      let [user] = await tx.select().from(appUser).where(eq(appUser.googleSub, identity.sub));
      if (!user) {
        const [byEmail] = await tx.select().from(appUser).where(eq(appUser.email, identity.email));
        if (byEmail?.googleSub) return { error: 'google_already_linked' };
        if (byEmail) {
          const unverified = byEmail.emailVerifiedAt === null;
          [user] = await tx
            .update(appUser)
            .set(
              unverified
                ? { googleSub: identity.sub, emailVerifiedAt: now, passwordHash: null }
                : { googleSub: identity.sub },
            )
            .where(eq(appUser.id, byEmail.id))
            .returning();
          if (unverified) {
            await revokeUserSessions(tx, clock, byEmail.id);
            await applyPendingInvites(tx, clock, byEmail.id, { email: identity.email });
          }
        } else {
          [user] = await tx
            .insert(appUser)
            .values({
              email: identity.email,
              googleSub: identity.sub,
              emailVerifiedAt: now,
              name: identity.name ?? identity.email.split('@')[0] ?? identity.email,
            })
            .returning();
          await applyPendingInvites(tx, clock, user!.id, { email: identity.email });
        }
      }
      const created = await createSession(tx, clock, user!.id);
      return { refreshToken: created.refreshToken };
    });
  }

  async function linkGoogle(userId: string, identity: GoogleIdentity): Promise<Outcome> {
    const [user] = await db.select().from(appUser).where(eq(appUser.id, userId));
    if (!user) return { error: 'google_failed' };
    if (user.googleSub === identity.sub) return {};
    if (user.googleSub) return { error: 'google_already_linked' };
    const [owner] = await db.select().from(appUser).where(eq(appUser.googleSub, identity.sub));
    if (owner) return { error: 'google_account_in_use' };
    if (!isVerified(user)) return { error: 'google_failed' };
    if (user.email) {
      await db.update(appUser).set({ googleSub: identity.sub }).where(eq(appUser.id, userId));
      return {};
    }
    return db.transaction(async (tx): Promise<Outcome> => {
      const [emailOwner] = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.email, identity.email));
      if (emailOwner) return { error: 'google_account_in_use' };
      await applyPendingInvites(tx, clock, userId, { email: identity.email });
      await tx
        .update(appUser)
        .set({ googleSub: identity.sub, email: identity.email, emailVerifiedAt: clock.now() })
        .where(eq(appUser.id, userId));
      return {};
    });
  }

  router.get(
    '/api/auth/google',
    rateLimit(rateLimiter, 'google-start', { ip: AUTH_PER_IP }),
    async (req, res) => {
      const { app, intent } = startQuerySchema.parse(req.query);
      const origin = appOrigin(app);
      let userId: string | undefined;
      if (intent === 'LINK') {
        const token = readRefreshCookie(req);
        const active = token ? await findActiveSession(db, clock, token) : null;
        if (!active) {
          res.redirect(302, `${origin}/auth/google?error=google_failed`);
          return;
        }
        userId = active.userId;
      }
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const signed = await signOAuthState(config.jwtSecret, clock, {
        state,
        codeVerifier,
        app,
        intent,
        userId,
      });
      setOAuthCookie(res, signed);
      res.redirect(302, google.authorizationUrl(state, codeVerifier).toString());
    },
  );

  router.get('/api/auth/google/callback', async (req, res) => {
    const raw = readOAuthCookie(req);
    clearOAuthCookie(res);
    const saved = raw ? await verifyOAuthState(config.jwtSecret, clock, raw) : null;
    const origin = saved ? appOrigin(saved.app) : config.urls.client;
    const fail = (error: GoogleError) => {
      res.redirect(302, `${origin}/auth/google?error=${error}`);
    };

    const query = callbackQuerySchema.safeParse(req.query);
    if (!saved || !query.success || query.data.error || !query.data.code) {
      fail('google_failed');
      return;
    }
    if (query.data.state !== saved.state) {
      fail('google_failed');
      return;
    }

    let identity: GoogleIdentity;
    try {
      identity = await google.exchange(query.data.code, saved.codeVerifier);
    } catch (err) {
      logger.warn('google sign-in failed', err);
      fail('google_failed');
      return;
    }
    if (!identity.emailVerified) {
      fail('google_email_unverified');
      return;
    }

    const outcome =
      saved.intent === 'LINK' && saved.userId
        ? await linkGoogle(saved.userId, identity)
        : await signInWithGoogle(identity);
    if (outcome.error) {
      fail(outcome.error);
      return;
    }
    if (outcome.refreshToken) setRefreshCookie(res, outcome.refreshToken);
    res.redirect(302, `${origin}/auth/google`);
  });

  router.delete('/api/auth/google', requireUser(deps), async (_req, res) => {
    const { user } = getAuth(res);
    if (!user.passwordHash) {
      throw new HttpError(409, 'conflict', 'Google is the only sign-in method');
    }
    await db.update(appUser).set({ googleSub: null }).where(eq(appUser.id, user.id));
    res.status(204).end();
  });

  return router;
}
