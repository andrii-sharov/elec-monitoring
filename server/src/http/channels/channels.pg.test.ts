import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser, signIn } from '../../../test/auth.ts';
import { createWebhookChannel } from '../../../test/channels.ts';
import { createPgTestDb, pgTestUrl, type PgTestDb } from '../../../test/db.ts';
import { FakeClock } from '../../../test/fakes.ts';
import { notificationChannel } from '../../db/schema/index.ts';

describe.skipIf(!pgTestUrl)('webhook limit on real Postgres', () => {
  let t: PgTestDb;
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));

  beforeAll(async () => {
    t = await createPgTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  test('parallel creates cannot pass 10 webhooks', async () => {
    const user = await createUser(t.db);
    const { accessToken } = await signIn({ db: t.db, clock, config: testConfig }, user.id);
    for (let i = 0; i < 9; i += 1) await createWebhookChannel(t.db, user.id);
    const app = testApp({ db: t.db, clock });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/v1/channels')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            type: 'WEBHOOK',
            name: 'Hook',
            url: 'https://hooks.example.com/',
            events: ['device.offline'],
          }),
      ),
    );

    expect(responses.map((r) => r.status).toSorted()).toEqual([201, 409, 409, 409, 409]);
    const rows = await t.db
      .select()
      .from(notificationChannel)
      .where(eq(notificationChannel.userId, user.id));
    expect(rows).toHaveLength(10);
  });
});
