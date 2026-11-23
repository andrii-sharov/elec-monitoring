import { z } from 'zod';

export type Command = { name: string; arg: string | null };

const COMMAND = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+(.*))?$/s;

export function parseCommand(text: string, botUsername: string): Command | null {
  const match = COMMAND.exec(text.trim());
  if (!match) return null;
  const [, name, target, rest] = match;
  if (target && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  const arg = rest?.trim();
  return { name: (name ?? '').toLowerCase(), arg: arg ? arg : null };
}

const chatSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  title: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

export const telegramUpdateSchema = z.object({
  message: z
    .object({
      chat: chatSchema,
      from: z.object({ language_code: z.string().optional() }).optional(),
      text: z.string().optional(),
    })
    .optional(),
  my_chat_member: z
    .object({ chat: chatSchema, new_chat_member: z.object({ status: z.string() }) })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
