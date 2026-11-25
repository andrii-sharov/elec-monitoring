import {
  defaultLanguage,
  formatDuration,
  formatMoment,
  formatRange,
  languages,
} from '@elec/shared';
import type { Language } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/api/session';

export type Formatters = {
  moment(iso: string): string;
  duration(seconds: number, options?: { withSeconds?: boolean }): string;
  range(fromIso: string, toIso: string): string;
  since(iso: string, now?: Date): string;
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
  const duration = (seconds: number, options?: { withSeconds?: boolean }) =>
    formatDuration(seconds, (key, values) => t(key, { ...values, lng: language }), options);
  const moment = (iso: string) => formatMoment(new Date(iso), language, timezone);
  return {
    moment,
    duration,
    range: (fromIso, toIso) => formatRange(new Date(fromIso), new Date(toIso), language, timezone),
    since: (iso, now = new Date()) =>
      `${moment(iso)} · ${duration((now.getTime() - new Date(iso).getTime()) / 1000, { withSeconds: true })}`,
  };
}
