import { isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import {
  delivery,
  deviceDiagnostic,
  deviceInvite,
  oneTimeToken,
  session,
} from '../db/schema/index.ts';

export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CleanupResult = Record<
  'oneTimeTokens' | 'sessions' | 'invites' | 'deliveries' | 'diagnostics',
  number
>;

export async function runCleanup(db: Db, clock: Clock): Promise<CleanupResult> {
  const now = clock.now();
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const tokens = await db
    .delete(oneTimeToken)
    .where(lt(oneTimeToken.expiresAt, before(1)))
    .returning({ id: oneTimeToken.tokenHash });
  const sessions = await db
    .delete(session)
    .where(
      or(
        isNotNull(session.revokedAt),
        sql`not exists (select 1 from refresh_token rt where rt.session_id = ${session.id} and rt.expires_at > ${now.toISOString()}::timestamptz)`,
      ),
    )
    .returning({ id: session.id });
  const invites = await db
    .delete(deviceInvite)
    .where(lt(deviceInvite.expiresAt, before(30)))
    .returning({ id: deviceInvite.id });
  const deliveries = await db
    .delete(delivery)
    .where(lt(delivery.createdAt, before(RETENTION_DAYS)))
    .returning({ id: delivery.id });
  const diagnostics = await db
    .delete(deviceDiagnostic)
    .where(lt(deviceDiagnostic.startedAt, before(RETENTION_DAYS)))
    .returning({ id: deviceDiagnostic.localId });

  return {
    oneTimeTokens: tokens.length,
    sessions: sessions.length,
    invites: invites.length,
    deliveries: deliveries.length,
    diagnostics: diagnostics.length,
  };
}

export function dailyRunner(clock: Clock, run: () => Promise<void>): () => Promise<void> {
  let lastStartMs: number | null = null;
  return async () => {
    const nowMs = clock.now().getTime();
    if (lastStartMs !== null && nowMs - lastStartMs < DAY_MS) return;
    await run();
    lastStartMs = nowMs;
  };
}
