import { describe, expect, test, vi } from 'vitest';
import { createTelegramClient } from './telegram.ts';

const TOKEN = '123456:SECRET-TOKEN';

function stub(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('createTelegramClient.sendMessage', () => {
  test('posts the documented request', async () => {
    const fetchFn = stub(200, { ok: true, result: {} });
    const client = createTelegramClient(TOKEN, fetchFn);

    const result = await client.sendMessage(-1001234567890n, 'hello', { silent: true });

    expect(result).toEqual({ type: 'SENT' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      chat_id: '-1001234567890',
      text: 'hello',
      disable_notification: true,
      link_preview_options: { is_disabled: true },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('maps 429 to RETRY_AFTER', async () => {
    const client = createTelegramClient(
      TOKEN,
      stub(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 7 } }),
    );
    expect(await client.sendMessage(1n, 'x', { silent: false })).toEqual({
      type: 'RETRY_AFTER',
      seconds: 7,
    });
  });

  test('maps migrate_to_chat_id to MIGRATED', async () => {
    const client = createTelegramClient(
      TOKEN,
      stub(400, {
        ok: false,
        description: 'Bad Request: group chat was upgraded to a supergroup chat',
        parameters: { migrate_to_chat_id: -100999 },
      }),
    );
    expect(await client.sendMessage(1n, 'x', { silent: false })).toEqual({
      type: 'MIGRATED',
      chatId: -100999n,
    });
  });

  test.each([
    [403, 'Forbidden: bot was blocked by the user'],
    [400, 'Bad Request: chat not found'],
  ])('maps %i to PERMANENT', async (status, description) => {
    const client = createTelegramClient(TOKEN, stub(status, { ok: false, description }));
    expect(await client.sendMessage(1n, 'x', { silent: false })).toEqual({
      type: 'PERMANENT',
      error: `HTTP ${status}: ${description}`,
    });
  });

  test('maps 5xx to TRANSIENT', async () => {
    const client = createTelegramClient(
      TOKEN,
      stub(502, { ok: false, description: 'Bad Gateway' }),
    );
    expect(await client.sendMessage(1n, 'x', { silent: false })).toEqual({
      type: 'TRANSIENT',
      error: 'HTTP 502: Bad Gateway',
    });
  });

  test.each([new TypeError('fetch failed'), new DOMException('timed out', 'AbortError')])(
    'maps a thrown %s to TRANSIENT without leaking the token',
    async (error) => {
      const message = `${error.message} https://api.telegram.org/bot${TOKEN}/sendMessage`;
      const client = createTelegramClient(TOKEN, () => Promise.reject(new Error(message)));
      const result = await client.sendMessage(1n, 'x', { silent: false });
      expect(result.type).toBe('TRANSIENT');
      expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
    },
  );

  test('caps long error text', async () => {
    const client = createTelegramClient(
      TOKEN,
      stub(500, { ok: false, description: 'x'.repeat(2000) }),
    );
    const result = await client.sendMessage(1n, 'x', { silent: false });
    expect(result.type === 'TRANSIENT' && result.error.length).toBeLessThanOrEqual(500);
  });
});
