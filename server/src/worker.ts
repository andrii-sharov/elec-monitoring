import { hostname } from 'node:os';
import { systemClock } from './clock.ts';
import { loadWorkerConfigOrExit } from './config.ts';
import { createDb } from './db/client.ts';
import { createEmailSender } from './email/sender.ts';
import { createI18n } from './i18n.ts';
import { checkOffline, queueDueOffAlerts } from './monitoring/offline.ts';
import { runDeliveryLoop } from './notifications/deliveryLoop.ts';
import { createPacer } from './notifications/pacer.ts';
import { createNotificationQueue } from './notifications/queue.ts';
import { createTelegramTransport } from './notifications/telegram.ts';
import { cleanupRateLimits } from './rateLimit/cleanup.ts';
import { createWebhookSender } from './webhooks/sender.ts';
import { dailyRunner, runCleanup } from './worker/cleanup.ts';
import { beat } from './worker/heartbeat.ts';
import { defaultSleep, runLoop } from './worker/loop.ts';

const MONITOR_NAME = 'main';
const DELIVERY_NAME = 'delivery';
const OFFLINE_CHECK_INTERVAL_MS = 2_000;
const HOUSEKEEPING_INTERVAL_MS = 10_000;
const TELEGRAM_RATE_PER_S = 30;

const config = loadWorkerConfigOrExit(process.env);
const { db, close } = createDb(config.databaseUrl);
const instanceId = `${hostname()}:${process.pid}`;
const controller = new AbortController();
const logger = console;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => controller.abort());
}

const telegram = createTelegramTransport(config.telegram, logger);
const notifications = createNotificationQueue(systemClock);
const monitorDeps = { db, clock: systemClock, logger, notifications };
const dailyCleanup = dailyRunner(systemClock, async () => {
  logger.info('daily cleanup', await runCleanup(db, systemClock));
});

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error(`worker step failed: ${name}`, err);
  }
}

console.info(`worker started (${instanceId})`);
await Promise.all([
  runLoop({
    intervalMs: OFFLINE_CHECK_INTERVAL_MS,
    tick: async () => {
      await step('offline check', () => checkOffline(monitorDeps));
      await step('OFF alerts', () => queueDueOffAlerts(monitorDeps));
    },
    signal: controller.signal,
    logger,
  }),
  runLoop({
    intervalMs: HOUSEKEEPING_INTERVAL_MS,
    tick: async () => {
      await step('heartbeat', () => beat(db, systemClock, MONITOR_NAME, instanceId));
      await step('rate limit cleanup', () => cleanupRateLimits(db, systemClock));
      await step('daily cleanup', dailyCleanup);
    },
    signal: controller.signal,
    logger,
  }),
  runDeliveryLoop({
    db,
    clock: systemClock,
    logger,
    telegram,
    webhooks: createWebhookSender(),
    encryptionKey: config.encryptionKey,
    email: createEmailSender(config.email, logger),
    clientUrl: config.urls.client,
    i18n: createI18n(),
    pacer: createPacer({
      ratePerS: TELEGRAM_RATE_PER_S,
      clock: systemClock,
      sleep: (ms) => defaultSleep(ms, controller.signal),
    }),
    signal: controller.signal,
    beat: () => beat(db, systemClock, DELIVERY_NAME, instanceId),
  }),
]);
await close();
console.info('worker stopped');
