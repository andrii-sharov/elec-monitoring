import { languages, resources } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { createI18n } from '../i18n.ts';
import { escapeHtml, htmlLink, telegramT } from './html.ts';

function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      strings(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

test('escapes the characters Telegram HTML needs', () => {
  expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  expect(htmlLink('https://x.test/?a=1&b="2"', '<Go>')).toBe(
    '<a href="https://x.test/?a=1&amp;b=&quot;2&quot;">&lt;Go&gt;</a>',
  );
});

test('telegramT escapes values but keeps unescaped placeholders raw', () => {
  const t = telegramT(createI18n(), 'en');
  expect(t('telegram.offline.title', { name: 'A & <B>' })).toBe(
    '🔴 <b>A &amp; &lt;B&gt;</b> — device stopped checking in',
  );
});

describe.each(languages)('%s Telegram texts', (language) => {
  const texts = strings((resources[language] as { translation: object }).translation, '').filter(
    ([path]) => path.startsWith('telegram.'),
  );

  test('use only <b> markup and no raw & or <', () => {
    const offenders = texts.filter(([, text]) => {
      const stripped = text.replaceAll('<b>', '').replaceAll('</b>', '');
      return /[<>&]/.test(stripped);
    });
    expect(offenders).toEqual([]);
  });

  test('link placeholders are unescaped and other placeholders are escaped', () => {
    const offenders = texts.filter(
      ([, text]) => /\{\{\s*link\s*\}\}/.test(text) || /\{\{-\s*(?!\s|link\b)/.test(text),
    );
    expect(offenders).toEqual([]);
  });
});
