import type { Language } from '@elec/shared';
import type { TFunction } from 'i18next';

export type QuietHours = { start: string; end: string };

const DEFAULT_TIMEZONE = 'Europe/Kyiv';
const LOCALES: Record<Language, string> = { uk: 'uk-UA', en: 'en-GB', ru: 'ru-RU' };

function safeTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function parts(at: Date, locale: string, timezone: string) {
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone: safeTimezone(timezone),
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const pick = (type: string) => formatted.find((p) => p.type === type)?.value ?? '';
  return {
    day: pick('day'),
    month: pick('month'),
    time: `${pick('hour')}:${pick('minute')}`,
  };
}

export function formatDuration(seconds: number, t: TFunction): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return t('telegram.duration.seconds', { value: total });
  const minutes = Math.floor(total / 60);
  if (total < 3600) return t('telegram.duration.minutes', { value: minutes });
  const hours = Math.floor(total / 3600);
  if (total < 86_400) {
    const rest = minutes - hours * 60;
    const h = t('telegram.duration.hours', { value: hours });
    return rest === 0 ? h : `${h} ${t('telegram.duration.minutes', { value: rest })}`;
  }
  const days = Math.floor(total / 86_400);
  const restHours = Math.floor((total - days * 86_400) / 3600);
  const d = t('telegram.duration.days', { value: days });
  return restHours === 0 ? d : `${d} ${t('telegram.duration.hours', { value: restHours })}`;
}

export function formatMoment(at: Date, language: Language, timezone: string): string {
  const p = parts(at, LOCALES[language], timezone);
  return `${p.day} ${p.month} ${p.time}`;
}

export function formatRange(from: Date, to: Date, language: Language, timezone: string): string {
  const locale = LOCALES[language];
  const a = parts(from, locale, timezone);
  const b = parts(to, locale, timezone);
  if (a.day === b.day && a.month === b.month) return `${a.time} → ${b.time}`;
  return `${a.day} ${a.month} ${a.time} → ${b.day} ${b.month} ${b.time}`;
}

function minutesOf(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
}

export function isQuietTime(now: Date, quiet: QuietHours | null, timezone: string): boolean {
  if (!quiet) return false;
  const { time } = parts(now, 'en-GB', timezone);
  const current = minutesOf(time);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
