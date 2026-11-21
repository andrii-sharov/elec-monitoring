import { createApp } from './app.js';
import { createMonitor } from './monitor.js';
import { createTelegramNotifier } from './telegram.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const seconds = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 1000;

const notifyTelegram = createTelegramNotifier(
  requireEnv('TELEGRAM_BOT_TOKEN'),
  requireEnv('TELEGRAM_CHAT_ID'),
);

const monitor = createMonitor({
  offlineTimeoutMs: seconds('OFFLINE_TIMEOUT', 120),
  now: () => new Date(),
  notify: notifyTelegram,
});

setInterval(monitor.check, seconds('CHECK_INTERVAL', 10));

const port = Number(process.env.PORT ?? 3000);
createApp(monitor, requireEnv('DEVICE_TOKEN')).listen(port, () => {
  console.log(`Listening on port ${port}`);
});
