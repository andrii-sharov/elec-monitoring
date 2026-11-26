import { languages, resources } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { createI18n } from '../i18n.ts';
import { renderEmail, renderInviteEmail, type EmailKind } from './templates.ts';

const kinds: EmailKind[] = ['verifyEmail', 'resetPassword', 'accountExists', 'webhookDisabled'];
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

describe('webhookDisabled', () => {
  const email = renderEmail(i18n, 'webhookDisabled', {
    lang: 'en',
    name: 'John',
    link: 'https://app.test/notifications?type=WEBHOOK',
    channelName: '<Office> hook',
  });

  test('names the webhook, offers the notifications page and has no expiry note', () => {
    expect(email.subject).toBe('Your webhook was turned off');
    expect(email.text).toContain('<Office> hook');
    expect(email.text).toContain(
      'Open notifications:\nhttps://app.test/notifications?type=WEBHOOK',
    );
    expect(email.text).not.toContain('valid for');
    expect(email.html).toContain('&lt;Office&gt; hook');
  });

  test.each(languages)('has its own footer in %s', (lang) => {
    const rendered = renderEmail(i18n, 'webhookDisabled', {
      lang,
      name: 'John',
      link,
      channelName: 'Office hook',
    });
    const { footer, webhookDisabled } = resources[lang].translation.email;
    expect(rendered.text.endsWith(webhookDisabled.footer)).toBe(true);
    expect(rendered.text).not.toContain(footer);
    expect(rendered.html).toContain(webhookDisabled.footer);
    expect(rendered.html).not.toContain(footer.replace("'", '&#39;'));
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

describe('renderInviteEmail', () => {
  const inviteLink = 'https://app.test/invite?token=abc';

  test('renders the English invite', () => {
    const email = renderInviteEmail(i18n, {
      lang: 'en',
      inviter: 'John',
      device: 'Home',
      link: inviteLink,
    });
    expect(email.subject).toBe('John shared Home with you');
    expect(email.text).toContain(
      'John invited you to see the status of Home in Electricity Monitor and get its alerts.',
    );
    expect(email.text).toContain(`Open invite:\n${inviteLink}`);
    expect(email.text).toContain('This invite is valid for 7 days.');
    expect(email.text).toContain(resources.en.translation.email.footer);
  });

  test.each(['uk', 'ru'] as const)('renders %s in its own language', (lang) => {
    const email = renderInviteEmail(i18n, {
      lang,
      inviter: 'John',
      device: 'Home',
      link: inviteLink,
    });
    expect(email.subject).not.toBe('John shared Home with you');
    expect(email.subject).toContain('John');
    expect(email.subject).toContain('Home');
    expect(email.text).toContain(inviteLink);
  });

  test('escapes the device and inviter names in HTML only', () => {
    const email = renderInviteEmail(i18n, {
      lang: 'en',
      inviter: 'John 🔌',
      device: '<b>Дім & "Home"',
      link: inviteLink,
    });
    expect(email.html).toContain('&lt;b&gt;Дім &amp; &quot;Home&quot;');
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('John 🔌');
    expect(email.text).toContain('<b>Дім & "Home"');
  });
});

describe('branded layout', () => {
  const email = renderEmail(i18n, 'resetPassword', { lang: 'uk', name: 'John', link });

  test('loads the PNG logo from the client and shows the app name', () => {
    expect(email.html).toContain('src="https://app.test/email-logo.png"');
    expect(email.html).toContain(resources.uk.translation.common.appName);
    expect(email.html).toContain('<html lang="uk">');
  });

  test('has inbox preview text, the written-out link and a dark mode', () => {
    expect(email.html).toMatch(/overflow:hidden;opacity:0">[^<]*John/);
    expect(email.html).toContain(resources.uk.translation.email.linkHint);
    expect(email.html).toContain('>https://app.test/verify-email?token=abc&amp;x=1</a>');
    expect(email.html).toContain('prefers-color-scheme: dark');
    expect(email.html).toContain('background:#166088');
  });

  test('puts the footer under the card and skips the expiry for an existing account', () => {
    const exists = renderEmail(i18n, 'accountExists', { lang: 'en', name: 'John', link });
    expect(exists.html).toContain(resources.en.translation.email.footer.replace("'", '&#39;'));
    expect(exists.text.endsWith(resources.en.translation.email.footer)).toBe(true);
    expect(exists.html).not.toContain('valid for');
  });
});
