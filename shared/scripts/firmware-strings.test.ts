import { describe, expect, test } from 'vitest';
import { resources } from '../src/i18n/index.ts';
import { flattenSetup, renderHeader } from './firmware-strings.ts';

const dict = (title: string) => ({ title, save: 'Save', 'status.done': 'Done' });

describe('renderHeader', () => {
  test('escapes text for C and HTML', () => {
    const header = renderHeader({
      uk: dict('Wi-Fi "Home" <5G> & \\ back\nline'),
      en: dict('en'),
      ru: dict('ru'),
    });
    expect(header).toContain(String.raw`"Wi-Fi &quot;Home&quot; &lt;5G&gt; &amp; \\ back\nline"`);
  });

  test('turns key paths into C fields in dictionary order', () => {
    const header = renderHeader({ uk: dict('uk'), en: dict('en'), ru: dict('ru') });
    expect(header).toMatch(
      /struct PortalStrings \{\n {2}const char\* title;\n {2}const char\* save;\n {2}const char\* statusDone;\n\};/,
    );
  });

  test('lists languages as uk, en, ru', () => {
    const header = renderHeader({ uk: dict('УК'), en: dict('EN'), ru: dict('РУ') });
    const uk = header.indexOf('"УК"');
    const en = header.indexOf('"EN"');
    const ru = header.indexOf('"РУ"');
    expect(uk).toBeGreaterThan(-1);
    expect(uk).toBeLessThan(en);
    expect(en).toBeLessThan(ru);
    expect(header).toContain('kPortalStrings[3]');
    expect(header).toContain('kPortalLanguages[3] = {"uk", "en", "ru"}');
  });

  test('fails when a language misses a key', () => {
    expect(() => renderHeader({ uk: { title: 'a' }, en: dict('en'), ru: dict('ru') })).toThrow(
      /uk.*save/,
    );
  });

  test('is stable across runs', () => {
    const input = { uk: dict('uk'), en: dict('en'), ru: dict('ru') };
    expect(renderHeader(input)).toBe(renderHeader(input));
  });
});

describe('real dictionaries', () => {
  test('every language has the device setup keys', () => {
    const header = renderHeader({
      uk: flattenSetup(resources.uk.translation),
      en: flattenSetup(resources.en.translation),
      ru: flattenSetup(resources.ru.translation),
    });
    for (const field of ['title', 'pairingCodeKeep', 'statusCodeExpired', 'errorsCodeFormat']) {
      expect(header).toContain(`const char* ${field};`);
    }
  });
});
