import { defaultLanguage, languages, resources, type Language } from '@elec/shared';
import { createInstance, type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

const storageKey = 'em.language';

function asLanguage(value: string | null | undefined): Language | null {
  return languages.find((language) => language === value) ?? null;
}

export function createClientI18n(language: Language): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: defaultLanguage,
    supportedLngs: [...languages],
    resources,
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}

export function detectLanguage(storage: Storage, navigatorLanguages: readonly string[]): Language {
  const stored = asLanguage(storage.getItem(storageKey));
  if (stored) return stored;
  for (const tag of navigatorLanguages) {
    const language = asLanguage(tag.split('-')[0]?.toLowerCase());
    if (language) return language;
  }
  return defaultLanguage;
}

export function rememberLanguage(language: Language): void {
  localStorage.setItem(storageKey, language);
}
