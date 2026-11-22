import { languages, resources } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { createI18n } from '../i18n.ts';
import { renderEmail, type EmailKind } from './templates.ts';

const kinds: EmailKind[] = ['verifyEmail', 'resetPassword', 'accountExists'];
const link = 'https://app.test/verify-email?token=abc&x=1';
const i18n = createI18n();

describe.each(kinds)('%s', (kind) => {
  test.each(languages)('renders in %s', (lang) => {
    const email = renderEmail(i18n, kind, { lang, name: 'John', link });
    expect(email.subject).toBe(resources[lang].translation.email[kind].subject);
    expect(email.text).toContain(link);
    expect(email.text).toContain('John');
    expect(email.html).toContain('href="https://app.test/verify-email?token=abc&amp;x=1"');
  });
});

test('uses the recipient language', () => {
  const en = renderEmail(i18n, 'verifyEmail', { lang: 'en', name: 'John', link });
  const ru = renderEmail(i18n, 'verifyEmail', { lang: 'ru', name: 'John', link });
  expect(en.subject).toBe(resources.en.translation.email.verifyEmail.subject);
  expect(ru.subject).toBe(resources.ru.translation.email.verifyEmail.subject);
  expect(en.subject).not.toBe(ru.subject);
});

test('escapes HTML in the name but keeps the text part as-is', () => {
  const email = renderEmail(i18n, 'verifyEmail', {
    lang: 'en',
    name: '<b>John</b> & co',
    link,
  });
  expect(email.html).toContain('&lt;b&gt;John&lt;/b&gt; &amp; co');
  expect(email.html).not.toContain('<b>John');
  expect(email.text).toContain('<b>John</b> & co');
});
