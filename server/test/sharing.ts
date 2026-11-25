import type { Db } from '../src/db/client.ts';
import { deviceInvite, deviceViewer } from '../src/db/schema/index.ts';
import { randomToken, sha256 } from '../src/lib/crypto.ts';

export async function addViewer(db: Db, deviceId: string, userId: string): Promise<void> {
  await db.insert(deviceViewer).values({ deviceId, userId });
}

export async function seedInvite(
  db: Db,
  o: {
    deviceId: string;
    invitedBy: string;
    email: string;
    expiresAt?: Date;
    acceptedAt?: Date | null;
  },
): Promise<{ id: string; token: string }> {
  const token = randomToken();
  const [row] = await db
    .insert(deviceInvite)
    .values({
      deviceId: o.deviceId,
      invitedBy: o.invitedBy,
      email: o.email,
      tokenHash: sha256(token),
      expiresAt: o.expiresAt ?? new Date('2026-11-28T16:42:00Z'),
      acceptedAt: o.acceptedAt ?? null,
      createdAt: new Date('2026-11-21T16:42:00Z'),
    })
    .returning({ id: deviceInvite.id });
  return { id: row!.id, token };
}
