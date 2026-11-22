import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db, Executor } from '../db/client.ts';
import { refreshToken, session } from '../db/schema/index.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';

export const REFRESH_TTL_S = 2_592_000;
export const REUSE_GRACE_S = 10;

export type RotateResult =
  | { ok: true; userId: string; sessionId: string; refreshToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' | 'racing' };

function refreshExpiry(clock: Clock): Date {
  return new Date(clock.now().getTime() + REFRESH_TTL_S * 1000);
}

async function insertRefreshToken(db: Executor, clock: Clock, sessionId: string): Promise<string> {
  const token = randomToken();
  await db.insert(refreshToken).values({
    tokenHash: sha256(token),
    sessionId,
    expiresAt: refreshExpiry(clock),
    createdAt: clock.now(),
  });
  return token;
}

export async function createSession(
  db: Executor,
  clock: Clock,
  userId: string,
): Promise<{ sessionId: string; refreshToken: string }> {
  const now = clock.now();
  const [created] = await db
    .insert(session)
    .values({ userId, createdAt: now, lastUsedAt: now })
    .returning({ id: session.id });
  const sessionId = created!.id;
  return { sessionId, refreshToken: await insertRefreshToken(db, clock, sessionId) };
}

export async function rotateRefreshToken(
  db: Db,
  clock: Clock,
  token: string,
): Promise<RotateResult> {
  const tokenHash = sha256(token);
  return db.transaction(async (tx): Promise<RotateResult> => {
    const [row] = await tx
      .select({
        userId: session.userId,
        sessionId: session.id,
        revokedAt: session.revokedAt,
        usedAt: refreshToken.usedAt,
        expiresAt: refreshToken.expiresAt,
      })
      .from(refreshToken)
      .innerJoin(session, eq(session.id, refreshToken.sessionId))
      .where(eq(refreshToken.tokenHash, tokenHash))
      .for('update', { of: refreshToken });
    const now = clock.now();
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.revokedAt) return { ok: false, reason: 'revoked' };
    if (row.usedAt) {
      if (now.getTime() - row.usedAt.getTime() <= REUSE_GRACE_S * 1000) {
        return { ok: false, reason: 'racing' };
      }
      await tx.update(session).set({ revokedAt: now }).where(eq(session.id, row.sessionId));
      return { ok: false, reason: 'reused' };
    }
    if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };

    await tx.update(refreshToken).set({ usedAt: now }).where(eq(refreshToken.tokenHash, tokenHash));
    const next = await insertRefreshToken(tx, clock, row.sessionId);
    await tx.update(session).set({ lastUsedAt: now }).where(eq(session.id, row.sessionId));
    return { ok: true, userId: row.userId, sessionId: row.sessionId, refreshToken: next };
  });
}

export async function findActiveSession(
  db: Executor,
  clock: Clock,
  token: string,
): Promise<{ userId: string; sessionId: string } | null> {
  const [row] = await db
    .select({ userId: session.userId, sessionId: session.id })
    .from(refreshToken)
    .innerJoin(session, eq(session.id, refreshToken.sessionId))
    .where(
      and(
        eq(refreshToken.tokenHash, sha256(token)),
        isNull(refreshToken.usedAt),
        gt(refreshToken.expiresAt, clock.now()),
        isNull(session.revokedAt),
      ),
    );
  return row ?? null;
}

export async function revokeSessionByToken(
  db: Executor,
  clock: Clock,
  token: string,
): Promise<void> {
  await db
    .update(session)
    .set({ revokedAt: clock.now() })
    .where(
      and(
        isNull(session.revokedAt),
        sql`${session.id} in (select ${refreshToken.sessionId} from ${refreshToken} where ${refreshToken.tokenHash} = ${sha256(token)})`,
      ),
    );
}

export async function revokeUserSessions(
  db: Executor,
  clock: Clock,
  userId: string,
  except?: string,
): Promise<void> {
  await db
    .update(session)
    .set({ revokedAt: clock.now() })
    .where(
      and(
        eq(session.userId, userId),
        isNull(session.revokedAt),
        except ? ne(session.id, except) : undefined,
      ),
    );
}
