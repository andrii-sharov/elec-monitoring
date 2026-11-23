import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createTestDb, type TestDb } from '../../test/db.ts';
import { createDevice } from '../../test/devices.ts';
import { seedDelivery } from '../../test/deliveries.ts';
import { FakeClock } from '../../test/fakes.ts';
import {
  appUser,
  delivery,
  deviceBoot,
  deviceDiagnostic,
  deviceInvite,
  oneTimeToken,
  outage,
  refreshToken,
  session,
} from '../db/schema/index.ts';
import { dailyRunner, runCleanup } from './cleanup.ts';

let t: TestDb;
const NOW = new Date('2026-11-21T16:42:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 3_600_000;
const D = 24 * H;
let clock: FakeClock;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
  clock = new FakeClock(NOW);
});

const hash = () => randomBytes(32);

describe('runCleanup', () => {
  test('deletes one-time tokens one day after expiry only', async () => {
    const user = await createUser(t.db);
    await t.db.insert(oneTimeToken).values([
      { tokenHash: hash(), userId: user.id, purpose: 'VERIFY_EMAIL', expiresAt: ago(25 * H) },
      { tokenHash: hash(), userId: user.id, purpose: 'VERIFY_EMAIL', expiresAt: ago(23 * H) },
    ]);
    const result = await runCleanup(t.db, clock);
    expect(result.oneTimeTokens).toBe(1);
    expect(await t.db.select().from(oneTimeToken)).toHaveLength(1);
  });

  test('deletes revoked sessions and sessions whose refresh tokens all expired', async () => {
    const user = await createUser(t.db);
    const [revoked, expired, live] = await t.db
      .insert(session)
      .values([{ userId: user.id, revokedAt: ago(H) }, { userId: user.id }, { userId: user.id }])
      .returning();
    await t.db.insert(refreshToken).values([
      { tokenHash: hash(), sessionId: revoked!.id, expiresAt: new Date(NOW.getTime() + D) },
      { tokenHash: hash(), sessionId: expired!.id, expiresAt: ago(H) },
      { tokenHash: hash(), sessionId: live!.id, expiresAt: ago(H) },
      { tokenHash: hash(), sessionId: live!.id, expiresAt: new Date(NOW.getTime() + D) },
    ]);
    const result = await runCleanup(t.db, clock);
    expect(result.sessions).toBe(2);
    expect((await t.db.select().from(session)).map((s) => s.id)).toEqual([live!.id]);
  });

  test('deletes invites 30 days after expiry only', async () => {
    const owner = await createUser(t.db);
    const dev = await createDevice(t.db, owner.id);
    await t.db.insert(deviceInvite).values([
      {
        deviceId: dev.id,
        email: 'a@example.com',
        invitedBy: owner.id,
        tokenHash: hash(),
        expiresAt: ago(31 * D),
      },
      {
        deviceId: dev.id,
        email: 'b@example.com',
        invitedBy: owner.id,
        tokenHash: hash(),
        expiresAt: ago(29 * D),
      },
    ]);
    const result = await runCleanup(t.db, clock);
    expect(result.invites).toBe(1);
  });

  test('deletes deliveries and diagnostics after 90 days, keeps outages and boots', async () => {
    const old = await seedDelivery(t.db, { createdAt: ago(91 * D), nextAttemptAt: ago(91 * D) });
    await seedDelivery(t.db, {
      user: old.user,
      device: old.device,
      channel: old.channel,
      outageId: old.outageId,
      event: 'device.online',
      createdAt: ago(89 * D),
    });
    const bootId = 'b738bb72-4172-4edd-8b30-8d5219d8f5f3';
    await t.db
      .insert(deviceBoot)
      .values({ deviceId: old.device.id, bootId, resetReason: 'POWER_ON' });
    await t.db.insert(deviceDiagnostic).values(
      [91, 89].map((days, i) => ({
        deviceId: old.device.id,
        bootId,
        localId: i,
        kind: 'WIFI' as const,
        startUptimeS: 1,
        endUptimeS: 2,
        startedAt: ago(days * D),
        endedAt: ago(days * D - 1000),
      })),
    );
    const result = await runCleanup(t.db, clock);
    expect(result.deliveries).toBe(1);
    expect(result.diagnostics).toBe(1);
    expect(await t.db.select().from(delivery)).toHaveLength(1);
    expect(await t.db.select().from(deviceDiagnostic)).toHaveLength(1);
    expect(await t.db.select().from(outage)).toHaveLength(1);
    expect(await t.db.select().from(deviceBoot)).toHaveLength(1);
  });
});

describe('dailyRunner', () => {
  test('runs on the first call, then again after 24 hours', async () => {
    let runs = 0;
    const tick = dailyRunner(clock, () => {
      runs += 1;
      return Promise.resolve();
    });
    await tick();
    expect(runs).toBe(1);
    clock.advance(24 * H - 60_000);
    await tick();
    expect(runs).toBe(1);
    clock.advance(60_000);
    await tick();
    expect(runs).toBe(2);
  });

  test('a failed run is retried on the next tick', async () => {
    let runs = 0;
    const tick = dailyRunner(clock, () => {
      runs += 1;
      return runs === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
    });
    await expect(tick()).rejects.toThrow('boom');
    await tick();
    expect(runs).toBe(2);
  });
});
