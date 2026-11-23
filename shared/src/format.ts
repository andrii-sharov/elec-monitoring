import type { Language } from './enums.ts';

export type DurationKey =
  | 'common.duration.seconds'
  | 'common.duration.minutes'
  | 'common.duration.hours'
  | 'common.duration.days';

export type Translate = (key: DurationKey, options: { value: number }) => string;

const DEFAULT_TIMEZONE = 'Europe/Kyiv';
const LOCALES: Record<Language, string> = { uk: 'uk-UA', en: 'en-GB', ru: 'ru-RU' };

function safeTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function momentParts(at: Date, locale: string, timezone: string) {
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

export function formatDuration(seconds: number, t: Translate): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return t('common.duration.seconds', { value: total });
  const minutes = Math.floor(total / 60);
  if (total < 3600) return t('common.duration.minutes', { value: minutes });
  const hours = Math.floor(total / 3600);
  if (total < 86_400) {
    const rest = minutes - hours * 60;
    const h = t('common.duration.hours', { value: hours });
    return rest === 0 ? h : `${h} ${t('common.duration.minutes', { value: rest })}`;
  }
  const days = Math.floor(total / 86_400);
  const restHours = Math.floor((total - days * 86_400) / 3600);
  const d = t('common.duration.days', { value: days });
  return restHours === 0 ? d : `${d} ${t('common.duration.hours', { value: restHours })}`;
}

export function formatMoment(at: Date, language: Language, timezone: string): string {
  const p = momentParts(at, LOCALES[language], timezone);
  return `${p.day} ${p.month} ${p.time}`;
}

export function formatRange(from: Date, to: Date, language: Language, timezone: string): string {
  const locale = LOCALES[language];
  const a = momentParts(from, locale, timezone);
  const b = momentParts(to, locale, timezone);
  if (a.day === b.day && a.month === b.month) return `${a.time} → ${b.time}`;
  return `${a.day} ${a.month} ${a.time} → ${b.day} ${b.month} ${b.time}`;
}
