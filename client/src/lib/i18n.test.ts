import { errorCodes } from '@elec/shared/api';
import { describe, expect, test } from 'vitest';
import { createClientI18n, detectLanguage, rememberLanguage } from './i18n.ts';

function storageWith(language?: string): Storage {
  const storage = new Map<string, string>();
  if (language) storage.set('em.language', language);
  return {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, value),
  };
}

describe('detectLanguage', () => {
  test('prefers the stored language', () => {
    expect(detectLanguage(storageWith('ru'), ['en-US'])).toBe('ru');
  });

  test('takes the first supported navigator language', () => {
    expect(detectLanguage(storageWith(), ['en-US', 'uk'])).toBe('en');
  });

  test('falls back to Ukrainian', () => {
    expect(detectLanguage(storageWith(), ['de-DE'])).toBe('uk');
  });

  test('ignores an unknown stored value', () => {
    expect(detectLanguage(storageWith('xx'), ['ru-RU'])).toBe('ru');
  });
});

test('rememberLanguage stores the choice for the next visit', () => {
  rememberLanguage('en');
  expect(detectLanguage(localStorage, ['uk'])).toBe('en');
});

test('createClientI18n translates app keys in the requested language', () => {
  expect(createClientI18n('en').t('app.notFound.title')).toBe('Page not found');
  expect(createClientI18n('uk').t('app.notFound.title')).toBe('Сторінку не знайдено');
});

test('every API error code has a translation', () => {
  const i18n = createClientI18n('en');
  const codes = [...errorCodes, 'network', 'invalid_response', 'generic'];
  const missing = codes.filter((code) => !i18n.exists(`app.errors.${code}`));
  expect(missing).toEqual([]);
});
