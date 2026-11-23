import type { DeliveryEvent, Language } from '@elec/shared';
import type { i18n } from 'i18next';
import type { OutageItem } from '@elec/shared/api';
import { formatDuration, formatMoment, formatRange } from './format.ts';

export type DeliveryPayload = {
  event: DeliveryEvent;
  device: { id: string; name: string };
  outage: OutageItem;
};

export type RenderInput = {
  payload: DeliveryPayload;
  offAlertQueued: boolean;
  language: Language;
  timezone: string;
};

export function renderDeliveryText(i18n: i18n, input: RenderInput): string {
  const { payload, language, timezone } = input;
  const t = i18n.getFixedT(language);
  const { outage, device } = payload;
  const name = device.name;
  const started = new Date(outage.started_at);
  const ended = outage.ended_at ? new Date(outage.ended_at) : null;
  const duration = formatDuration(outage.duration_s ?? 0, t);

  if (payload.event === 'device.offline') {
    return [
      t('telegram.offline.title', { name }),
      t('telegram.offline.body', { time: formatMoment(started, language, timezone) }),
    ].join('\n');
  }

  if (payload.event === 'device.power_blip') {
    const title =
      outage.kind === 'LONG' ? 'telegram.powerBlip.titleLong' : 'telegram.powerBlip.titleShort';
    return [t(title, { name }), t('telegram.powerBlip.body', { duration })].join('\n');
  }

  const title = input.offAlertQueued
    ? t('telegram.recovery.title', { name })
    : t('telegram.summary.title', { name });
  const range = ended ? formatRange(started, ended, language, timezone) : '';
  const cause =
    outage.cause === 'POWER' || outage.cause === 'NETWORK'
      ? ` · ${t(`telegram.cause.${outage.cause}`)}`
      : '';
  return [title, `${t('telegram.recovery.body', { duration, range })}${cause}`].join('\n');
}
