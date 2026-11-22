import { systemClock } from './clock.ts';
import { loadConfigOrExit } from './config.ts';
import { createDb } from './db/client.ts';
import { createApp } from './http/app.ts';
import { listen } from './http/listen.ts';

const config = loadConfigOrExit(process.env);
const { db, close } = createDb(config.databaseUrl);
const app = createApp({ db, clock: systemClock, logger: console, config });

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
  const server = await listen(app, config.port);
  console.info(`api listening on port ${config.port}`);
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
