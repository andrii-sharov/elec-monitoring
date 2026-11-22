import type { Language } from '../enums.ts';
import { en, type Dictionary } from './locales/en.ts';
import { ru } from './locales/ru.ts';
import { uk } from './locales/uk.ts';

export type { Dictionary };
export { languages, defaultLanguage, type Language } from '../enums.ts';

export const resources: Record<Language, { translation: Dictionary }> = {
  uk: { translation: uk },
  en: { translation: en },
  ru: { translation: ru },
};
