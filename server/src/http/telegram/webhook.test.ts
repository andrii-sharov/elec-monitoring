import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { testApp, testConfig } from '../../../test/app.ts';
import { createUser } from '../../../test/auth.ts';
import { createPlatformChannel, linkChannel } from '../../../test/channels.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice } from '../../../test/devices.ts';
import { silentLogger } from '../../../test/fakes.ts';
import { appUser } from '../../db/schema/index.ts';

let t: TestDb;
const secret = testConfig.telegram.webhookSecret;
const path = `/telegram/webhook/${secret}`;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
});

const post = (body: unknown, headerSecret: string | null = secret, urlPath = path) => {
  const req = request(testApp({ db: t.db })).post(urlPath);
  if (headerSecret !== null) req.set('X-Telegram-Bot-Api-Secret-Token', headerSecret);
  return req.send(body as object);
};

const status = { message: { chat: { id: 555, type: 'private' }, text: '/status' } };

describe('POST /telegram/webhook/:secret', () => {
  test('a wrong path secret is 404', async () => {
    expect((await post(status, secret, '/telegram/webhook/nope')).status).toBe(404);
  });

  test.each([null, 'wrong'])('header %s is 404', async (header) => {
    expect((await post(status, header)).status).toBe(404);
  });

  test('replies to a command through the webhook response', async () => {
    const user = await createUser(t.db, { language: 'en' });
    const dev = await createDevice(t.db, user.id, { name: 'Home' });
    const channel = await createPlatformChannel(t.db, user.id, { chatId: 555n });
    await linkChannel(t.db, dev.id, channel.id);
    const res = await post(status);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ method: 'sendMessage', chat_id: '555' });
    expect(res.body.text).toContain('Home');
  });

  test('a non-text update is 200 with an empty body', async () => {
    const res = await post({ message: { chat: { id: 555, type: 'private' }, sticker: {} } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('a malformed body is 200 with an empty body', async () => {
    const res = await post({ message: 'nonsense' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('a handler error is logged and still answered with 200', async () => {
    const logger = silentLogger();
    const broken = {
      select: () => {
        throw new Error('db down');
      },
      transaction: () => Promise.reject(new Error('db down')),
      delete: () => {
        throw new Error('db down');
      },
    };
    const res = await request(testApp({ db: broken as never, logger }))
      .post(path)
      .set('X-Telegram-Bot-Api-Secret-Token', secret)
      .send(status);
    expect(res.status).toBe(200);
    expect(logger.error).toHaveBeenCalled();
  });

  test('is not in the public OpenAPI document', async () => {
    const res = await request(testApp({ db: t.db })).get('/api/v1/openapi.json');
    expect(Object.keys(res.body.paths).some((p) => p.includes('telegram/webhook'))).toBe(false);
  });
});
