import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../test/channels.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { markOffline, pairDevice } from '../../test/devices.ts';
import { FakeClock } from '../../test/fakes.ts';
import { addViewer } from '../../test/sharing.ts';
import { appUser, delivery, device, notificationChannel, outage } from '../db/schema/index.ts';
import { toOutageItem } from '../http/devices/views.ts';
import { createNotificationQueue } from './queue.ts';

let t: TestDb;
const clock = new FakeClock(new Date('2026-11-21T16:50:00Z'));
const queue = createNotificationQueue(clock);

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
});

async function openOutage(ownerId: string, overrides: Partial<typeof device.$inferInsert> = {}) {
  const { device: row } = await pairDevice(t.db, ownerId, {
    state: 'ONLINE',
    lastSeenAt: new Date('2026-11-21T16:42:00Z'),
    offlineAt: new Date('2026-11-21T16:44:00Z'),
    ...overrides,
  });
  const outageId = await markOffline(t.db, row.id);
  return { deviceId: row.id, outageId };
}

const run = (fn: (tx: Parameters<Parameters<typeof t.db.transaction>[0]>[0]) => Promise<void>) =>
  t.db.transaction(fn);

describe('createNotificationQueue', () => {
  test('offAlert fans out to every linked enabled channel of the owner', async () => {
    const owner = await createUser(t.db);
    const { deviceId, outageId } = await openOutage(owner.id);
    const a = await createPlatformChannel(t.db, owner.id);
    const b = await createPlatformChannel(t.db, owner.id);
    await createPlatformChannel(t.db, owner.id);
    await linkChannel(t.db, deviceId, a.id);
    await linkChannel(t.db, deviceId, b.id);

    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));

    const rows = await t.db.select().from(delivery);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channelId).toSorted()).toEqual([a.id, b.id].toSorted());
    const [row] = rows;
    expect(row!.event).toBe('device.offline');
    expect(row!.status).toBe('QUEUED');
    expect(row!.createdAt).toEqual(clock.now());
    expect(row!.nextAttemptAt).toEqual(clock.now());
    const [open] = await t.db.select().from(outage).where(eq(outage.id, outageId));
    expect(row!.payload).toEqual({
      event: 'device.offline',
      device: { id: deviceId, name: 'Home' },
      outage: toOutageItem(open!),
    });
  });

  test('queueing the same event twice keeps one delivery per channel', async () => {
    const owner = await createUser(t.db);
    const { deviceId, outageId } = await openOutage(owner.id);
    const a = await createPlatformChannel(t.db, owner.id);
    await linkChannel(t.db, deviceId, a.id);

    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));
    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));

    expect(await t.db.select().from(delivery)).toHaveLength(1);
  });

  test('skips a disabled channel', async () => {
    const owner = await createUser(t.db);
    const { deviceId, outageId } = await openOutage(owner.id);
    const a = await createPlatformChannel(t.db, owner.id, { enabled: false });
    await linkChannel(t.db, deviceId, a.id);

    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));

    expect(await t.db.select().from(delivery)).toHaveLength(0);
  });

  test("skips a channel of a user who can't read the device", async () => {
    const owner = await createUser(t.db);
    const stranger = await createUser(t.db, { email: 'jane@example.com' });
    const { deviceId, outageId } = await openOutage(owner.id);
    const foreign = await createPlatformChannel(t.db, stranger.id);
    await linkChannel(t.db, deviceId, foreign.id);

    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));

    expect(await t.db.select().from(delivery)).toHaveLength(0);
  });

  test('summary is skipped for a SHORT outage when short alerts are off', async () => {
    const owner = await createUser(t.db);
    const { deviceId, outageId } = await openOutage(owner.id, { notifyShortOutages: false });
    await t.db
      .update(outage)
      .set({ endedAt: new Date('2026-11-21T16:44:30Z'), cause: 'POWER', kind: 'SHORT' })
      .where(eq(outage.id, outageId));
    const a = await createPlatformChannel(t.db, owner.id);
    await linkChannel(t.db, deviceId, a.id);

    await run((tx) => queue.summary(tx, { deviceId, outageId }));

    expect(await t.db.select().from(delivery)).toHaveLength(0);
  });

  test('recovery is sent for a NETWORK outage when network alerts are off', async () => {
    const owner = await createUser(t.db);
    const { deviceId, outageId } = await openOutage(owner.id, { notifyNetworkOutages: false });
    await t.db
      .update(outage)
      .set({ endedAt: new Date('2026-11-21T16:50:00Z'), cause: 'NETWORK', kind: 'LONG' })
      .where(eq(outage.id, outageId));
    const a = await createPlatformChannel(t.db, owner.id);
    await linkChannel(t.db, deviceId, a.id);

    await run((tx) => queue.recovery(tx, { deviceId, outageId }));

    const rows = await t.db.select().from(delivery);
    expect(rows.map((r) => r.event)).toEqual(['device.online']);
  });

  test('a channel deleted with its user leaves no deliveries behind', async () => {
    const owner = await createUser(t.db);
    const { deviceId, outageId } = await openOutage(owner.id);
    const a = await createPlatformChannel(t.db, owner.id);
    await linkChannel(t.db, deviceId, a.id);
    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));
    await t.db.delete(notificationChannel).where(eq(notificationChannel.id, a.id));
    expect(await t.db.select().from(delivery)).toHaveLength(0);
  });
});

describe('fan-out to viewers', () => {
  async function shared() {
    const owner = await createUser(t.db, { email: 'john@example.com' });
    const viewer = await createUser(t.db, { email: 'mary@example.com' });
    const stranger = await createUser(t.db, { email: 'pete@example.com' });
    const { deviceId, outageId } = await openOutage(owner.id);
    await addViewer(t.db, deviceId, viewer.id);
    return { owner, viewer, stranger, deviceId, outageId };
  }

  test('queues for the owner and viewers, never a stranger', async () => {
    const { owner, viewer, stranger, deviceId, outageId } = await shared();
    const mine = await createPlatformChannel(t.db, owner.id);
    const theirs = await createPlatformChannel(t.db, viewer.id);
    const foreign = await createPlatformChannel(t.db, stranger.id);
    for (const c of [mine, theirs, foreign]) await linkChannel(t.db, deviceId, c.id);

    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));

    const rows = await t.db.select().from(delivery);
    expect(rows.map((r) => r.channelId).toSorted()).toEqual([mine.id, theirs.id].toSorted());
  });

  test('skips a disabled viewer channel', async () => {
    const { viewer, deviceId, outageId } = await shared();
    const off = await createPlatformChannel(t.db, viewer.id, { enabled: false });
    await linkChannel(t.db, deviceId, off.id);
    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));
    expect(await t.db.select().from(delivery)).toEqual([]);
  });

  test('skips a viewer webhook without the event', async () => {
    const { viewer, deviceId, outageId } = await shared();
    const [hook] = await t.db
      .insert(notificationChannel)
      .values({
        userId: viewer.id,
        type: 'WEBHOOK',
        name: 'Hook',
        webhookUrl: 'https://hooks.example.com/x',
        webhookEvents: ['device.online'],
        webhookSecretEnc: Buffer.from('secret'),
      })
      .returning();
    await linkChannel(t.db, deviceId, hook!.id);
    await run((tx) => queue.offAlert(tx, { deviceId, outageId }));
    expect(await t.db.select().from(delivery)).toEqual([]);
  });
});
