import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../test/db.ts';
import { createDevice } from '../../test/devices.ts';
import { FakeClock } from '../../test/fakes.ts';
import { seedInvite } from '../../test/sharing.ts';
import { HttpError } from '../http/errors.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { acceptInvite, applyPendingInvites } from './invites.ts';

function outcome(result: PromiseSettledResult<unknown> | undefined): string | number {
  if (result?.status === 'fulfilled') return 'ok';
  const reason: unknown = result?.reason;
  return reason instanceof HttpError ? reason.status : String(reason);
}

describe.skipIf(!pgTestUrl)('invite locking on real Postgres', () => {
  let t: PgTestDb;
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  async function waitForLockWait() {
    for (let i = 0; i < 100; i += 1) {
      const [row] = await t.sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`;
      if ((row?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('no transaction started waiting for a lock');
  }

  async function raceWithResend(run: () => Promise<unknown>, deviceId: string, inviteId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const deviceLocked = new Promise<void>((resolve) => (locked = resolve));
    const resend = t.sql.begin(async (tx) => {
      await tx`select id from device where id = ${deviceId} for update`;
      locked();
      await gate;
      await tx`update device_invite set token_hash = ${sha256(randomToken())} where id = ${inviteId}`;
    });
    await deviceLocked;
    const other = run();
    await waitForLockWait();
    release();
    return Promise.allSettled([resend, other]);
  }

  test('accept waits for the device lock instead of deadlocking with a resend', async () => {
    const owner = await createUser(t.db, { email: 'john-a@example.com' });
    const mary = await createUser(t.db, { email: 'mary-a@example.com' });
    const home = await createDevice(t.db, owner.id);
    const invite = await seedInvite(t.db, {
      deviceId: home.id,
      invitedBy: owner.id,
      email: 'mary-a@example.com',
    });

    const results = await raceWithResend(
      () => t.db.transaction((tx) => acceptInvite(tx, clock, invite.token, mary)),
      home.id,
      invite.id,
    );

    expect(outcome(results[0])).toBe('ok');
    expect(['ok', 410]).toContain(outcome(results[1]));
  });

  test('auto-accept waits for the device lock instead of deadlocking with a resend', async () => {
    const owner = await createUser(t.db, { email: 'john-b@example.com' });
    const mary = await createUser(t.db, { email: 'mary-b@example.com' });
    const home = await createDevice(t.db, owner.id);
    const invite = await seedInvite(t.db, {
      deviceId: home.id,
      invitedBy: owner.id,
      email: 'mary-b@example.com',
    });

    const results = await raceWithResend(
      () =>
        t.db.transaction((tx) => applyPendingInvites(tx, clock, mary.id, { email: mary.email! })),
      home.id,
      invite.id,
    );

    expect(outcome(results[0])).toBe('ok');
    expect(['ok', 410]).toContain(outcome(results[1]));
  });
});
