import type { Language } from '@elec/shared';
import type { i18n, TOptions } from 'i18next';

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function htmlLink(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

export type TelegramT = (key: string, vars?: TOptions) => string;

export function telegramT(instance: i18n, language: Language): TelegramT {
  const t = instance.getFixedT(language);
  return (key, vars = {}) =>
    t(key, { ...vars, interpolation: { ...vars.interpolation, escapeValue: true } });
}
