import type { i18n } from 'i18next';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import { defaultSleep, type Sleep } from '../worker/loop.ts';
import {
  claimDeliveries,
  recordOutcome,
  type ClaimedDelivery,
  type Outcome,
} from './deliveries.ts';
import { isQuietTime } from './format.ts';
import { renderDeliveryText } from './render.ts';
import type { TelegramClient } from './telegram.ts';

export const DELIVERY_BATCH = 30;
export const SEND_CONCURRENCY = 10;
const IDLE_SLEEP_MS = 1000;
const BEAT_EVERY_MS = 10_000;

export type DeliveryDeps = {
  db: Db;
  clock: Clock;
  logger: Logger;
  telegram: TelegramClient;
  i18n: i18n;
  pacer: { take(): Promise<void> };
};

async function decide(deps: DeliveryDeps, d: ClaimedDelivery): Promise<Outcome> {
  if (!d.hasAccess) return { type: 'SKIPPED', reason: 'no access' };
  if (!d.channel.enabled) return { type: 'SKIPPED', reason: 'channel disabled' };
  if (d.event === 'device.offline' && d.outageEndedAt) {
    return { type: 'SKIPPED', reason: 'outage closed' };
  }
  if (d.channel.type !== 'TELEGRAM_PLATFORM' || d.channel.chatId === null) {
    deps.logger.error(`no sender for channel type ${d.channel.type}`);
    return { type: 'PERMANENT', error: 'unsupported channel' };
  }
  const text = renderDeliveryText(deps.i18n, {
    payload: d.payload,
    offAlertQueued: d.offAlertQueued,
    language: d.recipient.language,
    timezone: d.recipient.timezone,
  });
  await deps.pacer.take();
  const silent = isQuietTime(deps.clock.now(), d.quietHours, d.recipient.timezone);
  return deps.telegram.sendMessage(d.channel.chatId, text, { silent });
}

async function handle(deps: DeliveryDeps, d: ClaimedDelivery): Promise<void> {
  let outcome: Outcome;
  try {
    outcome = await decide(deps, d);
  } catch (err) {
    deps.logger.error('delivery failed', d.id, err);
    outcome = { type: 'TRANSIENT', error: err instanceof Error ? err.message : String(err) };
  }
  await recordOutcome(deps.db, deps.clock, d, outcome);
}

export async function processDueDeliveries(deps: DeliveryDeps): Promise<number> {
  const claimed = await claimDeliveries(deps.db, deps.clock, DELIVERY_BATCH);
  const groups = new Map<string, ClaimedDelivery[]>();
  for (const d of claimed) {
    const group = groups.get(d.channel.id) ?? [];
    group.push(d);
    groups.set(d.channel.id, group);
  }

  const queue = [...groups.values()];
  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const d of group) await handle(deps, d);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));
  return claimed.length;
}

export async function runDeliveryLoop(
  deps: DeliveryDeps & { signal: AbortSignal; sleep?: Sleep; beat: () => Promise<void> },
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  let lastBeatMs = Number.NEGATIVE_INFINITY;
  while (!deps.signal.aborted) {
    let handled = 0;
    try {
      const nowMs = deps.clock.now().getTime();
      if (nowMs - lastBeatMs >= BEAT_EVERY_MS) {
        await deps.beat();
        lastBeatMs = nowMs;
      }
      handled = await processDueDeliveries(deps);
    } catch (err) {
      deps.logger.error(err);
    }
    if (deps.signal.aborted) break;
    if (handled === 0) await sleep(IDLE_SLEEP_MS, deps.signal);
  }
}
