import { vi } from 'vitest';
import type { Clock } from '../src/clock.ts';
import type { GoogleClient, GoogleIdentity } from '../src/auth/google.ts';
import type { EmailMessage, EmailSender } from '../src/email/sender.ts';
import type { Logger } from '../src/logger.ts';
import type { RateLimiter } from '../src/rateLimit/limiter.ts';

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export function silentLogger(): Logger {
  return {
    info: vi.fn<Logger['info']>(),
    warn: vi.fn<Logger['warn']>(),
    error: vi.fn<Logger['error']>(),
  };
}

export class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  private failures = 0;

  failNext(): void {
    this.failures += 1;
  }

  send(message: EmailMessage): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('fake email failure'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

export function linkFrom(message: EmailMessage): string {
  const match = /https?:\/\/\S+/.exec(message.text);
  if (!match) throw new Error('no link in email text');
  return match[0];
}

export const allowAllLimiter: RateLimiter = {
  hit: () => Promise.resolve({ allowed: true, retryAfterS: 0 }),
};

export class FakeGoogleClient implements GoogleClient {
  identity: GoogleIdentity = {
    sub: 'google-sub-1',
    email: 'john@example.com',
    emailVerified: true,
    name: 'John Google',
  };
  failExchange = false;
  lastCode?: string;

  authorizationUrl(state: string): URL {
    return new URL(`https://accounts.google.test/auth?state=${encodeURIComponent(state)}`);
  }

  exchange(code: string): Promise<GoogleIdentity> {
    this.lastCode = code;
    if (this.failExchange) return Promise.reject(new Error('fake google failure'));
    return Promise.resolve(this.identity);
  }
}
