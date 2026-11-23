import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { createI18n } from '../../i18n.ts';
import { handleUpdate } from '../../telegram/bot.ts';
import { telegramUpdateSchema } from '../../telegram/commands.ts';
import type { AppDeps } from '../app.ts';
import { HttpError } from '../errors.ts';

const digest = (value: string) => createHash('sha256').update(value).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function telegramWebhookRouter(deps: AppDeps): Router {
  const router = Router();
  const i18n = createI18n();
  const { webhookSecret, botUsername } = deps.config.telegram;

  router.post('/telegram/webhook/:secret', async (req, res) => {
    const header = req.get('x-telegram-bot-api-secret-token') ?? '';
    if (
      !sameSecret(String(req.params.secret), webhookSecret) ||
      !sameSecret(header, webhookSecret)
    ) {
      throw new HttpError(404, 'not_found', 'Not found');
    }
    try {
      const parsed = telegramUpdateSchema.safeParse(req.body);
      const reply = parsed.success
        ? await handleUpdate({ db: deps.db, clock: deps.clock, i18n, botUsername }, parsed.data)
        : null;
      if (reply) {
        res.json({ method: 'sendMessage', chat_id: String(reply.chatId), text: reply.text });
        return;
      }
    } catch (err) {
      deps.logger.error('telegram update failed', err);
    }
    res.json({});
  });

  return router;
}
