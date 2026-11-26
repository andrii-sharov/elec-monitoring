import type { ChannelType } from '@elec/shared';
import { eq } from 'drizzle-orm';
import type { i18n } from 'i18next';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { notificationChannel } from '../db/schema/index.ts';
import { sendInBackground, type EmailSender } from '../email/sender.ts';
import { renderEmail } from '../email/templates.ts';
import { decrypt } from '../lib/crypto.ts';
import type { Logger } from '../logger.ts';
import type { WebhookSender } from '../webhooks/sender.ts';
import { defaultSleep, type Sleep } from '../worker/loop.ts';
import {
  claimDeliveries,
  recordOutcome,
  releaseDelivery,
  type ClaimedDelivery,
  type Outcome,
} from './deliveries.ts';
import { isQuietTime } from './format.ts';
import { renderDeliveryText } from './render.ts';
import type { TelegramClient } from './telegram.ts';

export const DELIVERY_BATCH = 30;
export const WEBHOOK_BATCH = 10;
export const SEND_CONCURRENCY = 10;
const IDLE_SLEEP_MS = 1000;
const BEAT_EVERY_MS = 10_000;

export type DeliveryDeps = {
  db: Db;
  clock: Clock;
  logger: Logger;
  telegram: TelegramClient;
  webhooks: WebhookSender;
  encryptionKey: Buffer;
  email: EmailSender;
  clientUrl: string;
  i18n: i18n;
  pacer: { take(): Promise<void> };
};

type Lane = { type: ChannelType; batch: number };

const TELEGRAM_LANE: Lane = { type: 'TELEGRAM_PLATFORM', batch: DELIVERY_BATCH };
const WEBHOOK_LANE: Lane = { type: 'WEBHOOK', batch: WEBHOOK_BATCH };

async function sendWebhook(deps: DeliveryDeps, d: ClaimedDelivery): Promise<Outcome> {
  const [channel] = await deps.db
    .select({
      enabled: notificationChannel.enabled,
      url: notificationChannel.webhookUrl,
      secretEnc: notificationChannel.webhookSecretEnc,
    })
    .from(notificationChannel)
    .where(eq(notificationChannel.id, d.channel.id));
  if (!channel) return { type: 'SKIPPED', reason: 'channel deleted' };
  if (!channel.enabled) return { type: 'SKIPPED', reason: 'channel disabled' };

  let secret: string;
  try {
    secret = decrypt(deps.encryptionKey, channel.secretEnc!);
  } catch {
    const error = 'webhook secret could not be decrypted';
    deps.logger.error(error, d.channel.id);
    return { type: 'TRANSIENT', error };
  }
  const result = await deps.webhooks.send({
    url: channel.url!,
    secret,
    event: d.event,
    deliveryId: d.id,
    body: JSON.stringify({ ...d.payload, sent_at: deps.clock.now().toISOString() }),
  });
  if (result.type === 'SENT') return { type: 'SENT' };
  return { type: 'WEBHOOK_FAILED', error: result.error };
}

async function decide(deps: DeliveryDeps, d: ClaimedDelivery): Promise<Outcome> {
  if (!d.hasAccess) return { type: 'SKIPPED', reason: 'no access' };
  if (!d.channel.enabled) return { type: 'SKIPPED', reason: 'channel disabled' };
  if (d.channel.type === 'WEBHOOK') return sendWebhook(deps, d);
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

function emailWebhookDisabled(deps: DeliveryDeps, d: ClaimedDelivery): void {
  const { email, name, language } = d.owner;
  if (!email) return;
  const rendered = renderEmail(deps.i18n, 'webhookDisabled', {
    lang: language,
    name,
    link: `${deps.clientUrl}/notifications?type=WEBHOOK`,
    channelName: d.channel.name,
  });
  sendInBackground(deps.email, deps.logger, { to: email, ...rendered });
}

async function handle(deps: DeliveryDeps, d: ClaimedDelivery): Promise<void> {
  let outcome: Outcome;
  try {
    outcome = await decide(deps, d);
  } catch (err) {
    deps.logger.error('delivery failed', d.id, err);
    const error = err instanceof Error ? err.message : String(err);
    outcome = { type: d.channel.type === 'WEBHOOK' ? 'WEBHOOK_FAILED' : 'TRANSIENT', error };
  }
  const { disabled } = await recordOutcome(deps.db, deps.clock, d, outcome);
  if (disabled && d.channel.type === 'WEBHOOK') emailWebhookDisabled(deps, d);
}

async function processLane(deps: DeliveryDeps, lane: Lane, signal?: AbortSignal): Promise<number> {
  const claimed = await claimDeliveries(deps.db, deps.clock, lane.batch, lane.type);
  const groups = new Map<string, ClaimedDelivery[]>();
  for (const d of claimed) {
    const group = groups.get(d.channel.id) ?? [];
    group.push(d);
    groups.set(d.channel.id, group);
  }

  const queue = [...groups.values()];
  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const d of group) {
        if (signal?.aborted) await releaseDelivery(deps.db, deps.clock, d);
        else await handle(deps, d);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));
  return claimed.length;
}

export async function processDueDeliveries(deps: DeliveryDeps): Promise<number> {
  const handled = await Promise.all([
    processLane(deps, TELEGRAM_LANE),
    processLane(deps, WEBHOOK_LANE),
  ]);
  return handled[0] + handled[1];
}

type LoopDeps = DeliveryDeps & { signal: AbortSignal; sleep?: Sleep };

async function runLane(deps: LoopDeps, lane: Lane, beat?: () => Promise<void>): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  let lastBeatMs = Number.NEGATIVE_INFINITY;
  while (!deps.signal.aborted) {
    let handled = 0;
    try {
      const nowMs = deps.clock.now().getTime();
      if (beat && nowMs - lastBeatMs >= BEAT_EVERY_MS) {
        await beat();
        lastBeatMs = nowMs;
      }
      handled = await processLane(deps, lane, deps.signal);
    } catch (err) {
      deps.logger.error(err);
    }
    if (deps.signal.aborted) break;
    if (handled === 0) await sleep(IDLE_SLEEP_MS, deps.signal);
  }
}

export async function runDeliveryLoop(
  deps: LoopDeps & { beat: () => Promise<void> },
): Promise<void> {
  await Promise.all([runLane(deps, TELEGRAM_LANE, deps.beat), runLane(deps, WEBHOOK_LANE)]);
}
