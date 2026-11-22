import type { RequestHandler } from 'express';
import { rateLimitKey, type RateLimiter, type RateRule } from '../rateLimit/limiter.ts';
import { getAuth } from './auth/middleware.ts';
import { HttpError } from './errors.ts';

type Rules = { ip?: RateRule; email?: RateRule; user?: RateRule };

function bodyEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('email' in body)) return undefined;
  return typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
}

export function rateLimit(limiter: RateLimiter, name: string, rules: Rules): RequestHandler {
  return async (req, res, next) => {
    const checks: Array<{ key: string; rule: RateRule }> = [];
    if (rules.ip)
      checks.push({ key: rateLimitKey(name, 'ip', req.ip ?? 'unknown'), rule: rules.ip });
    const email = bodyEmail(req.body);
    if (rules.email && email)
      checks.push({ key: rateLimitKey(name, 'email', email), rule: rules.email });
    if (rules.user) {
      const userId = getAuth(res).user.id;
      checks.push({ key: rateLimitKey(name, 'user', userId), rule: rules.user });
    }

    const decisions = await Promise.all(checks.map((check) => limiter.hit(check.key, check.rule)));
    const denied = decisions.filter((decision) => !decision.allowed);
    if (denied.length > 0) {
      const retryAfterS = Math.max(...denied.map((decision) => decision.retryAfterS));
      throw new HttpError(429, 'rate_limited', 'Too many requests', undefined, {
        'Retry-After': String(retryAfterS),
      });
    }
    next();
  };
}
