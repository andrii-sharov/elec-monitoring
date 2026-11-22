import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { appUser, session } from '../db/schema/index.ts';
import { createSession, rotateRefreshToken } from './sessions.ts';

describe.skipIf(!pgTestUrl)('refresh rotation on real Postgres', () => {
  let t: PgTestDb;

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  test('two parallel rotations of one token give one ok and one racing', async () => {
    const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));
    const [user] = await t.db
      .insert(appUser)
      .values({ email: 'john@example.com', name: 'John', passwordHash: 'x' })
      .returning();
    const created = await createSession(t.db, clock, user!.id);

    const results = await Promise.all([
      rotateRefreshToken(t.db, clock, created.refreshToken),
      rotateRefreshToken(t.db, clock, created.refreshToken),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'racing')).toHaveLength(1);
    const [row] = await t.db.select().from(session);
    expect(row?.revokedAt).toBeNull();
  });
});
