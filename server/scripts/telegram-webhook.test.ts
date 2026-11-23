import { expect, test } from 'vitest';
import { webhookRequest } from './telegram-webhook.ts';

const env = { botToken: '123:abc', secret: 's'.repeat(32), apiUrl: 'https://api.example.com' };

test('set registers the webhook URL, secret token and update types', () => {
  expect(webhookRequest(env, 'set')).toEqual({
    url: 'https://api.telegram.org/bot123:abc/setWebhook',
    body: {
      url: `https://api.example.com/telegram/webhook/${'s'.repeat(32)}`,
      secret_token: 's'.repeat(32),
      allowed_updates: ['message', 'my_chat_member'],
    },
  });
});

test('info and delete have no body', () => {
  expect(webhookRequest(env, 'info')).toEqual({
    url: 'https://api.telegram.org/bot123:abc/getWebhookInfo',
  });
  expect(webhookRequest(env, 'delete')).toEqual({
    url: 'https://api.telegram.org/bot123:abc/deleteWebhook',
  });
});
