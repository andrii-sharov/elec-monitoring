import { expect, test } from 'vitest';
import { createI18n } from './i18n.ts';

const i18n = createI18n();

test('translates with interpolation', () => {
  expect(i18n.t('common.greeting', { lng: 'en', name: 'John' })).toBe('Hello, John');
});

test('translates to Russian', () => {
  expect(i18n.t('common.greeting', { lng: 'ru', name: 'John' })).toBe('Здравствуйте, John');
});

test('falls back to Ukrainian for an unsupported language', () => {
  expect(i18n.t('common.greeting', { lng: 'de', name: 'John' })).toBe('Вітаємо, John');
});

test('returns the key when it is missing', () => {
  expect(i18n.t('common.nope', { lng: 'en' })).toBe('common.nope');
});

test('does not HTML-escape values', () => {
  expect(i18n.t('common.greeting', { lng: 'en', name: 'A & B' })).toBe('Hello, A & B');
});
