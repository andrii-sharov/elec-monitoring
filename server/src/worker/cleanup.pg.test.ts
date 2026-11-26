import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createUser } from '../../test/auth.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../test/db.ts';
import { FakeClock } from '../../test/fakes.ts';
import { refreshToken, session } from '../db/schema/index.ts';
import { sha256 } from '../lib/crypto.ts';
import { runCleanup } from './cleanup.ts';

describe.skipIf(!pgTestUrl)('runCleanup on real Postgres', () => {
  let t: PgTestDb;

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  test('deletes sessions whose refresh tokens have all expired', async () => {
    const user = await createUser(t.db);
    const now = new Date('2026-11-26T12:00:00Z');
    const rows = await t.db
      .insert(session)
      .values([{ userId: user.id }, { userId: user.id }])
      .returning({ id: session.id });
    await t.db.insert(refreshToken).values(
      rows.map((row, i) => ({
        tokenHash: sha256(`token-${i}`),
        sessionId: row.id,
        expiresAt: new Date(now.getTime() + (i === 0 ? -1000 : 1000)),
      })),
    );

    const result = await runCleanup(t.db, new FakeClock(now));

    expect(result.sessions).toBe(1);
    expect(await t.db.select({ id: session.id }).from(session)).toEqual([{ id: rows[1]!.id }]);
  });
});
