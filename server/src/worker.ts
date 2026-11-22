import { hostname } from 'node:os';
import { systemClock } from './clock.ts';
import { loadConfigOrExit } from './config.ts';
import { createDb } from './db/client.ts';
import { beat } from './worker/heartbeat.ts';
import { runLoop } from './worker/loop.ts';

const WORKER_NAME = 'main';
const LOOP_INTERVAL_MS = 10_000;

const config = loadConfigOrExit(process.env);
const { db, close } = createDb(config.databaseUrl);
const instanceId = process.env.RENDER_INSTANCE_ID ?? `${hostname()}:${process.pid}`;
const controller = new AbortController();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => controller.abort());
}

console.info(`worker started (${instanceId})`);
await runLoop({
  intervalMs: LOOP_INTERVAL_MS,
  tick: () => beat(db, systemClock, WORKER_NAME, instanceId),
  signal: controller.signal,
  logger: console,
});
await close();
console.info('worker stopped');
