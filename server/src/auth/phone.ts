import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db, Executor, Tx } from '../db/client.ts';
import { appUser, oneTimeToken } from '../db/schema/index.ts';
import { sha256 } from '../lib/crypto.ts';
import { applyPendingInvites } from '../sharing/invites.ts';
import type { Chat } from '../telegram/commands.ts';
import { connectPlatformChat } from '../telegram/platformChat.ts';
import { issueOneTimeToken } from './oneTimeTokens.ts';

export const PHONE_CODE_PREFIX = 'p_';

export function phoneCodeUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${PHONE_CODE_PREFIX}${token}`;
}

const livePhoneCode = (now: Date) =>
  and(
    inArray(oneTimeToken.purpose, ['PHONE_VERIFY', 'PHONE_RECOVER']),
    isNull(oneTimeToken.usedAt),
    gt(oneTimeToken.expiresAt, now),
  );

export async function claimPhoneCode(
  db: Executor,
  clock: Clock,
  token: string,
  telegramUserId: bigint,
): Promise<void> {
  await db
    .update(oneTimeToken)
    .set({ telegramUserId })
    .where(and(eq(oneTimeToken.tokenHash, sha256(token)), livePhoneCode(clock.now())));
}

export async function bindTelegramUser(
  tx: Tx,
  userId: string,
  telegramUserId: bigint,
): Promise<void> {
  await tx
    .update(appUser)
    .set({ telegramUserId: null })
    .where(and(eq(appUser.telegramUserId, telegramUserId), ne(appUser.id, userId)));
  await tx.update(appUser).set({ telegramUserId }).where(eq(appUser.id, userId));
}

async function releaseUnverifiedPhone(
  tx: Tx,
  holder: { id: string; email: string | null },
): Promise<void> {
  if (holder.email) {
    await tx.update(appUser).set({ phone: null }).where(eq(appUser.id, holder.id));
  } else {
    await tx.delete(appUser).where(eq(appUser.id, holder.id));
  }
}

export type ContactOutcome =
  | { kind: 'mismatch' }
  | { kind: 'numberInUse'; userId: string }
  | { kind: 'confirmed'; userId: string }
  | { kind: 'recovered'; userId: string; resetToken: string };

type Contact = {
  telegramUserId: bigint;
  contactUserId: number | undefined;
  phone: string | null;
  chat: Chat;
};

const mismatch: ContactOutcome = { kind: 'mismatch' };

export async function confirmContact(
  db: Db,
  clock: Clock,
  input: Contact,
): Promise<ContactOutcome> {
  const { telegramUserId, contactUserId, phone, chat } = input;
  if (contactUserId === undefined || BigInt(contactUserId) !== telegramUserId) return mismatch;
  if (!phone) return mismatch;

  return db.transaction(async (tx): Promise<ContactOutcome> => {
    const now = clock.now();
    const [code] = await tx
      .select()
      .from(oneTimeToken)
      .where(
        and(
          eq(oneTimeToken.telegramUserId, telegramUserId),
          eq(oneTimeToken.phone, phone),
          livePhoneCode(now),
        ),
      )
      .orderBy(desc(oneTimeToken.createdAt))
      .limit(1);
    if (!code) return mismatch;
    const consumed = await tx
      .update(oneTimeToken)
      .set({ usedAt: now })
      .where(and(eq(oneTimeToken.tokenHash, code.tokenHash), isNull(oneTimeToken.usedAt)))
      .returning({ userId: oneTimeToken.userId });
    if (consumed.length === 0) return mismatch;
    const { userId } = code;

    if (code.purpose === 'PHONE_RECOVER') {
      await bindTelegramUser(tx, userId, telegramUserId);
      const resetToken = await issueOneTimeToken(tx, clock, userId, 'RESET_PASSWORD', { phone });
      return { kind: 'recovered', userId, resetToken };
    }

    const [holder] = await tx
      .select()
      .from(appUser)
      .where(and(eq(appUser.phone, phone), ne(appUser.id, userId)));
    if (holder?.phoneVerifiedAt) return { kind: 'numberInUse', userId };
    const [user] = await tx.select().from(appUser).where(eq(appUser.id, userId));
    if (!user || (user.phoneVerifiedAt && user.phone !== phone)) return mismatch;
    if (holder) await releaseUnverifiedPhone(tx, holder);

    await applyPendingInvites(tx, clock, userId, { phone });
    await bindTelegramUser(tx, userId, telegramUserId);
    await tx
      .update(appUser)
      .set({
        phone,
        phoneVerifiedAt: sql`coalesce(${appUser.phoneVerifiedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(eq(appUser.id, userId));
    await connectPlatformChat(tx, clock, userId, chat);
    return { kind: 'confirmed', userId };
  });
}
