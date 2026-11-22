import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../../auth/jwt.ts';
import { appUser, session } from '../../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import type { AppDeps } from '../app.ts';

export type User = typeof appUser.$inferSelect;

export type AuthContext = { user: User; sessionId: string; sessionCreatedAt: Date };

const BEARER = /^Bearer (\S+)$/;

export function requireUser(deps: Pick<AppDeps, 'db' | 'clock' | 'config'>): RequestHandler {
  return async (req, res, next) => {
    const token = BEARER.exec(req.get('Authorization') ?? '')?.[1];
    const claims = token ? await verifyAccessToken(deps.config.jwtSecret, deps.clock, token) : null;
    if (!claims) throw new HttpError(401, 'unauthorized', 'Unauthorized');

    const [row] = await deps.db
      .select({ user: appUser, sessionCreatedAt: session.createdAt })
      .from(session)
      .innerJoin(appUser, eq(session.userId, appUser.id))
      .where(
        and(
          eq(session.id, claims.sessionId),
          eq(appUser.id, claims.userId),
          isNull(session.revokedAt),
        ),
      );
    if (!row) throw new HttpError(401, 'unauthorized', 'Unauthorized');

    const auth: AuthContext = {
      user: row.user,
      sessionId: claims.sessionId,
      sessionCreatedAt: row.sessionCreatedAt,
    };
    res.locals.auth = auth;
    next();
  };
}

export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) throw new Error('requireUser must run before getAuth');
  return auth;
}

export const requireVerifiedEmail: RequestHandler = (_req, res, next) => {
  if (!getAuth(res).user.emailVerifiedAt) {
    throw new HttpError(403, 'email_not_verified', 'Email address is not verified');
  }
  next();
};
