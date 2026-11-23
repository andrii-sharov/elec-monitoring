import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { testApp } from '../../../test/app.ts';
import { createUser } from '../../../test/auth.ts';
import { createTestDb, type TestDb } from '../../../test/db.ts';
import { createDevice, pairDevice } from '../../../test/devices.ts';
import { appUser } from '../../db/schema/index.ts';
import { newDeviceToken } from '../../devices/credentials.ts';
import { getDeviceAuth, requireDevice } from './auth.ts';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.db.delete(appUser);
});

function app() {
  return testApp({
    db: t.db,
    routes: (a) => {
      a.get('/device-auth', requireDevice({ db: t.db }), (_req, res) => {
        res.json({ deviceId: getDeviceAuth(res).deviceId });
      });
    },
  });
}

test('a valid device token authenticates the device', async () => {
  const user = await createUser(t.db);
  const { device, token } = await pairDevice(t.db, user.id);
  const res = await request(app()).get('/device-auth').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ deviceId: device.id });
});

test.each([
  ['no header', undefined],
  ['basic auth', 'Basic abc'],
  ['wrong format', 'Bearer not-a-token'],
  ['unknown token', `Bearer ${newDeviceToken()}`],
])('%s is unauthorized', async (_name, header) => {
  const req = request(app()).get('/device-auth');
  const res = header ? await req.set('Authorization', header) : await req;
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('unauthorized');
});

test('a device without a token (rotated) is unauthorized', async () => {
  const user = await createUser(t.db);
  await createDevice(t.db, user.id);
  const res = await request(app())
    .get('/device-auth')
    .set('Authorization', `Bearer ${'0'.repeat(64)}`);
  expect(res.status).toBe(401);
});
