import { hostname } from 'node:os';
import { systemClock } from './clock.ts';
import { loadDatabaseConfigOrExit } from './config.ts';
import { createDb } from './db/client.ts';
import { cleanupRateLimits } from './rateLimit/cleanup.ts';
import { beat } from './worker/heartbeat.ts';
import { runLoop } from './worker/loop.ts';

const WORKER_NAME = 'main';
const LOOP_INTERVAL_MS = 10_000;

const config = loadDatabaseConfigOrExit(process.env);
const { db, close } = createDb(config.databaseUrl);
const instanceId = `${hostname()}:${process.pid}`;
const controller = new AbortController();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => controller.abort());
}

console.info(`worker started (${instanceId})`);
await runLoop({
  intervalMs: LOOP_INTERVAL_MS,
  tick: async () => {
    await beat(db, systemClock, WORKER_NAME, instanceId);
    await cleanupRateLimits(db, systemClock);
  },
  signal: controller.signal,
  logger: console,
});
await close();
console.info('worker stopped');
