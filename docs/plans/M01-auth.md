# M1 — Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** accounts with email + password and Google sign-in, rotating
refresh sessions, the profile endpoints, auth rate limits and a staging
environment on the real domains.

**Architecture:** Auth logic lives in `server/src/auth/`: pure helpers for
passwords and JWTs, plus data functions over `session`, `refresh_token` and
`one_time_token`. HTTP routers live in `server/src/http/auth/` and
`server/src/http/account/`. Email, Google and the rate limiter are
interfaces injected through `AppDeps`. Tests swap them for fakes and use
PGlite with a `FakeClock`, so nothing calls Resend or Google.

**Tech Stack:** Node.js 26 (`node:crypto` argon2id), Express 5, jose 6,
arctic 3, resend 6, cors 2, cookie-parser 1, Zod 4, zod-openapi 6, Drizzle
0.45, Vitest 5, supertest.

**Spec:** [ROADMAP.md § M1](../ROADMAP.md#m1--auth) ·
[PROJECT_V2.md](../PROJECT_V2.md) §3, §9 Localization, §10, §12 ·
[API.md](../API.md) §1, §3, §4 Account · [DATABASE.md](../DATABASE.md) §3, §8, §10.

## Global Constraints

- Everything from the [M0 plan](M00-foundation.md#global-constraints) still applies (ESM, strict, UUIDv7, `timestamptz`, error shape, no comments, no real names).
- Time-based logic takes `clock.now()` from the injected `Clock`, never `new Date()` or `Date.now()`. That includes JWT `iat`/`exp` checks.
- Access JWT 15 min (`expires_in: 900`). Refresh token random 32 bytes, 30 days, only the SHA-256 hash stored (P §3, §10).
- Email links: `VERIFY_EMAIL` 24 h, `RESET_PASSWORD` 1 h, single use (P §3, D §3).
- Refresh cookie: `httpOnly`, `Secure`, `SameSite=Lax`, host-only on the API host (no `Domain` attribute) (P §3).
- CORS allows credentials only for `CLIENT_URL` and `ADMIN_URL`. `refresh` and `logout` also check `Origin` (A §3).
- Google redirects go only to `CLIENT_URL` or `ADMIN_URL`, never to a URL from the query (A §3).
- No email enumeration: sign up, log in and forgot password respond the same whether or not the email exists (P §3, A §3).
- Emails in `uk`, `en` and `ru`, in the recipient's `language`, `uk` when unknown (P §3, §9).
- No HTTP, Resend or Google call inside a DB transaction (D §9).
- Every new endpoint is in the OpenAPI document, and API.md is updated in the same task.

## Decisions made in this plan

Each task records its decisions in the spec. Q4 and Q5 get ✅ in the ROADMAP Decisions table in Task 12.

1. **Domains (Q5).** Prod: client app on the apex `https://<domain>`, `https://admin.<domain>`, `https://api.<domain>`; `www.<domain>` redirects to the apex. Staging: `staging-app.<domain>`, `staging-admin.<domain>`, `staging-api.<domain>`. Provider default hosts (`*.onrender.com`, `*.vercel.app`) are on the Public Suffix List, which makes app and API cross-site, so they can't be used for sign-in. P §12.
2. **Rate limits (Q4)** use a Postgres table `rate_limit_bucket` with fixed windows behind a `RateLimiter` interface. Rules: 10 / min per IP per auth endpoint (A §1); log in 10 / 15 min per email; sign up and forgot password 3 / h per email; resend verification 3 / h per user; change password and delete account 10 / 15 min per user. Keys store a SHA-256 of the email or IP, never the raw value. Worker deletes buckets older than one day. D §8, A §1.
3. **Refresh reuse grace.** A token reused within **10 s** of its first use gets `409 conflict` with no revocation and no cookie change. The parallel request already set the new cookie, so the app retries once. Reuse after 10 s revokes the session (`401`). P §3, A §3, D §3.
4. **`requireUser` checks the session row** on every request (one indexed join). Log out everywhere, password reset and account deletion take effect at once, not after 15 min.
5. **argon2id from `node:crypto`** (built into Node 26, no native package), stored as a PHC string `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` (OWASP minimum, 16-byte salt, 32-byte tag, unpadded base64). Verification reads parameters from the string, so they can be raised later.
6. **Sign up returns `201` with no body and does not sign in.** The user verifies, then logs in. Signing in at sign up would reveal whether the email was new. An existing email gets an `accountExists` email instead.
7. **Emails are sent after the response** (`sendInBackground`, errors logged). Response time then doesn't reveal whether an account exists. A lost email is recovered with resend or forgot password.
8. **Every bad email-link token returns `410 expired`**, whether it is unknown, used, expired or for the wrong purpose. Links: `${CLIENT_URL}/verify-email?token=…`, `${CLIENT_URL}/reset-password?token=…`.
9. **Reset password** also sets `email_verified_at` (the link proves ownership), marks the user's other unused reset tokens used, and revokes all sessions.
10. **New error codes:** `invalid_credentials` (`401` on log in; `403` when a signed-in user's password re-check fails) and `reauth_required` (`403`, Google-only account deleting itself more than 5 min after sign-in). A §1.
11. **Google flow.** Scopes `openid email profile`. The callback redirects to `<app origin>/auth/google`, either clean (signed in or linked) or with `?error=` set to `google_failed`, `google_email_unverified`, `google_account_in_use` or `google_already_linked`. The `LINK` intent finds the user from the refresh cookie, which the browser sends on this top-level GET because its path is `/api/auth`. An **unverified** local account with the same email gets Google linked: email marked verified, password removed, sessions revoked. This blocks pre-registration takeover. New Google accounts get `uk` / `Europe/Kyiv`, and the app can `PATCH /me` afterwards. The ID token comes over the TLS back channel, so `decodeIdToken` plus `aud`, `iss` and `email_verified` checks are enough (OIDC Core 3.1.3.7). A §3.
12. **Cookies.** Refresh: `em_refresh`, `Path=/api/auth`, `Max-Age` 30 d. OAuth state: `em_oauth`, `Path=/api/auth/google`, 10 min, value is a jose HS256 JWT with `aud: 'oauth-state'` holding `state`, the PKCE verifier, `app`, `intent` and `userId?`.
13. **Config split.** `loadConfig` (API) gains `JWT_SECRET` (≥ 32 chars), `CLIENT_URL`, `ADMIN_URL`, `API_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_TRANSPORT` (`resend` default | `log`), `RESEND_API_KEY` (required when `resend`), `EMAIL_FROM`, `TRUST_PROXY_HOPS` (default `0`). The worker and `db:migrate` use `loadDatabaseConfig` (`DATABASE_URL` only), so they don't need auth secrets. `ENCRYPTION_KEY` waits for M8. P §12.
14. **Proposed endpoints accepted (Q14):** `POST /api/auth/resend-verification`, `POST /api/auth/change-password`, `DELETE /api/auth/google`. Remove their markers.
15. **Staging** deploys from branch `v2` until v2 merges into `main`. The first EC2 deploy is manual after CI passes. Run migrations once before restarting the API and worker (P §12).

## Review Focus

1. **Two tabs refresh at the same moment with the same cookie** → one gets a new session, the other `409`; the session stays valid. Real-Postgres test in Task 5.
2. **Email typed with case or spaces** (`"  John@Example.COM "`) on sign up, log in and forgot password → the same account, never a `500` from the lowercase check. Tests in Tasks 7–9.
3. **HTML in a user's name** (`<b>John</b>`) → escaped in the HTML email, kept as-is in the text part. Test in Task 3.
4. **`CLIENT_URL` set with a trailing slash** (`https://<domain>/`) → CORS and the Google redirect still match the origin. Test in Task 1.
5. **Google callback without the state cookie** (opened in another browser, cookie expired, or Google returns `error=access_denied`) → redirect to the client app with `?error=google_failed`, never a `500` or JSON page. Test in Task 10.

---

## File structure

```
deploy/                             EC2 staging: Caddyfile, systemd units, env example, release script (Task 12)
shared/src/enums.ts                 + appTargets, googleIntents
shared/src/i18n/locales/{uk,en,ru}.ts  + email.* keys
server/drizzle/0002_rate_limit_bucket.sql
server/src/config.ts                API config, loadDatabaseConfig
server/src/auth/password.ts         hashPassword, verifyPassword, verifyDummyPassword
server/src/auth/jwt.ts              signAccessToken, verifyAccessToken
server/src/auth/sessions.ts         createSession, rotateRefreshToken, revoke*
server/src/auth/oneTimeTokens.ts    issueOneTimeToken, consumeOneTimeToken
server/src/auth/google.ts           GoogleClient, createGoogleClient, sign/verifyOAuthState
server/src/email/templates.ts       renderEmail
server/src/email/sender.ts          EmailSender, Resend and log senders, sendInBackground
server/src/rateLimit/limiter.ts     RateLimiter, createPgRateLimiter, rules
server/src/rateLimit/cleanup.ts     cleanupRateLimits (worker)
server/src/http/cookies.ts          refresh cookie helpers
server/src/http/cors.ts             corsMiddleware, requireAppOrigin
server/src/http/rateLimit.ts        rateLimit middleware
server/src/http/auth/middleware.ts  requireUser, requireVerifiedEmail, getAuth
server/src/http/auth/schemas.ts     email, password, name, language, timezone
server/src/http/auth/signup.ts      signup, verify-email, resend-verification
server/src/http/auth/session.ts     login, refresh, logout, logout-all
server/src/http/auth/password.ts    forgot, reset, change password
server/src/http/auth/google.ts      google start, callback, unlink
server/src/http/account/me.ts       meSchema, toMe, GET/PATCH/DELETE /api/v1/me
server/test/auth.ts                 createUser, signIn
server/test/fakes.ts                + FakeEmailSender, FakeGoogleClient, allowAllLimiter
server/test/app.ts                  testApp with all deps, testConfig
```

Tests sit next to the code (`*.test.ts`). Real-Postgres tests are `*.pg.test.ts`.

---

### Task 1: Config for the API, worker and migrations

**Files:**

- Modify: `server/src/config.ts`, `server/src/config.test.ts`, `server/src/worker.ts`, `server/src/db/migrate.ts`, `server/.env.example`, `server/test/app.ts`
- Docs: `docs/PROJECT_V2.md` §12 (domains, config keys, decision 1, 13)

**Interfaces:**

- Produces:
  ```ts
  type AppUrls = { client: string; admin: string; api: string }; // origins, no trailing slash
  type EmailConfig =
    | { transport: 'resend'; resendApiKey: string; from: string }
    | { transport: 'log'; from: string };
  type Config = {
    databaseUrl: string; port: number; jwtSecret: string; urls: AppUrls;
    google: { clientId: string; clientSecret: string };
    email: EmailConfig; trustProxyHops: number;
  };
  loadConfig(env): Config; loadConfigOrExit(env): Config;
  loadDatabaseConfig(env): { databaseUrl: string }; loadDatabaseConfigOrExit(env);
  ```
- Produces (test): `testConfig: Config` in `server/test/app.ts`. Urls `https://app.test`, `https://admin.test`, `https://api.test`; `jwtSecret` 32 `x` characters; `email: { transport: 'log', from: 'Electricity Monitor <noreply@app.test>' }`.

- [ ] **Step 1: Tests** (extend `config.test.ts`; `validEnv` is a full valid env object):
  - valid env → full `Config`; `EMAIL_TRANSPORT` defaults to `resend`, `TRUST_PROXY_HOPS` to `0`.
  - `CLIENT_URL=https://example.com/` → `urls.client === 'https://example.com'` (Review Focus 4).
  - `CLIENT_URL=http://example.com` → `ConfigError` with key `CLIENT_URL`; `http://localhost:5173` and `http://127.0.0.1:5173` are accepted.
  - `CLIENT_URL=https://example.com/app` (path) → `ConfigError`.
  - `JWT_SECRET` of 31 chars → `ConfigError`; the message does not contain the value.
  - `EMAIL_TRANSPORT=resend` without `RESEND_API_KEY` → keys `['RESEND_API_KEY']`; `EMAIL_TRANSPORT=log` without it → ok.
  - `loadDatabaseConfig({ DATABASE_URL })` → ok with no other keys.
- [ ] **Step 2: Run** `npm test -w server -- config` → FAIL.
- [ ] **Step 3: Implement.** URL keys share one Zod schema: `z.url()`, then a refine that the protocol is `https:` (or `http:` when the hostname is `localhost` / `127.0.0.1`), the pathname is `/`, and there is no search or hash. Transform to `new URL(v).origin`. Make the `RESEND_API_KEY` requirement a `superRefine` with `path: ['RESEND_API_KEY']`, so `ConfigError.keys` lists it. `worker.ts` and `migrate.ts` switch to `loadDatabaseConfigOrExit`.
- [ ] **Step 4: `.env.example`:** add every new key, with local values `CLIENT_URL=http://localhost:5173`, `ADMIN_URL=http://localhost:5174`, `API_URL=http://localhost:3000`, `EMAIL_TRANSPORT=log`, `EMAIL_FROM=Electricity Monitor <noreply@localhost>`, and empty Google keys.
- [ ] **Step 5: Run** → PASS; `npm run typecheck` passes (update `testApp` to use `testConfig`).
- [ ] **Step 6: Docs.** P §12: domain lines per decision 1, config block with the new keys (`ENCRYPTION_KEY` and Telegram stay listed for later milestones), one sentence that the worker and migrations need only `DATABASE_URL`.
- [ ] **Commit point:** `server/src/config.ts server/src/config.test.ts server/src/worker.ts server/src/db/migrate.ts server/.env.example server/test/app.ts docs/PROJECT_V2.md` — `Add auth config and domain plan`

### Task 2: Password hashing and access JWT

**Files:**

- Create: `server/src/auth/password.ts`, `server/src/auth/password.test.ts`, `server/src/auth/jwt.ts`, `server/src/auth/jwt.test.ts`
- Modify: `server/package.json` (add `jose`)

**Interfaces:**

- Produces: `hashPassword(password: string): Promise<string>`; `verifyPassword(password: string, phc: string): Promise<boolean>` (never throws; malformed hash → `false`); `verifyDummyPassword(password: string): Promise<false>` (does the same work as a real verify against a fixed hash, used when no user or no password exists).
- Produces: `ACCESS_TOKEN_TTL_S = 900`; `type AccessClaims = { userId: string; sessionId: string }`; `signAccessToken(secret: string, clock: Clock, claims: AccessClaims): Promise<string>`; `verifyAccessToken(secret: string, clock: Clock, token: string): Promise<AccessClaims | null>`.

- [ ] **Step 1: Password tests:**
  - `hashPassword('correct horse 1')` matches `/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/`; two hashes of the same password differ.
  - `verifyPassword` is true for the right password and false for a wrong one, an empty one and `'Correct horse 1'`.
  - A hash with changed params (`m=8192,t=1,p=1`, built by hand with `crypto.argon2Sync`) verifies, so parameters come from the string.
  - Malformed strings (`''`, `'$argon2i$…'`, wrong segment count, bad base64) → `false`, no throw.
  - `verifyDummyPassword('x')` resolves `false`.
- [ ] **Step 2: JWT tests** (`FakeClock` at `2026-11-21T16:42:00Z`):
  - sign then verify → `{ userId, sessionId }`; the payload has `sub`, `sid`, `aud: 'access'`, `exp - iat === 900`.
  - after `clock.advance(899_000)` it verifies; after `advance(900_000)` → `null`.
  - wrong secret → `null`; a token with a flipped signature character → `null`; an `alg: none` token (built with `new UnsecuredJWT(...)`) → `null`; a token with `aud: 'oauth-state'` → `null`; `'garbage'` → `null`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** Password: `promisify(crypto.argon2)('argon2id', { message, nonce: randomBytes(16), parallelism: 1, tagLength: 32, memory: 19456, passes: 2 })`; compare with `timingSafeEqual`. JWT: `new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setAudience('access').setIssuedAt(now).setExpirationTime(nowSeconds + 900)`; `jwtVerify(token, key, { algorithms: ['HS256'], audience: 'access', currentDate: clock.now() })`, any error → `null`. The secret is encoded once with `TextEncoder`.
- [ ] **Step 5: Run** → PASS.
- [ ] **Commit point:** `server/src/auth/ server/package.json package-lock.json` — `Add argon2id passwords and access JWT`

### Task 3: Email templates and senders

**Files:**

- Create: `server/src/email/templates.ts`, `server/src/email/templates.test.ts`, `server/src/email/sender.ts`, `server/src/email/sender.test.ts`
- Modify: `shared/src/i18n/locales/{uk,en,ru}.ts`, `server/test/fakes.ts`, `server/package.json` (add `resend`)

**Interfaces:**

- Produces: `type EmailKind = 'verifyEmail' | 'resetPassword' | 'accountExists'`; `type RenderedEmail = { subject: string; text: string; html: string }`; `renderEmail(i18n: i18n, kind: EmailKind, vars: { lang: Language; name: string; link: string }): RenderedEmail`.
- Produces: `type EmailMessage = RenderedEmail & { to: string }`; `interface EmailSender { send(message: EmailMessage): Promise<void> }`; `createResendSender(client: Pick<Resend, 'emails'>, from: string): EmailSender`; `createLogSender(from: string, logger: Logger): EmailSender`; `createEmailSender(config: EmailConfig, logger: Logger): EmailSender`; `sendInBackground(sender: EmailSender, logger: Logger, message: EmailMessage): void`.
- Produces (test): `class FakeEmailSender implements EmailSender { sent: EmailMessage[]; failNext(): void }`; `linkFrom(message: EmailMessage): string` (the first `https?://` URL in `text`, throws if none).

- [ ] **Step 1: Dictionary keys** in all three languages: `email.footer` ("If you didn't request this, ignore this email."), `email.verifyEmail.{subject,intro,action,expiry}` with intro `"Hi {{name}}, confirm your email address for Electricity Monitor."` and expiry "valid for 24 hours", `email.resetPassword.{subject,intro,action,expiry}` (1 hour), `email.accountExists.{subject,intro,action}` (someone tried to create an account with this email; action "Log in"; mention resetting the password if forgotten). The parity test keeps the three files in step.
- [ ] **Step 2: Template tests:**
  - each kind × each language renders a non-empty subject; `text` contains the link and `name`; `html` contains the link inside `href="…"`.
  - `lang: 'en'` verify subject equals `en.email.verifyEmail.subject`; `lang: 'ru'` returns the Russian one.
  - name `<b>John</b> & co` → `html` contains `&lt;b&gt;John&lt;/b&gt; &amp; co` and not `<b>John`; `text` contains `<b>John</b> & co` (Review Focus 3).
- [ ] **Step 3: Sender tests:**
  - Resend sender with a stub `emails.send` returning `{ data: { id: '1' }, error: null }` → called once with `{ from, to, subject, text, html }`.
  - The stub returns `{ data: null, error: { name: 'validation_error', message: 'bad from' } }` → `send` rejects with an `Error` whose message contains `bad from`. Resend returns errors and does not throw.
  - `sendInBackground` with a failing sender → returns synchronously, `logger.error` is called once after the promise settles, no unhandled rejection.
  - The log sender writes `to`, `subject` and `text` through `logger.info`.
- [ ] **Step 4: Run** → FAIL, then implement. HTML is one small layout function (paragraph, button link, footer); every interpolated value goes through a 5-character `escapeHtml`. `createEmailSender` builds `new Resend(apiKey)` for `resend`.
- [ ] **Step 5: Run** → PASS (`npm test`, includes the shared parity test).
- [ ] **Commit point:** `shared/src/i18n/ server/src/email/ server/test/fakes.ts server/package.json package-lock.json` — `Add email templates and Resend sender`

### Task 4: Rate limiter

**Files:**

- Create: `server/src/rateLimit/limiter.ts`, `server/src/rateLimit/limiter.test.ts`, `server/src/rateLimit/cleanup.ts`, `server/src/rateLimit/cleanup.test.ts`, `server/src/http/rateLimit.ts`, `server/src/http/rateLimit.test.ts`, `server/drizzle/0002_rate_limit_bucket.sql` (generated)
- Modify: `server/src/db/schema/platform.ts`, `server/src/http/errors.ts`, `server/src/worker.ts`, `server/test/fakes.ts`
- Docs: `docs/DATABASE.md` (§8 new table, "Not stored" list, §10 cleanup row, §12 Q4 resolved), `docs/API.md` §1 Rate limits

**Interfaces:**

- Produces: `type RateRule = { limit: number; windowS: number }`; `interface RateLimiter { hit(key: string, rule: RateRule): Promise<{ allowed: boolean; retryAfterS: number }> }`; `createPgRateLimiter(db: Db, clock: Clock): RateLimiter`; `rateLimitKey(name: string, scope: 'ip' | 'email' | 'user', value: string): string` = `${name}:${scope}:${sha256(value).toString('hex')}`; rules `AUTH_PER_IP = { limit: 10, windowS: 60 }`, `LOGIN_PER_EMAIL = { limit: 10, windowS: 900 }`, `EMAIL_SEND = { limit: 3, windowS: 3600 }`, `REAUTH_PER_USER = { limit: 10, windowS: 900 }`.
- Produces: `rateLimit(limiter: RateLimiter, name: string, rules: { ip?: RateRule; email?: RateRule; user?: RateRule }): RequestHandler`. Reads `req.ip`, the trimmed lowercased `req.body.email` when it is a string, and `getAuth(res).user.id` when the `user` rule is set (Task 6 adds `getAuth`; until then the `user` branch reads `res.locals.auth?.user.id`).
- Produces: `HttpError` gains an optional 5th constructor argument `headers?: Record<string, string>`, which `errorHandler` sets on the response.
- Produces: `cleanupRateLimits(db: Db, clock: Clock): Promise<void>`.
- M2's `POST /api/v1/device/claim` will use `rateLimit(limiter, 'claim', { ip: AUTH_PER_IP })`. Nothing to build for it here.
- Produces (test): `allowAllLimiter: RateLimiter`.

- [ ] **Step 1: Schema.** Add to `platform.ts` and to D §8:

```sql
create table rate_limit_bucket (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null
);

create index rate_limit_bucket_window_start_idx on rate_limit_bucket (window_start);
```

`enableRLS()`. Run `npm run db:generate -w server -- --name=rate_limit_bucket` and read the SQL.

- [ ] **Step 2: Limiter tests** (PGlite, `FakeClock` at `16:42:00Z`, rule `{ limit: 3, windowS: 60 }`):
  - 3 hits allowed, the 4th → `{ allowed: false, retryAfterS: 60 }`. At `16:42:45Z` → `retryAfterS: 15`.
  - at `16:43:00Z` the window resets → allowed, the stored count is 1.
  - different keys don't share a count.
  - `rateLimitKey('login', 'email', 'a@b.c')` doesn't contain `a@b.c`.
- [ ] **Step 3: Middleware tests** (test route with `rules { ip: {limit: 2, windowS: 60}, email: {limit: 1, windowS: 60} }`):
  - the 2nd request with the same email → `429 {"error":{"code":"rate_limited",…}}` and a `Retry-After` header (digits only).
  - when two rules deny, `Retry-After` is the larger value; each request counts in every bucket.
  - `" A@B.C "` and `"a@b.c"` share a bucket.
  - no `email` field → only the IP rule applies.
- [ ] **Step 4: Cleanup test:** rows with `window_start` 25 h old are deleted, 1 h old rows stay.
- [ ] **Step 5: Run** → FAIL, then implement. `hit` is one statement, with `ws = floor(now / windowS) * windowS`:

```sql
insert into rate_limit_bucket (key, window_start, count) values ($key, $ws, 1)
on conflict (key) do update set
  count = case when rate_limit_bucket.window_start = excluded.window_start
               then rate_limit_bucket.count + 1 else 1 end,
  window_start = excluded.window_start
returning count
```

`retryAfterS = ceil((ws + windowS − now) / 1 s)` when `count > limit`. The worker tick becomes `beat` then `cleanupRateLimits`.

- [ ] **Step 6: Run** → PASS; `npx -w server drizzle-kit generate` reports no changes.
- [ ] **Step 7: Docs.** D §8: the table plus "fixed window, keys hold a SHA-256, worker deletes rows older than one day"; remove "Rate limit counters" from "Not stored"; D §10 cleanup row; D §12 Q4 → resolved. A §1 Rate limits: add the per-email and per-user rows from decision 2.
- [ ] **Commit point:** `server/src/rateLimit/ server/src/http/rateLimit.ts server/src/http/rateLimit.test.ts server/src/http/errors.ts server/src/db/schema/platform.ts server/drizzle/ server/src/worker.ts server/test/fakes.ts docs/DATABASE.md docs/API.md` — `Add Postgres rate limiter`. 👤 Review `0002_rate_limit_bucket.sql`.

### Task 5: Sessions, refresh rotation and one-time tokens

**Files:**

- Create: `server/src/auth/sessions.ts`, `server/src/auth/sessions.test.ts`, `server/src/auth/sessions.pg.test.ts`, `server/src/auth/oneTimeTokens.ts`, `server/src/auth/oneTimeTokens.test.ts`
- Modify: `server/src/db/client.ts` (add `Tx`, `Executor`)

**Interfaces:**

- Produces: `type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]`; `type Executor = Db | Tx`.
- Produces: `REFRESH_TTL_S = 2_592_000`; `REUSE_GRACE_S = 10`;
  `createSession(db: Executor, clock: Clock, userId: string): Promise<{ sessionId: string; refreshToken: string }>`;
  `type RotateResult = { ok: true; userId: string; sessionId: string; refreshToken: string } | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' | 'racing' }`;
  `rotateRefreshToken(db: Db, clock: Clock, token: string): Promise<RotateResult>`;
  `findActiveSession(db: Executor, clock: Clock, token: string): Promise<{ userId: string; sessionId: string } | null>`, where the token must be unused, unexpired and its session not revoked;
  `revokeSessionByToken(db: Executor, clock: Clock, token: string): Promise<void>`, where any token of the family revokes the session;
  `revokeUserSessions(db: Executor, clock: Clock, userId: string, except?: string): Promise<void>`.
- Produces: `type OneTimePurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD'`; `ONE_TIME_TTL_S = { VERIFY_EMAIL: 86_400, RESET_PASSWORD: 3_600 }`; `issueOneTimeToken(db: Executor, clock: Clock, userId: string, purpose: OneTimePurpose): Promise<string>`; `consumeOneTimeToken(db: Executor, clock: Clock, token: string, purpose: OneTimePurpose): Promise<string | null>` (returns the user ID); `expireOneTimeTokens(db: Executor, clock: Clock, userId: string, purpose: OneTimePurpose): Promise<void>`.

- [ ] **Step 1: Session tests** (PGlite, `FakeClock`, one user):
  - `createSession` stores a session and a refresh token whose `token_hash = sha256(token)` and `expires_at = now + 30 d`; the raw token is not in the table.
  - rotate → `ok`, same `sessionId`, a new token; the old row has `used_at = now`, the new one `expires_at = now + 30 d`, `session.last_used_at = now`.
  - rotate the **old** token 10 s later → `racing`; the session is not revoked and the new token still rotates.
  - rotate the old token 11 s later → `reused`; `session.revoked_at` is set; the newest token now → `revoked`.
  - token unknown → `unknown`; after `advance(30 d)` → `expired`; revoked session → `revoked`.
  - `findActiveSession` returns the session for the newest token, `null` for a used, expired or revoked one.
  - `revokeUserSessions(…, except)` revokes all but `except`; `revokeSessionByToken` with an already used token revokes its session.
- [ ] **Step 2: Concurrency test** (`sessions.pg.test.ts`, `describe.skipIf(!pgTestUrl)`): `Promise.all` of two `rotateRefreshToken` with the same token → exactly one `ok` and one `racing`; the session is not revoked (Review Focus 1).
- [ ] **Step 3: One-time token tests:**
  - issue then consume → user ID; a 2nd consume → `null`.
  - `VERIFY_EMAIL` consumed at +24 h − 1 s works; another token at +24 h → `null`. `RESET_PASSWORD` at +1 h → `null`.
  - a verify token consumed as `RESET_PASSWORD` → `null` and stays usable as `VERIFY_EMAIL`.
  - `expireOneTimeTokens` makes every unused token of that purpose unusable.
- [ ] **Step 4: Run** → FAIL.
- [ ] **Step 5: Implement.** `rotateRefreshToken` runs in one transaction: `select … from refresh_token join session … where token_hash = $1 for update of refresh_token`; check, in order, missing → `unknown`, `session.revoked_at` → `revoked`, `used_at` within `REUSE_GRACE_S` → `racing`, `used_at` older → revoke the session, `reused`, `expires_at <= now` → `expired`; otherwise mark it used, insert the next token and touch `last_used_at`. `consumeOneTimeToken` is one `update … set used_at = $now where token_hash = $1 and purpose = $2 and used_at is null and expires_at > $now returning user_id`.
- [ ] **Step 6: Run** → PASS (also with `TEST_DATABASE_URL` set, if a local Postgres is available).
- [ ] **Commit point:** `server/src/auth/sessions* server/src/auth/oneTimeTokens* server/src/db/client.ts` — `Add sessions and one-time tokens`

### Task 6: HTTP auth plumbing

**Files:**

- Create: `server/src/http/cookies.ts`, `server/src/http/cors.ts`, `server/src/http/cors.test.ts`, `server/src/http/auth/middleware.ts`, `server/src/http/auth/middleware.test.ts`, `server/test/auth.ts`
- Modify: `server/src/http/app.ts`, `server/src/http/openapi.ts`, `server/src/http/errors.ts`, `server/src/api.ts`, `server/test/app.ts`, `server/package.json` (add `cors`, `cookie-parser`, `@types/cors`, `@types/cookie-parser`)
- Docs: `docs/API.md` §1 error table (`invalid_credentials`, `reauth_required`)

**Interfaces:**

- Consumes: Tasks 1–5.
- Produces: `type AppDeps = { db: Db; clock: Clock; logger: Logger; config: Config; email: EmailSender; rateLimiter: RateLimiter }` (Task 10 adds `google`). `createApp` sets `trust proxy` to `config.trustProxyHops` and mounts `cookieParser()`, then `corsMiddleware`, then `express.json`, then the routers.
- Produces: `REFRESH_COOKIE = 'em_refresh'`; `setRefreshCookie(res, token: string): void`; `clearRefreshCookie(res): void`; `readRefreshCookie(req): string | undefined`.
- Produces: `corsMiddleware(urls: AppUrls): RequestHandler` (`cors({ origin: [client, admin], credentials: true, maxAge: 600 })`); `requireAppOrigin(urls: AppUrls): RequestHandler`, where a missing or foreign `Origin` → `403 forbidden`.
- Produces: `type User = typeof appUser.$inferSelect`; `type AuthContext = { user: User; sessionId: string; sessionCreatedAt: Date }`; `requireUser(deps: AppDeps): RequestHandler`; `requireVerifiedEmail: RequestHandler`; `getAuth(res): AuthContext`.
- Produces: `ErrorCode` adds `'invalid_credentials' | 'reauth_required'`. `buildOpenApiDocument` adds `components.securitySchemes.bearerAuth` (`http`, `bearer`, `JWT`).
- Produces (test): `testApp(overrides?: Partial<AppDeps> & { routes?: (app: Express) => void }): Express`, with defaults PGlite-less stub db, `FakeClock`, `testConfig`, `FakeEmailSender`, `allowAllLimiter`. `createUser(db: Db, overrides?: Partial<typeof appUser.$inferInsert> & { password?: string }): Promise<User>` creates a verified user, password `'correct horse 1'`, email `john@example.com`. `signIn(deps: Pick<AppDeps, 'db' | 'clock' | 'config'>, userId: string): Promise<{ accessToken: string; refreshToken: string; sessionId: string }>`.

- [ ] **Step 1: CORS and origin tests:**
  - `OPTIONS /api/auth/refresh` with `Origin: https://app.test` and `Access-Control-Request-Method: POST` → `204`, `Access-Control-Allow-Origin: https://app.test`, `Access-Control-Allow-Credentials: true`; `Origin: https://evil.test` → no `Access-Control-Allow-Origin`.
  - `requireAppOrigin` on a test route: `Origin: https://admin.test` → passes; `https://evil.test`, `https://app.test.evil.test` or no `Origin` → `403 forbidden`.
  - with `trustProxyHops: 1`, `X-Forwarded-For: 203.0.113.7` → a test route sees `req.ip === '203.0.113.7'`; with `0` it doesn't.
- [ ] **Step 2: Middleware tests** (PGlite, test route `GET /test/me` returning `getAuth(res).user.id`):
  - valid token → `200` with the ID.
  - no header, `Bearer garbage`, `Basic x`, `Bearer em_live_abc` → `401 unauthorized`.
  - after `clock.advance(900_000)` → `401`.
  - session revoked → `401`; user deleted → `401`.
  - `requireVerifiedEmail` with `email_verified_at` null → `403 email_not_verified`; verified → `200`.
- [ ] **Step 3: Run** → FAIL, then implement. `requireUser` makes one query: `session join app_user on session.user_id = app_user.id where session.id = $sid and app_user.id = $sub and session.revoked_at is null`. Store the result in `res.locals.auth`. `api.ts` builds `createEmailSender(config.email, console)` and `createPgRateLimiter(db, systemClock)`.
- [ ] **Step 4: Run** → PASS; all M0 tests still pass.
- [ ] **Commit point:** `server/src/http/ server/src/api.ts server/test/ server/package.json package-lock.json docs/API.md` — `Add CORS, auth cookies and requireUser`

### Task 7: Sign up and email verification

**Files:**

- Create: `server/src/http/auth/schemas.ts`, `server/src/http/auth/schemas.test.ts`, `server/src/http/auth/signup.ts`, `server/src/http/auth/signup.test.ts`
- Modify: `server/src/http/app.ts`
- Docs: `docs/API.md` §3 (signup body/response, verify 410 cases, resend accepted)

**Interfaces:**

- Produces (`schemas.ts`): `emailSchema` (`z.string().trim().toLowerCase().pipe(z.email().max(254))`), `passwordSchema` (`z.string().min(8).max(128)`), `nameSchema` (`z.string().trim().min(1).max(100)`), `languageSchema` (`z.enum(languages)`), `timezoneSchema` (accepted when `new Intl.DateTimeFormat('en', { timeZone })` doesn't throw, transformed to `resolvedOptions().timeZone`).
- Produces: `signupRouter(deps: AppDeps): Router`, `signupPaths`, routes:
  - `POST /api/auth/signup` → `201`, empty body. Rate limits: `AUTH_PER_IP`, email `EMAIL_SEND`.
  - `POST /api/auth/verify-email` `{ token }` → `204`, or `410 expired`. Rate limit `AUTH_PER_IP`.
  - `POST /api/auth/resend-verification` (JWT) → `204`. Rate limits `AUTH_PER_IP`, user `EMAIL_SEND`.

- [ ] **Step 1: Schema tests:** `emailSchema.parse('  John@Example.COM ') === 'john@example.com'`; `'not-an-email'` fails. `timezoneSchema`: `'Europe/Kyiv'` ok, `'Mars/Base'` fails, `'utc'` → `'UTC'`. A name of only spaces fails. A 7-char password fails, and 129 chars fails.
- [ ] **Step 2: Route tests** (`FakeEmailSender`, `FakeClock`):
  - new email `" John@Example.COM "` → `201`, empty body; one `app_user` with `email = 'john@example.com'`, an argon2id `password_hash`, `email_verified_at` null, the given language and timezone; one email to `john@example.com` whose subject is the `verifyEmail` subject in the given language; `linkFrom` starts with `https://app.test/verify-email?token=` (Review Focus 2).
  - existing email → the same `201` and empty body, still one user, one `accountExists` email in the **existing** user's language (no enumeration).
  - invalid body (bad email, short password, unknown language `de`, bad timezone) → `400 validation_error` with the paths.
  - verify with the link token → `204`, `email_verified_at = now`; the same token again → `410 expired`.
  - a token used at +24 h → `410`; at +24 h − 1 s → `204`. `'garbage'` → `410`.
  - resend (JWT, unverified) → `204` and a new verify email; the old link still works. Verified user → `204` and no email. No JWT → `401`.
  - the 11th signup from one IP in a minute → `429` with `Retry-After` (real `createPgRateLimiter` on PGlite).
- [ ] **Step 3: Run** → FAIL, then implement. Sign up hashes the password **before** looking up the email, so both paths do the same work. It inserts with `on conflict (email) do nothing returning id`: no row → `accountExists` email to the existing user with link `${client}/login`; a row → issue `VERIFY_EMAIL`, then `sendInBackground` the verify email. Both emails go out after the response is written.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Docs.** A §3: sign up responds `201` with no body and does not sign in; verify returns `410` for unknown, used, expired or wrong-purpose tokens; email link formats; remove `(proposed)` from resend-verification and note that a verified account gets `204` with no email. P §3: decisions 6–8.
- [ ] **Commit point:** `server/src/http/auth/ server/src/http/app.ts docs/API.md docs/PROJECT_V2.md` — `Add sign up and email verification`

### Task 8: Log in, refresh and log out

**Files:**

- Create: `server/src/http/account/me.ts` (`meSchema`, `toMe` only for now), `server/src/http/auth/session.ts`, `server/src/http/auth/session.test.ts`
- Modify: `server/src/http/app.ts`
- Docs: `docs/API.md` §3 (refresh `409`, cookie name and path), `docs/PROJECT_V2.md` §3 (grace), `docs/DATABASE.md` §3 `refresh_token` notes

**Interfaces:**

- Produces: `meSchema` (Zod, `.meta({ id: 'Me' })`, the A §4 `GET /me` shape); `toMe(user: User): Me`; `sessionResponseSchema` `{ access_token, expires_in, user: Me }`; `issueSession(res, deps, user: User, sessionId: string, refreshToken: string): Promise<void>` sets the cookie and sends `200` with the body (used by login and refresh; Google's callback redirects instead and calls `setRefreshCookie` itself).
- Produces: `sessionRouter(deps: AppDeps): Router`, `sessionPaths`, routes:
  - `POST /api/auth/login` `{ email, password }` → `200` session or `401 invalid_credentials`. Rate limits: `AUTH_PER_IP`, email `LOGIN_PER_EMAIL`.
  - `POST /api/auth/refresh` (cookie, `requireAppOrigin`) → `200` session; `409 conflict` for `racing`; `401 unauthorized` and a cleared cookie otherwise.
  - `POST /api/auth/logout` (cookie, `requireAppOrigin`) → `204`, cookie cleared, session revoked when the cookie matches one.
  - `POST /api/auth/logout-all` (JWT) → `204`, all the user's sessions revoked, cookie cleared.

- [ ] **Step 1: Tests:**
  - login `" JOHN@example.com "` with the right password → `200`; body `expires_in: 900`, `user` equals `toMe(user)` (`has_password: true`, `google_linked: false`, `is_admin: false`); `Set-Cookie` has `em_refresh=`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/auth`, `Max-Age=2592000` and no `Domain`; the access token verifies to the new session.
  - an unverified user can log in (`email_verified: false`).
  - wrong password, unknown email, and a Google-only user (no `password_hash`) → identical `401 {"error":{"code":"invalid_credentials",…}}` bodies.
  - refresh with cookie + `Origin: https://app.test` → `200`, a new cookie value, the old one stops working after the grace window.
  - refresh replaying the old cookie 5 s later → `409 conflict`, **no** `Set-Cookie` header; 11 s later → `401`, cookie cleared, and the newest cookie → `401` as well (session revoked).
  - refresh without a cookie → `401`; with `Origin: https://evil.test` → `403 forbidden` and the token is not consumed.
  - after `advance(30 d)` → `401`.
  - logout → `204`, cookie cleared (`Max-Age=0` or an expired date), then refresh with that cookie → `401`; logout with no cookie → `204`.
  - logout-all from one session → `204`; the JWT and refresh token of a second session → `401`.
- [ ] **Step 2: Run** → FAIL, then implement. Login always calls either `verifyPassword` or `verifyDummyPassword`, so both failure paths cost the same.
- [ ] **Step 3: Run** → PASS.
- [ ] **Step 4: Docs** per decision 3 and 12: A §3 refresh row adds `409 conflict` (reused within 10 s; retry once); cookie name and path. P §3 Sessions: the grace sentence. D §3 `refresh_token`: "`used_at` within 10 s → `409`, older → revoke".
- [ ] **Commit point:** `server/src/http/ docs/` — `Add log in, refresh and log out`

### Task 9: Forgot, reset and change password

**Files:**

- Create: `server/src/http/auth/password.ts`, `server/src/http/auth/password.test.ts`
- Modify: `server/src/http/app.ts`
- Docs: `docs/API.md` §3 (change-password accepted, error codes), `docs/PROJECT_V2.md` §3 (decision 9)

**Interfaces:**

- Produces: `passwordRouter(deps: AppDeps): Router`, `passwordPaths`, routes:
  - `POST /api/auth/forgot-password` `{ email }` → always `204`. Rate limits `AUTH_PER_IP`, email `EMAIL_SEND`.
  - `POST /api/auth/reset-password` `{ token, password }` → `204` or `410 expired`. Rate limit `AUTH_PER_IP`.
  - `POST /api/auth/change-password` (JWT) `{ current_password, new_password }` → `204`; `403 invalid_credentials` for a wrong current password; `409 conflict` when the account has no password. Rate limit user `REAUTH_PER_USER`.

- [ ] **Step 1: Tests:**
  - forgot with `" John@Example.com"` → `204`, one `resetPassword` email in the user's language, link `https://app.test/reset-password?token=…`. Unknown email → `204` and no email. A Google-only user → `204` and an email (reset lets them add a password).
  - reset with the link token and a new password → `204`; login works with the new password and fails with the old; every earlier session's refresh → `401`; `email_verified_at` is set if it was null; a 2nd reset link issued before the first one was used → `410`.
  - reset at +1 h → `410`; a short password → `400` and the token is still usable afterwards.
  - change password with the right current password → `204`; the current session still refreshes, another session → `401`; wrong current → `403 invalid_credentials`; Google-only user → `409 conflict`.
- [ ] **Step 2: Run** → FAIL, then implement. Reset runs in one transaction: consume, set `password_hash`, `email_verified_at = coalesce(email_verified_at, now)`, `expireOneTimeTokens(RESET_PASSWORD)`, `revokeUserSessions`. Hash the new password **before** the transaction opens.
- [ ] **Step 3: Run** → PASS.
- [ ] **Step 4: Docs.** A §3: remove `(proposed)` from change-password; list `403 invalid_credentials` and `409`. P §3: decision 9.
- [ ] **Commit point:** `server/src/http/ docs/` — `Add password reset and change`

### Task 10: Google sign-in, link and unlink

**Files:**

- Create: `server/src/auth/google.ts`, `server/src/auth/google.test.ts`, `server/src/http/auth/google.ts`, `server/src/http/auth/google.test.ts`
- Modify: `shared/src/enums.ts`, `server/src/http/app.ts`, `server/src/api.ts`, `server/test/fakes.ts`, `server/test/app.ts`, `server/package.json` (add `arctic`)
- Docs: `docs/API.md` §3 (callback redirects and error codes, unlink accepted), `docs/PROJECT_V2.md` §3 Google (decision 11)

**Interfaces:**

- Produces (`@elec/shared`): `appTargets = ['CLIENT', 'ADMIN'] as const`, `googleIntents = ['LOGIN', 'LINK'] as const` and their union types.
- Produces: `type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name: string | null }`; `interface GoogleClient { authorizationUrl(state: string, codeVerifier: string): URL; exchange(code: string, codeVerifier: string): Promise<GoogleIdentity> }`; `createGoogleClient(config: Config): GoogleClient`, which wraps `new Google(clientId, clientSecret, `${urls.api}/api/auth/google/callback`)` with scopes `['openid', 'email', 'profile']`, uses `decodeIdToken`, and rejects when `aud !== clientId` or `iss` is not `https://accounts.google.com` / `accounts.google.com`.
- Produces: `type OAuthState = { state: string; codeVerifier: string; app: AppTarget; intent: GoogleIntent; userId?: string }`; `signOAuthState(secret, clock, s: OAuthState): Promise<string>` (`aud: 'oauth-state'`, 600 s); `verifyOAuthState(secret, clock, token): Promise<OAuthState | null>`.
- Produces: `AppDeps.google: GoogleClient`. Test: `class FakeGoogleClient implements GoogleClient { identity: GoogleIdentity; failExchange: boolean; lastCode?: string }`; its `authorizationUrl` returns `https://accounts.google.test/auth?state=…`.
- Produces: `googleRouter(deps: AppDeps): Router`, `googlePaths`, routes:
  - `GET /api/auth/google?app=CLIENT|ADMIN&intent=LOGIN|LINK` → sets the `em_oauth` cookie, `302` to Google. A bad query → `400`. `LINK` without an active refresh cookie → `302` to `<app>/auth/google?error=google_failed`. Rate limit `AUTH_PER_IP`.
  - `GET /api/auth/google/callback?code&state` → clears `em_oauth`, `302` to `<app>/auth/google` (with the refresh cookie on `LOGIN`) or `?error=<code>`.
  - `DELETE /api/auth/google` (JWT) → `204`; `409 conflict` when the account has no password.

- [ ] **Step 1: Unit tests** (`google.test.ts`): state round-trips; at +600 s → `null`; an access JWT passed as state → `null`, and vice versa. `createGoogleClient(testConfig).authorizationUrl('s', 'v')` has host `accounts.google.com`, `state=s`, `code_challenge_method=S256`, `redirect_uri=https://api.test/api/auth/google/callback` and a scope containing `email`. The exchange is not unit tested (network), only by hand on staging.
- [ ] **Step 2: Route tests** (helper `startFlow(app, query, cookie?)` returns the `em_oauth` cookie and `state` from `Location`):
  - start `app=ADMIN&intent=LOGIN` → `302` to `accounts.google.test`; the `em_oauth` cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/auth/google`, `Max-Age=600`.
  - `LOGIN`, new identity → a user is created with `google_sub`, `email_verified_at = now`, `password_hash` null, `name` from Google (fallback: the email local part); `302` to exactly `https://admin.test/auth/google`; `em_refresh` is set and works on refresh.
  - `LOGIN`, a known `google_sub` → signs into that user, no new user.
  - `LOGIN`, a verified password user with the same email → `google_sub` linked, password kept.
  - `LOGIN`, an **unverified** password user with the same email and an existing session → linked, `email_verified_at` set, `password_hash` null, the old session's refresh → `401`.
  - `LOGIN` with `emailVerified: false` → `?error=google_email_unverified`, no user changes.
  - `LINK` with a refresh cookie → `google_sub` set on that user, `302` to `/auth/google` with no new session row. The `google_sub` already on another user → `?error=google_account_in_use`. A user who already has a different `google_sub` → `?error=google_already_linked`.
  - callback without the `em_oauth` cookie, with a mismatched `state`, with `error=access_denied`, or with `failExchange` → `302` to `https://app.test/auth/google?error=google_failed`, status never `500` (Review Focus 5).
  - `?app=https://evil.test` → `400`; a `Location` never points outside the two app origins.
  - unlink with a password → `204`, `google_sub` null; Google-only → `409 conflict`; no JWT → `401`.
- [ ] **Step 3: Run** → FAIL, then implement. Call `google.exchange` before opening any transaction. Run the account changes (create, link, take over and revoke) and `createSession` in one transaction afterwards. Catch errors from the exchange and from state checks and turn them into the `google_failed` redirect. Errors after that point are bugs and go to the error handler. `api.ts` adds `google: createGoogleClient(config)`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Docs.** A §3: the callback redirect target and error codes, the `LINK` cookie note, and `(proposed)` removed from `DELETE /api/auth/google`. P §3 Google: decision 11.
- [ ] **Commit point:** `shared/src/enums.ts server/src/auth/google* server/src/http/ server/src/api.ts server/test/ server/package.json package-lock.json docs/` — `Add Google sign-in and linking`

### Task 11: Profile endpoints

**Files:**

- Modify: `server/src/http/account/me.ts`, `server/src/http/app.ts`
- Create: `server/src/http/account/me.test.ts`
- Docs: `docs/API.md` §4 Account (delete errors)

**Interfaces:**

- Produces: `meRouter(deps: AppDeps): Router`, `mePaths`, routes:
  - `GET /api/v1/me` (JWT) → `200 Me`.
  - `PATCH /api/v1/me` (JWT) `{ name?, language?, timezone? }` (strict object) → `200 Me`.
  - `DELETE /api/v1/me` (JWT) `{ password? }` → `204`, cookie cleared. A wrong or missing password on an account with one → `403 invalid_credentials`. A Google-only account whose session `created_at` is more than 300 s old → `403 reauth_required`. Rate limit user `REAUTH_PER_USER`.

- [ ] **Step 1: Tests:**
  - `GET` → exactly the A §4 shape for a password user (`has_password: true`, `google_linked: false`) and a Google-only user (`false`, `true`); `is_admin` reflects the column.
  - `PATCH { language: 'en', timezone: 'utc', name: '  Johnny ' }` → `200` with `en`, `UTC`, `Johnny`, and `updated_at` changed. `{ language: 'de' }`, `{ email: 'x@y.z' }` (unknown key) and `{ name: '' }` → `400`. `{}` → `200`, unchanged.
  - `DELETE` with the right password → `204`; the user's sessions, refresh and one-time tokens are gone (cascade); the old JWT → `401`; then `GET` from **another** user still works and their data is untouched.
  - wrong password → `403 invalid_credentials`, the user still exists.
  - Google-only, session 299 s old → `204`; at 301 s → `403 reauth_required`.
  - no JWT → `401` on all three.
- [ ] **Step 2: Run** → FAIL, then implement.
- [ ] **Step 3: Run** → PASS.
- [ ] **Step 4: Docs.** A §4 Account: `DELETE /me` errors `403 invalid_credentials` and `403 reauth_required`.
- [ ] **Commit point:** `server/src/http/account/ server/src/http/app.ts docs/API.md` — `Add profile endpoints`

### Task 12: OpenAPI coverage, staging and roadmap

**Files:**

- Create: `deploy/README.md`, `deploy/Caddyfile`, `deploy/systemd/elec-staging-{api,worker}.service`, `deploy/staging.env.example`, `deploy/staging-release.sh`
- Modify: `server/src/config.ts`, `server/src/config.test.ts`, `server/src/http/listen.ts`, `server/src/http/listen.test.ts`, `server/src/api.ts`, `server/src/worker.ts`, `docs/PROJECT_V2.md` §12, `server/src/http/openapi.test.ts`, `docs/ROADMAP.md`, `docs/API.md` §9 (strike the gaps M1 closed), `docs/DATABASE.md` §12 Q4

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: OpenAPI test:** the document has every M1 path and method: `post /api/auth/{signup,verify-email,resend-verification,login,refresh,logout,logout-all,forgot-password,reset-password,change-password}`, `get /api/auth/google`, `get /api/auth/google/callback`, `delete /api/auth/google`, `get|patch|delete /api/v1/me`. JWT endpoints list `security: [{ bearerAuth: [] }]`, `components.schemas.Me` exists, and every auth `POST` lists a `429` response.
- [ ] **Step 2: Run** → PASS (fix any route missing from its `paths` export).
- [ ] **Step 3: EC2 staging files.** Add `deploy/` (Caddyfile, two `systemd` units, `staging.env.example`, `staging-release.sh`, runbook README). Add optional `HOST` to `loadConfig` and `listen(app, port, host?)`, with tests; staging sets `HOST=127.0.0.1`. Drop `RENDER_INSTANCE_ID` from the worker. P §12 [EC2 staging setup](../PROJECT_V2.md#ec2-staging-setup).
- [ ] **Step 4: Full check:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` all exit 0.
- [ ] **Step 5: Roadmap.** Tick the M1 deliverables that merged; mark Q4, Q5 and the three M1 Q14 endpoints ✅ in Decisions (the decisions are already in the spec from Tasks 1, 4, 7–10); status board M1 🟡 until the manual checks below pass, then ✅.
- [ ] **Commit point:** `deploy/ server/src/ docs/` — `Add EC2 staging deploy files`

**M1 done when (ROADMAP):** tests cover link expiry with a controlled clock, single use, refresh reuse revoking the session, rate limiting and no enumeration (Tasks 4, 5, 7–9). 👤 Verify by hand:

- Follow [deploy/README.md](../../deploy/README.md) on `elec-staging`: Elastic IP, Porkbun `A` record for `staging-api`, Node 26, Caddy, `elec` user, checkout, `/etc/elec/staging.env` with the Supabase staging transaction pooler URL (port 6543), services, first release.
- Verify the runbook checks: `/health` is `200` over HTTPS, `worker_heartbeat.beat_at` advances, port 3000 is closed from outside.
- Create DNS records for `staging-app` and `staging-admin` when their pages are hosted.
- Resend: verify the sending domain, set `EMAIL_FROM`.
- Google Cloud: OAuth client (web) with redirect URI `https://staging-api.<domain>/api/auth/google/callback`; JS origins aren't needed (server-side flow).
- On staging, log `req.ip` once from a known network and confirm it shows your public IP with `TRUST_PROXY_HOPS=1` and Caddy as the only proxy.
- Until the M4 client exists, run the flow from the browser console on a page served at `https://staging-app.<domain>` (any static page): sign up, open the verification email, verify, log in, refresh (cookie rotates), sign in with Google, log out. Check the cookie is `HttpOnly`, `Secure`, host-only on `staging-api.<domain>`.
- Confirm a request from another origin gets no CORS headers.
