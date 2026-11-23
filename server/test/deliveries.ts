import type { DeliveryEvent } from '@elec/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.ts';
import { appUser, delivery, device, outage } from '../src/db/schema/index.ts';
import { toOutageItem } from '../src/http/devices/views.ts';
import { createUser } from './auth.ts';
import { createPlatformChannel, linkChannel, type ChannelRow } from './channels.ts';
import { pairDevice, type DeviceRow } from './devices.ts';

type User = typeof appUser.$inferSelect;

export type SeedOptions = {
  user?: User;
  userOverrides?: Partial<typeof appUser.$inferInsert>;
  device?: DeviceRow;
  deviceOverrides?: Partial<typeof device.$inferInsert>;
  channel?: ChannelRow;
  channelOverrides?: { chatId?: bigint; enabled?: boolean };
  outageId?: string;
  outageOverrides?: Partial<typeof outage.$inferInsert>;
  event?: DeliveryEvent;
  createdAt?: Date;
  nextAttemptAt?: Date;
  status?: 'QUEUED' | 'SENT' | 'RETRYING' | 'FAILED';
  attempts?: number;
};

export async function seedDelivery(db: Db, o: SeedOptions = {}) {
  const user = o.user ?? (await createUser(db, o.userOverrides));
  const dev = o.device ?? (await pairDevice(db, user.id, o.deviceOverrides)).device;
  const channel = o.channel ?? (await createPlatformChannel(db, user.id, o.channelOverrides));
  if (!o.channel) await linkChannel(db, dev.id, channel.id);

  let outageId = o.outageId;
  if (!outageId) {
    const [created] = await db
      .insert(outage)
      .values({
        deviceId: dev.id,
        type: 'OUTAGE',
        startedAt: new Date('2026-11-21T16:42:00Z'),
        ...o.outageOverrides,
      })
      .returning({ id: outage.id });
    outageId = created!.id;
  }
  const [row] = await db.select().from(outage).where(eq(outage.id, outageId));
  const event = o.event ?? 'device.offline';
  const createdAt = o.createdAt ?? new Date('2026-11-21T16:44:00Z');
  const [inserted] = await db
    .insert(delivery)
    .values({
      outageId,
      channelId: channel.id,
      event,
      payload: { event, device: { id: dev.id, name: dev.name }, outage: toOutageItem(row!) },
      createdAt,
      nextAttemptAt: o.nextAttemptAt ?? createdAt,
      status: o.status ?? 'QUEUED',
      attempts: o.attempts ?? 0,
    })
    .returning();
  return { user, device: dev, channel, outageId, delivery: inserted! };
}
