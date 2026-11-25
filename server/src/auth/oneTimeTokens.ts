import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Executor } from '../db/client.ts';
import { oneTimeToken } from '../db/schema/index.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';

export type OneTimePurpose =
  | 'VERIFY_EMAIL'
  | 'RESET_PASSWORD'
  | 'TELEGRAM_LINK'
  | 'PHONE_VERIFY'
  | 'PHONE_RECOVER';

export const ONE_TIME_TTL_S: Record<OneTimePurpose, number> = {
  VERIFY_EMAIL: 86_400,
  RESET_PASSWORD: 3_600,
  TELEGRAM_LINK: 900,
  PHONE_VERIFY: 86_400,
  PHONE_RECOVER: 3_600,
};

export async function issueOneTimeToken(
  db: Executor,
  clock: Clock,
  userId: string,
  purpose: OneTimePurpose,
  opts: { phone?: string } = {},
): Promise<string> {
  const token = randomToken();
  const now = clock.now();
  await db.insert(oneTimeToken).values({
    tokenHash: sha256(token),
    userId,
    purpose,
    phone: opts.phone,
    expiresAt: new Date(now.getTime() + ONE_TIME_TTL_S[purpose] * 1000),
    createdAt: now,
  });
  return token;
}

export async function consumeOneTimeToken(
  db: Executor,
  clock: Clock,
  token: string,
  purpose: OneTimePurpose,
): Promise<{ userId: string; phone: string | null } | null> {
  const now = clock.now();
  const [row] = await db
    .update(oneTimeToken)
    .set({ usedAt: now })
    .where(
      and(
        eq(oneTimeToken.tokenHash, sha256(token)),
        eq(oneTimeToken.purpose, purpose),
        isNull(oneTimeToken.usedAt),
        gt(oneTimeToken.expiresAt, now),
      ),
    )
    .returning({ userId: oneTimeToken.userId, phone: oneTimeToken.phone });
  return row ?? null;
}

export async function expireOneTimeTokens(
  db: Executor,
  clock: Clock,
  userId: string,
  purpose: OneTimePurpose,
): Promise<void> {
  await db
    .update(oneTimeToken)
    .set({ usedAt: clock.now() })
    .where(
      and(
        eq(oneTimeToken.userId, userId),
        eq(oneTimeToken.purpose, purpose),
        isNull(oneTimeToken.usedAt),
      ),
    );
}
