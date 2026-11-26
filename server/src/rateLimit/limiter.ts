import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { rateLimitBucket } from '../db/schema/index.ts';

export type RateRule = { limit: number; windowS: number };

export type RateDecision = { allowed: boolean; retryAfterS: number };

export interface RateLimiter {
  hit(key: string, rule: RateRule): Promise<RateDecision>;
}

export const AUTH_PER_IP: RateRule = { limit: 10, windowS: 60 };
export const LOGIN_PER_EMAIL: RateRule = { limit: 10, windowS: 900 };
export const EMAIL_SEND: RateRule = { limit: 3, windowS: 3600 };
export const REAUTH_PER_USER: RateRule = { limit: 10, windowS: 900 };
export const TELEGRAM_LINK_PER_USER: RateRule = { limit: 10, windowS: 900 };
export const INVITE_PER_USER: RateRule = { limit: 10, windowS: 3600 };
export const CHANNEL_TEST_PER_USER: RateRule = { limit: 5, windowS: 60 };
export const WEBHOOK_URL_PER_USER: RateRule = { limit: 10, windowS: 60 };
export const REDELIVER_PER_USER: RateRule = { limit: 30, windowS: 60 };
export const DEVICE_CHECKIN: RateRule = { limit: 20, windowS: 60 };
export const FIRMWARE_DOWNLOAD_PER_IP: RateRule = { limit: 20, windowS: 60 };

export function rateLimitKey(
  name: string,
  scope: 'ip' | 'email' | 'phone' | 'user' | 'device',
  value: string,
): string {
  return `${name}:${scope}:${createHash('sha256').update(value).digest('hex')}`;
}

export function createPgRateLimiter(db: Db, clock: Clock): RateLimiter {
  return {
    async hit(key, rule) {
      const nowMs = clock.now().getTime();
      const windowMs = rule.windowS * 1000;
      const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
      const windowStart = new Date(windowStartMs);
      const [row] = await db
        .insert(rateLimitBucket)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: rateLimitBucket.key,
          set: {
            count: sql`case when ${rateLimitBucket.windowStart} = excluded.window_start then ${rateLimitBucket.count} + 1 else 1 end`,
            windowStart,
          },
        })
        .returning({ count: rateLimitBucket.count });
      const count = row?.count ?? 1;
      if (count <= rule.limit) return { allowed: true, retryAfterS: 0 };
      return { allowed: false, retryAfterS: Math.ceil((windowStartMs + windowMs - nowMs) / 1000) };
    },
  };
}
