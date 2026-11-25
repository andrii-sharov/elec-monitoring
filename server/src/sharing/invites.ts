import type { Invite } from '@elec/shared/api';
import { and, count, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Executor, Tx } from '../db/client.ts';
import { appUser, device, deviceInvite, deviceViewer } from '../db/schema/index.ts';
import { HttpError } from '../http/errors.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';

export type InviteRow = typeof deviceInvite.$inferSelect;

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
export const MAX_MEMBERS = 10;

export function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    expires_at: row.expiresAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

async function isMember(tx: Tx, deviceId: string, email: string): Promise<boolean> {
  const [ownerMatch] = await tx
    .select({ id: device.id })
    .from(device)
    .innerJoin(appUser, eq(appUser.id, device.ownerId))
    .where(and(eq(device.id, deviceId), eq(sql`lower(${appUser.email})`, email)));
  if (ownerMatch) return true;
  const [viewerMatch] = await tx
    .select({ id: deviceViewer.userId })
    .from(deviceViewer)
    .innerJoin(appUser, eq(appUser.id, deviceViewer.userId))
    .where(and(eq(deviceViewer.deviceId, deviceId), eq(sql`lower(${appUser.email})`, email)));
  return Boolean(viewerMatch);
}

async function memberSlotsUsed(tx: Tx, deviceId: string, email: string, now: Date) {
  const [viewers] = await tx
    .select({ n: count() })
    .from(deviceViewer)
    .where(eq(deviceViewer.deviceId, deviceId));
  const [invites] = await tx
    .select({ n: count() })
    .from(deviceInvite)
    .where(
      and(
        eq(deviceInvite.deviceId, deviceId),
        isNull(deviceInvite.acceptedAt),
        gt(deviceInvite.expiresAt, now),
        ne(deviceInvite.email, email),
      ),
    );
  return (viewers?.n ?? 0) + (invites?.n ?? 0);
}

export async function createInvite(
  tx: Tx,
  clock: Clock,
  input: { deviceId: string; email: string; invitedBy: string },
): Promise<{ invite: InviteRow; token: string }> {
  const now = clock.now();
  if (await isMember(tx, input.deviceId, input.email)) {
    throw new HttpError(409, 'conflict', 'Already a member', [
      { path: 'email', code: 'already_member' },
    ]);
  }
  if ((await memberSlotsUsed(tx, input.deviceId, input.email, now)) >= MAX_MEMBERS) {
    throw new HttpError(409, 'conflict', 'Member limit reached');
  }
  const token = randomToken();
  const fields = {
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    invitedBy: input.invitedBy,
    createdAt: now,
  };
  const [invite] = await tx
    .insert(deviceInvite)
    .values({ deviceId: input.deviceId, email: input.email, ...fields })
    .onConflictDoUpdate({
      target: [deviceInvite.deviceId, deviceInvite.email],
      targetWhere: isNull(deviceInvite.acceptedAt),
      set: fields,
    })
    .returning();
  return { invite: invite!, token };
}

export async function findInviteByToken(db: Executor, token: string): Promise<InviteRow | null> {
  const [row] = await db
    .select()
    .from(deviceInvite)
    .where(eq(deviceInvite.tokenHash, sha256(token)));
  return row ?? null;
}

export function isExpired(invite: InviteRow, now: Date): boolean {
  return invite.expiresAt.getTime() <= now.getTime();
}
