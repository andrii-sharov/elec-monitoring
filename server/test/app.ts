import type { Express } from 'express';
import type { Config } from '../src/config.ts';
import type { Db } from '../src/db/client.ts';
import { memoryStore } from '../src/firmware/store.ts';
import { createApp, type AppDeps } from '../src/http/app.ts';
import {
  FakeClock,
  FakeEmailSender,
  FakeGoogleClient,
  FakeTelegramClient,
  FakeWebhookSender,
  RecordingNotificationQueue,
  allowAllLimiter,
  silentLogger,
} from './fakes.ts';

export const testConfig: Config = {
  databaseUrl: 'postgres://localhost/test',
  port: 0,
  jwtSecret: 'x'.repeat(32),
  encryptionKey: Buffer.alloc(32, 1),
  urls: { client: 'https://app.test', admin: 'https://admin.test', api: 'https://api.test' },
  google: { clientId: 'google-client-id', clientSecret: 'google-client-secret' },
  email: { transport: 'log', from: 'Electricity Monitor <noreply@app.test>' },
  trustProxyHops: 0,
  telegram: { botUsername: 'TestBot', webhookSecret: 's'.repeat(32), transport: 'log' },
  firmware: { store: 'fs', dir: '/nonexistent' },
};

export function testApp(
  overrides: Partial<AppDeps> & { routes?: (app: Express) => void } = {},
): Express {
  const { routes, ...deps } = overrides;
  const clock = deps.clock ?? new FakeClock(new Date('2026-11-21T16:42:00Z'));
  return createApp(
    {
      db: {} as Db,
      clock,
      logger: silentLogger(),
      config: testConfig,
      email: new FakeEmailSender(),
      google: new FakeGoogleClient(),
      rateLimiter: allowAllLimiter,
      notifications: new RecordingNotificationQueue(),
      firmware: memoryStore(),
      telegram: new FakeTelegramClient(clock),
      webhooks: new FakeWebhookSender(),
      ...deps,
    },
    routes,
  );
}
