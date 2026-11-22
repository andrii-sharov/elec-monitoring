import { defaultLanguage, languages, resources } from '@elec/shared';
import { createInstance, type i18n } from 'i18next';

export function createI18n(): i18n {
  const instance = createInstance();
  void instance.init({
    resources,
    fallbackLng: defaultLanguage,
    supportedLngs: [...languages],
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}
