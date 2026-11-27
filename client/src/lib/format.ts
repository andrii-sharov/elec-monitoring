import {
  defaultLanguage,
  formatDuration,
  formatMoment,
  formatRange,
  formatTime,
  languages,
  LOCALES,
} from '@elec/shared';
import type { Language } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/api/session';

export type Formatters = {
  moment(iso: string): string;
  duration(seconds: number): string;
  range(fromIso: string, toIso: string): string;
  since(iso: string, now?: Date): string;
  time(iso: string): string;
  day(date: string, options: Intl.DateTimeFormatOptions): string;
  days(from: string, to: string): string;
  full(iso: string): string;
  exactDuration(seconds: number): string;
  percent(value: number): string;
  timezone: string;
  language: Language;
};

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useFormatters(): Formatters {
  const { me } = useSession();
  const { t, i18n } = useTranslation();
  const uiLanguage = languages.find((language) => language === i18n.resolvedLanguage);
  const language: Language = me?.language ?? uiLanguage ?? defaultLanguage;
  const timezone = me?.timezone ?? browserTimezone();
  const duration = (seconds: number) =>
    formatDuration(seconds, (key, values) => t(key, { ...values, lng: language }));
  const moment = (iso: string) => formatMoment(new Date(iso), language, timezone);
  return {
    moment,
    duration,
    range: (fromIso, toIso) => formatRange(new Date(fromIso), new Date(toIso), language, timezone),
    since: (iso, now = new Date()) =>
      `${moment(iso)} · ${duration((now.getTime() - new Date(iso).getTime()) / 1000)}`,
    time: (iso) => formatTime(new Date(iso), language, timezone),
    day: (date, options) =>
      new Intl.DateTimeFormat(LOCALES[language], { ...options, timeZone: 'UTC' }).format(
        Date.parse(date),
      ),
    days: (from, to) =>
      new Intl.DateTimeFormat(LOCALES[language], {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).formatRange(Date.parse(from), Date.parse(to)),
    full: (iso) =>
      `${new Intl.DateTimeFormat(LOCALES[language], {
        dateStyle: 'full',
        timeStyle: 'medium',
        hourCycle: 'h23',
        timeZone: timezone,
      }).format(new Date(iso))} (${timezone})`,
    exactDuration: (seconds) => {
      const total = Math.max(0, Math.floor(seconds));
      const parts: [number, 'days' | 'hours' | 'minutes' | 'seconds'][] = [
        [Math.floor(total / 86_400), 'days'],
        [Math.floor((total % 86_400) / 3600), 'hours'],
        [Math.floor((total % 3600) / 60), 'minutes'],
        [total % 60, 'seconds'],
      ];
      const shown = parts.filter(([value]) => value > 0);
      return (shown.length > 0 ? shown : [[0, 'seconds'] as const])
        .map(([value, unit]) => t(`common.duration.${unit}`, { value, lng: language }))
        .join(' ');
    },
    percent: (value) =>
      new Intl.NumberFormat(LOCALES[language], {
        style: 'percent',
        maximumFractionDigits: 2,
      }).format(value / 100),
    timezone,
    language,
  };
}
