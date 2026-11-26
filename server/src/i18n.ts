import { defaultLanguage, languages, resources } from '@elec/shared';
import { createInstance, type i18n } from 'i18next';
import { escapeHtml } from './telegram/html.ts';

export function createI18n(): i18n {
  const instance = createInstance();
  void instance.init({
    resources,
    fallbackLng: defaultLanguage,
    supportedLngs: [...languages],
    initAsync: false,
    interpolation: { escapeValue: false, escape: escapeHtml },
  });
  return instance;
}
