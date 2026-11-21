import { Api } from 'grammy';

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createTelegramNotifier(botToken: string, chatId: string) {
  const api = new Api(botToken);

  return async function notifyTelegram(text: string): Promise<void> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        await api.sendMessage(chatId, text);
        console.log(`Telegram sent: ${text.split('\n')[0]}`);
        return;
      } catch (error) {
        console.error(`Telegram send failed (attempt ${attempt + 1}):`, error);
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    console.error(`Telegram gave up: ${text.split('\n')[0]}`);
  };
}
