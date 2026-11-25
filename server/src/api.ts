import { systemClock } from './clock.ts';
import { loadConfigOrExit } from './config.ts';
import { createDb } from './db/client.ts';
import { createGoogleClient } from './auth/google.ts';
import { createEmailSender } from './email/sender.ts';
import { createFirmwareStore } from './firmware/store.ts';
import { createApp } from './http/app.ts';
import { listen } from './http/listen.ts';
import { createNotificationQueue } from './notifications/queue.ts';
import { createTelegramTransport } from './notifications/telegram.ts';
import { createPgRateLimiter } from './rateLimit/limiter.ts';

const config = loadConfigOrExit(process.env);
const { db, close } = createDb(config.databaseUrl);
const app = createApp({
  db,
  clock: systemClock,
  logger: console,
  config,
  email: createEmailSender(config.email, console),
  google: createGoogleClient(config),
  rateLimiter: createPgRateLimiter(db, systemClock),
  notifications: createNotificationQueue(systemClock),
  firmware: createFirmwareStore(config.firmware),
  telegram: createTelegramTransport(config.telegram, console),
});

async function shutdown(exitCode: number): Promise<never> {
  try {
    await close();
  } catch (err) {
    console.error(err);
    exitCode = 1;
  }
  process.exit(exitCode);
}

try {
  const server = await listen(app, config.port, config.host);
  console.info(`api listening on ${config.host ?? '*'}:${config.port}`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      server.close(() => {
        console.info('api stopped');
        void shutdown(0);
      });
    });
  }
} catch (err) {
  console.error(err);
  await shutdown(1);
}
