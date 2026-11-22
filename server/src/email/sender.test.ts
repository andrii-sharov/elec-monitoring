import { describe, expect, test, vi } from 'vitest';
import { FakeEmailSender, silentLogger } from '../../test/fakes.ts';
import {
  createLogSender,
  createResendSender,
  sendInBackground,
  type EmailMessage,
} from './sender.ts';

const message: EmailMessage = {
  to: 'john@example.com',
  subject: 'Hello',
  text: 'Plain https://app.test/x',
  html: '<p>Hello</p>',
};

describe('createResendSender', () => {
  test('sends from, to, subject, text and html', async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ data: { id: '1' }, error: null });
    await createResendSender({ emails: { send } } as never, 'Me <me@app.test>').send(message);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      from: 'Me <me@app.test>',
      to: 'john@example.com',
      subject: 'Hello',
      text: message.text,
      html: message.html,
    });
  });

  test('rejects when Resend returns an error', async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad from' } });
    const sender = createResendSender({ emails: { send } } as never, 'x');
    await expect(sender.send(message)).rejects.toThrow('bad from');
  });
});

describe('sendInBackground', () => {
  test('returns at once and logs a failure once', async () => {
    const logger = silentLogger();
    const sender = new FakeEmailSender();
    sender.failNext();
    const result = sendInBackground(sender, logger, message);
    expect(result).toBeUndefined();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
  });

  test('delivers on success without logging an error', async () => {
    const logger = silentLogger();
    const sender = new FakeEmailSender();
    sendInBackground(sender, logger, message);
    await vi.waitFor(() => expect(sender.sent).toHaveLength(1));
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('createLogSender', () => {
  test('writes to, subject and text through logger.info', async () => {
    const logger = silentLogger();
    await createLogSender('x', logger).send(message);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls[0]);
    expect(logged).toContain('john@example.com');
    expect(logged).toContain('Hello');
    expect(logged).toContain('Plain https://app.test/x');
  });
});
