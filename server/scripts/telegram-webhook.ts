import { pathToFileURL } from 'node:url';

export type WebhookAction = 'set' | 'info' | 'delete';
type Env = { botToken: string; secret: string; apiUrl: string };

export function webhookRequest(env: Env, action: WebhookAction): { url: string; body?: object } {
  const base = `https://api.telegram.org/bot${env.botToken}`;
  if (action === 'info') return { url: `${base}/getWebhookInfo` };
  if (action === 'delete') return { url: `${base}/deleteWebhook` };
  return {
    url: `${base}/setWebhook`,
    body: {
      url: `${env.apiUrl}/telegram/webhook/${env.secret}`,
      secret_token: env.secret,
      allowed_updates: ['message', 'my_chat_member'],
    },
  };
}

async function main(argv: string[]): Promise<void> {
  const action = argv[0];
  if (action !== 'set' && action !== 'info' && action !== 'delete') {
    throw new Error('usage: telegram:webhook set|info|delete');
  }
  const botToken = process.env.TELEGRAM_PLATFORM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const apiUrl = process.env.API_URL;
  if (!botToken || !secret || !apiUrl) {
    throw new Error(
      'TELEGRAM_PLATFORM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and API_URL are required',
    );
  }
  const { url, body } = webhookRequest({ botToken, secret, apiUrl }, action);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  console.info(JSON.stringify(await response.json(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
