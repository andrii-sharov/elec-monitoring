import type { ChannelType, DeliveryEvent, Language } from '@elec/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { appUser, delivery, device, notificationChannel, outage } from '../db/schema/index.ts';
import { canReadDevice } from '../devices/access.ts';
import type { QuietHours } from './format.ts';
import type { DeliveryPayload } from './render.ts';
import type { SendResult } from './telegram.ts';

export const RETRY_DELAYS_S = [60, 300, 1800, 7200, 21_600];
export const MAX_ATTEMPTS = 6;
export const LEASE_MS = 120_000;
export const FAILURES_TO_DISABLE = 20;

export function nextRetryAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const delayS = RETRY_DELAYS_S[attempts - 1];
  if (delayS === undefined) return null;
  return new Date(now.getTime() + delayS * 1000);
}

export type ClaimedDelivery = {
  id: string;
  attempts: number;
  event: DeliveryEvent;
  payload: DeliveryPayload;
  createdAt: Date;
  channel: { id: string; type: ChannelType; enabled: boolean; chatId: bigint | null };
  recipient: { language: Language; timezone: string };
  quietHours: QuietHours | null;
  outageEndedAt: Date | null;
  offAlertQueued: boolean;
  hasAccess: boolean;
};

export type Outcome = SendResult | { type: 'SKIPPED'; reason: string };

export async function claimDeliveries(
  db: Db,
  clock: Clock,
  limit: number,
): Promise<ClaimedDelivery[]> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const due = await tx
      .select({ id: delivery.id })
      .from(delivery)
      .where(
        and(inArray(delivery.status, ['QUEUED', 'RETRYING']), lte(delivery.nextAttemptAt, now)),
      )
      .orderBy(asc(delivery.nextAttemptAt), asc(delivery.createdAt), asc(delivery.id))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);

    await tx
      .update(delivery)
      .set({
        attempts: sql`${delivery.attempts} + 1`,
        lastAttemptAt: now,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(inArray(delivery.id, ids));

    const rows = await tx
      .select({
        delivery,
        channel: notificationChannel,
        language: appUser.language,
        timezone: appUser.timezone,
        outageEndedAt: outage.endedAt,
        offAlertQueuedAt: outage.offAlertQueuedAt,
        quietStart: device.quietHoursStart,
        quietEnd: device.quietHoursEnd,
        hasAccess: canReadDevice(notificationChannel.userId, device.ownerId, device.id).mapWith(
          Boolean,
        ),
      })
      .from(delivery)
      .innerJoin(notificationChannel, eq(notificationChannel.id, delivery.channelId))
      .innerJoin(appUser, eq(appUser.id, notificationChannel.userId))
      .innerJoin(outage, eq(outage.id, delivery.outageId))
      .innerJoin(device, eq(device.id, outage.deviceId))
      .where(inArray(delivery.id, ids));

    const byId = new Map(rows.map((r) => [r.delivery.id, r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      if (!r) return [];
      return [
        {
          id,
          attempts: r.delivery.attempts,
          event: r.delivery.event as DeliveryEvent,
          payload: r.delivery.payload as DeliveryPayload,
          createdAt: r.delivery.createdAt,
          channel: {
            id: r.channel.id,
            type: r.channel.type as ChannelType,
            enabled: r.channel.enabled,
            chatId: r.channel.telegramChatId,
          },
          recipient: { language: r.language as Language, timezone: r.timezone },
          quietHours: r.quietStart && r.quietEnd ? { start: r.quietStart, end: r.quietEnd } : null,
          outageEndedAt: r.outageEndedAt,
          offAlertQueued: r.offAlertQueuedAt !== null,
          hasAccess: r.hasAccess,
        },
      ];
    });
  });
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } } | null) ?? {};
  return code.code === '23505' || code.cause?.code === '23505';
}

async function failChannel(db: Db, channelId: string): Promise<void> {
  const [row] = await db
    .update(notificationChannel)
    .set({ consecutiveFailures: sql`${notificationChannel.consecutiveFailures} + 1` })
    .where(eq(notificationChannel.id, channelId))
    .returning({ failures: notificationChannel.consecutiveFailures });
  if (row && row.failures >= FAILURES_TO_DISABLE) {
    await db
      .update(notificationChannel)
      .set({ enabled: false, disabledReason: 'TOO_MANY_FAILURES' })
      .where(and(eq(notificationChannel.id, channelId), eq(notificationChannel.enabled, true)));
  }
}

export async function recordOutcome(
  db: Db,
  clock: Clock,
  d: ClaimedDelivery,
  outcome: Outcome,
): Promise<void> {
  const now = clock.now();
  const update = (set: Partial<typeof delivery.$inferInsert>) =>
    db.update(delivery).set(set).where(eq(delivery.id, d.id));

  switch (outcome.type) {
    case 'SENT':
      await update({ status: 'SENT', sentAt: now, lastError: null });
      await db
        .update(notificationChannel)
        .set({ consecutiveFailures: 0 })
        .where(eq(notificationChannel.id, d.channel.id));
      return;
    case 'RETRY_AFTER':
      await update({
        status: 'RETRYING',
        attempts: d.attempts - 1,
        nextAttemptAt: new Date(now.getTime() + outcome.seconds * 1000),
        lastError: 'rate limited by Telegram',
      });
      return;
    case 'MIGRATED':
      try {
        await db
          .update(notificationChannel)
          .set({ telegramChatId: outcome.chatId })
          .where(eq(notificationChannel.id, d.channel.id));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await update({
          status: 'FAILED',
          lastError: 'chat was migrated to a chat that is already linked',
        });
        return;
      }
      await update({ status: 'RETRYING', attempts: d.attempts - 1, nextAttemptAt: now });
      return;
    case 'PERMANENT':
      await update({ status: 'FAILED', lastError: outcome.error });
      await failChannel(db, d.channel.id);
      return;
    case 'TRANSIENT': {
      const retryAt = nextRetryAt(d.attempts, now);
      await update(
        retryAt
          ? { status: 'RETRYING', nextAttemptAt: retryAt, lastError: outcome.error }
          : { status: 'FAILED', lastError: outcome.error },
      );
      return;
    }
    case 'SKIPPED':
      await update({ status: 'FAILED', lastError: `skipped: ${outcome.reason}` });
      return;
  }
}
