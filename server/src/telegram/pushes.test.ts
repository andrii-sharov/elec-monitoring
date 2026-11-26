import { describe, expect, test, vi } from 'vitest';
import { FakeClock, FakeTelegramClient, silentLogger } from '../../test/fakes.ts';
import { createI18n } from '../i18n.ts';
import { renderTelegramAuth, sendTelegramInBackground } from './pushes.ts';

const i18n = createI18n();
const link = 'https://app.test/reset-password?token=abc';

describe('renderTelegramAuth', () => {
  test('renders the reset link text', () => {
    expect(renderTelegramAuth(i18n, 'resetLink', { lang: 'en', link })).toBe(
      `🔑 <a href="${link}">Reset your password</a> for Electricity Monitor.\nThe link is valid for 1 hour.`,
    );
  });

  test('renders the sign-up attempt text', () => {
    expect(renderTelegramAuth(i18n, 'signupAttempt', { lang: 'en', link })).toBe(
      `Someone tried to create an Electricity Monitor account with your number. You already have one. <a href="${link}">Log in</a>.\nIf you forgot your password, use “Forgot password” on the login page.`,
    );
  });

  test('escapes names and hides the link behind its label in an invite', () => {
    const text = renderTelegramAuth(i18n, 'invite', {
      lang: 'en',
      link,
      inviter: 'John',
      device: '<b>Дім & "Home"',
    });
    expect(text).toBe(
      `John shared <b>&lt;b&gt;Дім &amp; &quot;Home&quot;</b> with you in Electricity Monitor. <a href="${link}">Open the invite</a>.\nThe invite is valid for 7 days.`,
    );
  });

  test.each(['resetLink', 'signupAttempt', 'invite'] as const)('translates %s', (kind) => {
    const render = (lang: 'en' | 'uk' | 'ru') =>
      renderTelegramAuth(i18n, kind, { lang, link, inviter: 'John', device: 'Home' });
    expect(new Set([render('en'), render('uk'), render('ru')]).size).toBe(3);
    expect(render('en')).toContain(`<a href="${link}">`);
    expect(render('uk')).toContain(link);
    expect(render('ru')).toContain(link);
  });
});

test('escapes a link with an ampersand inside the href', () => {
  const text = renderTelegramAuth(i18n, 'resetLink', {
    lang: 'en',
    link: 'https://app.test/r?a=1&b=2',
  });
  expect(text).toContain('<a href="https://app.test/r?a=1&amp;b=2">');
});

describe('sendTelegramInBackground', () => {
  const clock = new FakeClock(new Date('2026-11-21T16:42:00Z'));

  test('sends the text to the chat', async () => {
    const client = new FakeTelegramClient(clock);
    const logger = silentLogger();
    sendTelegramInBackground(client, logger, 777n, 'hello');
    await vi.waitFor(() => expect(client.sent).toHaveLength(1));
    expect(client.sent[0]).toMatchObject({ chatId: 777n, text: 'hello' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('logs a failed push without throwing', async () => {
    const client = new FakeTelegramClient(clock);
    client.script({ type: 'PERMANENT', error: 'HTTP 403: blocked' });
    const logger = silentLogger();
    sendTelegramInBackground(client, logger, 777n, 'hello');
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
  });

  test('logs a throwing client', async () => {
    const logger = silentLogger();
    const client = { sendMessage: () => Promise.reject(new Error('boom')) };
    sendTelegramInBackground(client, logger, 777n, 'hello');
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
  });
});
