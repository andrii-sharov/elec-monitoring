# M7 — Phone sign-in via Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** users pick an email **or** a mobile phone as their identifier; phone accounts confirm the number once through the platform Telegram bot, which then delivers what email delivers for email accounts. API tokens are removed.

**Architecture:** `app_user` gets `phone`, `phone_verified_at` and `telegram_user_id`; `email` becomes optional. The bot learns a contact-sharing conversation (`/start p_<code>` → "Share my phone number" → `contact` message) that verifies the phone and binds the Telegram user. After that the API pushes reset links, "someone tried to sign up" notices and phone invites with the existing `TelegramClient`, the same way it sends emails (`…InBackground`, after commit). Every auth body takes exactly one of `email` / `phone`.

**Tech Stack:** unchanged from M6 (server: Express 5, Drizzle + Drizzle Kit, Zod, zod-openapi, i18next, Vitest + PGlite + supertest; client: React 19, React Router, TanStack Query 5, React Hook Form, shadcn/ui, Vitest + Testing Library + MSW). New dependency: `libphonenumber-js` in `shared/`.

**Spec:** this file's [Design](#design) section, plus [PROJECT_V2.md](../PROJECT_V2.md) §3, §6, §7 platform bot, §10 · [API.md](../API.md) §1, §3, §4 Sharing and Account, §6 · [DATABASE.md](../DATABASE.md) §3, §4 `device_invite`, §11.

---

## Design

### Intent

Users choose their identifier: an email **or** a mobile phone number. A phone works everywhere an email works today: sign up, log in, password reset, device invites and member lists. Messages that go by email for an email account go through the platform Telegram bot for a phone account, with their own texts. No SMS provider.

This milestone **replaces** the old M7 "API tokens and public REST API". Nobody outside our own apps calls the API, so tokens are removed.

### Goals

- Sign up, log in and reset the password with a phone number.
- The user shares their phone with the bot **once**, when they confirm it. After that the bot sends links and notices on its own.
- Phone and email are each unique across accounts. Every account has at least one of them.
- Invite a viewer by email or by phone.
- An email account can add a phone; a phone account can add an email.
- Confirming a phone also connects that Telegram chat for alerts.

### Non-goals

- SMS or any paid provider.
- Changing or removing an identifier once set (same as Q15 for email).
- Logging in without a password ("magic link" via Telegram).
- Google sign-in for phone numbers (Google stays email-based).
- Public REST API, API tokens, client API docs page.

### Anti-goals

- No enumeration: sign up and forgot password must not reveal, to the web caller, whether a phone has an account.
- Someone who types another person's number must never get an account verified with it or receive that person's invites.

### Approaches considered

- **A. Confirm in Telegram every time.** Every phone action asks the user to share their contact again. Rejected: the user wants to share the phone only once.
- **B. Confirm once, then the bot writes on its own (chosen).** The first contact share binds the Telegram user to the account. Later reset links, "account exists" notices and invites are pushed by the bot. A recovery link that asks for the contact again exists only for lost bindings (blocked bot, new Telegram account).
- **C. SMS codes (Twilio and similar).** Rejected: costs money; Telegram only.

Identity storage: columns on `app_user` (chosen) instead of a separate identities table, which would rework every auth query for no gain.

### Telegram facts this relies on

- A bot can't message a phone number it has never seen. The first contact always starts from the user: a `t.me/<bot>?start=<code>` link.
- The bot gets the phone only when the user taps a `request_contact` keyboard button, which works in private chats only. The `contact` message has `phone_number` and `user_id`. We accept it only when `contact.user_id == message.from.id`.
- A private chat ID equals the Telegram user ID, so `telegram_user_id` is enough to message the user later.
- Start parameters are up to 64 chars of `[A-Za-z0-9_-]`. Phone codes are `p_` + `randomToken()` (45 chars). The `p_` prefix lets the bot answer every phone code the same way, real or not, without touching the existing `TELEGRAM_LINK` codes.
- `phone_number` may come without `+`; it is normalized before comparing.

### Decisions

1. **Data** (one migration, Task 2):
   - `app_user`: `email` nullable (still unique, lowercase); `phone text` unique, E.164; `phone_verified_at timestamptz`; `telegram_user_id bigint` unique; `check (email is not null or phone is not null)`.
   - `one_time_token`: purposes `PHONE_VERIFY` (24 h) and `PHONE_RECOVER` (1 h) added; nullable `phone text` (the number the token is about); nullable `telegram_user_id bigint` (who opened the code), indexed `(telegram_user_id) where used_at is null`.
   - `device_invite`: `email` nullable; `phone text`; `check (num_nonnulls(email, phone) = 1)`; partial unique `(device_id, phone) where accepted_at is null`.
   - `api_token`: dropped (Task 1).
2. **Phone format.** `shared` parses with `libphonenumber-js` (default region `UA`) and stores E.164 (`+380501234567`). `050 123 45 67`, `+38 (050) 123-45-67` and `380501234567` are the same number. Telegram's `phone_number` goes through `telegramPhone()` (digits only → `+` prefixed) before comparing.
3. **Verified** = email verified **or** phone verified. `requireVerifiedEmail` → `requireVerified`; error code `email_not_verified` → `not_verified`.
4. **Bot conversation** (webhook replies only):
   - `/start p_<code>` in a private chat. A valid unused, unexpired `PHONE_VERIFY` / `PHONE_RECOVER` token gets `telegram_user_id = from.id`. Whatever the code, the reply is `askContact` with a one-button `request_contact` keyboard. In a group → `privateOnly`.
   - `contact` message. Reply `mismatch` (and remove the keyboard) when `contact.user_id ≠ from.id`, or no claimed token exists for `from.id`, or `telegramPhone(contact) ≠ token.phone`. Otherwise consume the token:
     - `PHONE_VERIFY`, number held by **another** account → `numberInUse`.
     - `PHONE_VERIFY` otherwise → in one transaction: move `telegram_user_id` from any other account to this one; set `phone`, `phone_verified_at = coalesce(…, now)`; `applyPendingInvites` by phone; connect the chat as a platform channel (if absent) attached to every device the user owns or views. Reply `confirmed`, remove the keyboard.
     - `PHONE_RECOVER` → move `telegram_user_id` to the account, issue a `RESET_PASSWORD` token carrying the phone, reply `resetLink`. The phone becomes verified only when the reset completes.
   - Other `/start <code>` (no `p_`) behaves as today.
5. **Pushes.** `AppDeps.telegram: TelegramClient` (`createLogTelegramClient` when `TELEGRAM_TRANSPORT=log`). `sendTelegramInBackground(client, logger, chatId, text)` mirrors `sendInBackground`; failures are logged only. Pushes go to `telegram_user_id` in the recipient's language: `resetLink`, `signupAttempt`, `invite`.
6. **Auth endpoints** — every body takes exactly one of `email` / `phone` (`identifierSchema`):
   - `POST /api/auth/signup`: email unchanged (`201`, no body). Phone → `201 { telegram_url }` always. A new phone creates the account (phone unverified) and the URL holds a `PHONE_VERIFY` code. An existing phone creates nothing; the URL holds a `PHONE_RECOVER` code, and the bot pushes `signupAttempt` if the account has `telegram_user_id`.
   - `POST /api/auth/login` `{ email | phone, password }`. The per-identifier login limit applies to the phone too.
   - `POST /api/auth/forgot-password`: email unchanged (`204`). Phone → `200 { telegram_url }` always. An existing account gets a `PHONE_RECOVER` code in the URL and, with `telegram_user_id`, the bot pushes `resetLink` at once (a fresh `RESET_PASSWORD` token). No account → the URL holds an unstored random `p_` code.
   - `POST /api/auth/reset-password`: a token carrying a phone equal to the account's phone sets `phone_verified_at` (and auto-accepts phone invites if it was unverified) instead of `email_verified_at`. Still revokes all sessions.
   - `POST /api/auth/phone` `{ phone }` (JWT) → `200 { telegram_url }` with a `PHONE_VERIFY` code carrying the number. Another account's number → `409 conflict` with detail `{ path: 'phone', code: 'already_in_use' }`. Own number already verified → `409 conflict` without details. Also the "resend" for an unverified phone account.
   - `POST /api/auth/email` `{ email }` (JWT) → `204`. Account already has an email → `409 conflict`. Free email → set it (unverified) and send the verification email. Taken email → nothing set, the existing account gets the "account exists" email.
   - Google `LINK` on an account without email sets `email` from Google (verified) when no other account has it; otherwise `google_account_in_use`.
   - Rate limits: `EMAIL_SEND` (3 / h) per phone on signup, forgot and `POST /api/auth/phone`; `LOGIN_PER_EMAIL` per phone on login.
   - `GET /me` adds `phone: string | null`, `phone_verified: boolean`; `email` becomes `string | null`.
7. **Sharing by phone.**
   - `POST /devices/:id/invites` `{ email } | { phone }` → `201 Invite`. A phone invite adds `url` (the invite link) to the response, and the bot pushes `invite` when that number belongs to an account with `telegram_user_id`. The response never says whether a push happened.
   - `Invite` and `InvitePreview` get `phone: string | null`; `email` becomes nullable.
   - Already-member and member-limit checks compare by phone for a phone invite.
   - Accept a phone invite: caller's phone = invite phone **and** verified → join. Same phone but unverified → `403 not_verified`. Other phone → `403 forbidden`. A phone invite never verifies anything.
   - `applyPendingInvites(tx, clock, userId, { email } | { phone })` runs where a phone becomes verified (bot confirm, reset).
   - `Member` gets `phone`, with the same visibility rule as `email`.
8. **Bot texts** (`telegram.auth.*`, `en`; plain text):
   - `askContact`: `To confirm your number, tap “Share my phone number” below.`; button `contactButton`: `Share my phone number`
   - `privateOnly`: `Open this link in a private chat with the bot.`
   - `mismatch`: `This link doesn't match your number or has expired. Go back to the site and try again.`
   - `numberInUse`: `This number is already used by another account.`
   - `confirmed`: `Your number is confirmed. Alerts for your devices will come to this chat.`
   - `resetLink`: `Reset your Electricity Monitor password: {{link}}` + `\nThe link is valid for 1 hour.`
   - `signupAttempt`: `Someone tried to create an Electricity Monitor account with your number. You already have one. Log in: {{link}}` + `\nIf you forgot your password, use “Forgot password” on the login page.`
   - `invite`: `{{inviter}} shared {{device}} with you in Electricity Monitor. Open the invite: {{link}}` + `\nThe invite is valid for 7 days.`
9. **Client.**
   - Sign up: an Email / Phone switch; Phone → after submit, a "Confirm in Telegram" screen with the button (`telegram_url`).
   - Log in and Forgot password: one "Email or phone" field (contains `@` → email).
   - Forgot with a phone → "We sent a link to Telegram. Didn't get it? Open the bot and share your number." with the button.
   - Verify banner for an unverified phone account: "Confirm your number in Telegram" → `POST /api/auth/phone` → open `telegram_url`.
   - Account: email and phone rows with status; "Add phone" and "Add email" when missing.
   - Device members: the invite field takes email or phone; after a phone invite, a copyable invite link; members show phone.
   - Invite page: phone invites prefill `/signup?phone=` and `/login?phone=`; same phone but unverified → "Confirm in Telegram".
10. **Removing API tokens:** the `api_token` table, error codes `jwt_required` and `insufficient_scope`, and their mentions in P §2, §8, §9, §10, §14, A §1, §4 (scope columns and "API tokens"), D §3. The OpenAPI document and Swagger UI stay. "JWT only" wording in API.md becomes plain "signed in".
11. **Config.** The API now needs `TELEGRAM_TRANSPORT` and `TELEGRAM_PLATFORM_BOT_TOKEN` too (until now worker-only).

### Calls made in this design

1. Phone accounts keep a password; no passwordless login.
2. Telegram push failures are logged only; the web flow always shows a recovery link.
3. `email_not_verified` is renamed to `not_verified`.
4. A phone invite response shows the invite link to the owner.
5. Accepting a phone invite needs an already verified phone.
6. Confirming a phone auto-creates the platform Telegram alert channel.
7. Adding an identifier is allowed; changing or removing one is not.
8. `libphonenumber-js`, default region `UA`.
9. The OpenAPI document and Swagger UI stay.
10. Phone codes use a `p_` prefix; `PHONE_VERIFY` lasts 24 h, `PHONE_RECOVER` 1 h.

---

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints)–[M6](M06-sharing.md#global-constraints) constraints still applies (ESM, strict TS, UUIDv7 from `newId()`, `clock.now()` only, error shape, no comments, no real names, shared Zod schemas, theme tokens only, MSW with `onUnhandledRequest: 'error'`).
- Phones are stored and compared only in E.164, produced by `shared`'s `phoneSchema` / `telegramPhone`.
- Tokens: `randomToken()`, stored only as `sha256`. Phone codes in URLs are `p_<token>`; the hash covers the part after `p_`.
- Emails and Telegram pushes go out after the transaction commits, through `sendInBackground` / `sendTelegramInBackground`. Never inside a transaction.
- The bot answers Telegram through the webhook response only; pushes are separate `sendMessage` calls from the API.
- Lock order stays `device` row first (D §9).
- Migrations follow D §11: columns added nullable, `text + check` constraints replaced with `not valid` then `validate constraint`. Review the generated SQL.
- User-facing text in `uk`, `en` and `ru` (parity test), no plural suffixes or `count` variable.
- API.md, DATABASE.md and PROJECT_V2.md change in the same task as the behaviour. The OpenAPI snapshot is updated with `npm test -w server -- -u src/http/openapi.snapshot.test.ts` when paths change.
- The user commits. Each task ends with a **Commit point** (files and message), not a `git commit`.

## Review Focus

1. **The same number typed in different formats** (`050 123 45 67`, `+380501234567`, `380501234567`, Telegram's `380501234567`) → one account, login works with any of them, the contact matches. Tests in Tasks 2 and 5.
2. **Someone signs up with another person's number** → they can't confirm it; the real owner's sign-up returns a recovery link, the reset verifies the phone for the owner and revokes the other sessions. Tests in Tasks 5 and 6.
3. **A forwarded contact** (`contact.user_id` missing or ≠ `from.id`) or a phone code opened in a group → `mismatch` / `privateOnly`, nothing changes. Tests in Task 5.
4. **The user blocked the bot** → forgot password still answers `200 { telegram_url }`, the push failure is logged, and the recovery link still works. Tests in Task 6.
5. **A Telegram user bound to account A confirms a phone for account B** → the binding moves to B without a unique violation; A keeps its verified phone. Tests in Task 5.

---

## File structure

```
shared/src/api/common.ts                   + phoneSchema, telegramPhone, identifierSchema; error codes
shared/src/api/{auth,account,sharing}.ts   phone in bodies and objects
shared/src/i18n/locales/{uk,en,ru}.ts      + telegram.auth.*, app.auth.phone.*, app.account.identifiers.*, app.members.phone*
server/src/db/schema/auth.ts               app_user, one_time_token columns; apiToken removed
server/src/db/schema/devices.ts            device_invite.phone
server/drizzle/0003_drop_api_token.sql     generated
server/drizzle/0004_phone_identity.sql     generated, reviewed
server/src/auth/oneTimeTokens.ts           phone purposes, phone and telegram_user_id on tokens
server/src/auth/phone.ts                   phone codes, telegram URLs, binding, confirm and recover
server/src/telegram/{commands,bot}.ts      contact messages, p_ codes, reply markup
server/src/telegram/pushes.ts              renderTelegramAuth, sendTelegramInBackground
server/src/http/telegram/webhook.ts        reply_markup in the response
server/src/http/auth/{middleware,signup,session,password,google}.ts   identifiers
server/src/http/auth/phone.ts              POST /api/auth/phone, POST /api/auth/email
server/src/http/rateLimit.ts               phone key
server/src/sharing/{invites,members}.ts    phone invites, phone members
server/src/http/sharing/sharing.ts         phone invite create, url, push
server/src/http/app.ts, server/src/api.ts, server/src/config.ts   telegram client in the API
server/test/{auth,fakes,app,sharing}.ts    phone users, FakeTelegramClient in testApp
client/src/pages/auth/*                    identifier field, phone sign-up, Telegram screen
client/src/pages/auth/TelegramConfirm.tsx  "Confirm in Telegram" screen/button (new)
client/src/app/VerifyBanner.tsx            phone variant
client/src/pages/account/Identifiers.tsx   email and phone rows, add phone / email (new)
client/src/pages/devices/DeviceMembers.tsx phone invites, copy link
client/src/pages/invite/InvitePage.tsx     phone branches
client/src/api/{endpoints,queries}.ts      new calls
```

Tests sit next to the code. Run one file with `npm test -w server -- <path>`, `npm test -w client -- <path>` or `npm test -w shared -- <path>`.

---

### Task 1: Remove API tokens

**Files:**

- Modify: `server/src/db/schema/auth.ts` (remove `apiToken`), `server/src/db/schema/index.ts`, `shared/src/api/common.ts` (remove `jwt_required`, `insufficient_scope`), `shared/src/i18n/locales/{uk,en,ru}.ts` (their error texts), any test or snapshot that lists them
- Create: `server/drizzle/0003_drop_api_token.sql` via `npm run db:generate -w server`
- Docs: P §2 (scope bullet), §8 (no scripts / API tokens), §9 (API tokens item), §10 (API tokens in the token bullet), §14 (M7 line → "Phone sign-in via Telegram"); A §1 (prefix table "Client app, scripts" → "Client app"; auth-header "Script" row; the scope/`jwt_required` paragraph; the two error rows; the "API token" rate-limit row), A §4 intro "Scope" column → "Auth" (`signed in`), drop the "API tokens (JWT only)" section, "JWT" → "signed in" in tables; D §3 `api_token`; ROADMAP M7 section rewritten (goal "Users sign up and sign in with an email or a phone; phones are confirmed once in the platform Telegram bot", one deliverable per Tasks 1–9, done-when = the Review Focus tests plus the manual checks below), status board row `M7 · Phone sign-in via Telegram · 🟡 · M4 · [M07](plans/M07-phone-auth.md)`

**Interfaces:**

- Produces: `errorCodes` without `jwt_required` and `insufficient_scope`.

- [ ] **Step 1: Test:** `server/src/db/schema.test.ts` gains "has no api_token table" (query `information_schema.tables` after migrations → no row). The shared parity test still passes.
- [ ] **Step 2: Run** `npm test -w server -- src/db/schema.test.ts` → FAIL.
- [ ] **Step 3: Implement:** remove the schema, generate the migration (`DROP TABLE "api_token" CASCADE;` only), remove the codes and texts.
- [ ] **Step 4: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `server/src/db/ server/drizzle/ shared/src/ docs/` — `Remove API tokens`

### Task 2: Phone numbers and the identity columns

**Files:**

- Modify: `shared/package.json` (+ `libphonenumber-js`), `shared/src/api/common.ts`, `server/src/db/schema/auth.ts`, `server/src/db/schema/devices.ts`, `server/src/db/schema.test.ts`, every server file the compiler flags for `email: string | null` (guard email sends with `if (user.email)`; `toMe` passes `null` through), `server/test/auth.ts`
- Create: `shared/src/api/phone.test.ts`, `server/drizzle/0004_phone_identity.sql` (generated, then edited so the replaced `one_time_token_purpose_check` is added `not valid` and validated)
- Docs: D §3 `app_user`, `one_time_token`; D §4 `device_invite`

**Interfaces:**

- Produces (`@elec/shared/api`):
  - `phoneSchema`: `z.string()` → E.164 string; invalid → Zod issue `invalid_phone` at the field path.
  - `normalizePhone(raw: string): string | null`.
  - `telegramPhone(raw: string): string | null` (digits-only input gets `+`, then `normalizePhone`).
  - `withIdentifier<S extends z.ZodRawShape>(shape: S)` → `z.union([z.strictObject({ email: emailSchema, ...shape }), z.strictObject({ phone: phoneSchema, ...shape })])`. Strict, so a body with both `email` and `phone` fails. `identifierSchema = withIdentifier({})`. Later tasks build every auth and invite body with it.
  - `isEmailInput(value: string): boolean` (contains `@`).
- Produces (server):
  - `appUser.phone`, `appUser.phoneVerifiedAt`, `appUser.telegramUserId` (`bigint({ mode: 'bigint' })`); `oneTimeToken.phone`, `oneTimeToken.telegramUserId`; `deviceInvite.phone`.
  - `createUser(db, o: { email?: string | null; phone?: string | null; phoneVerified?: boolean; telegramUserId?: bigint; … })` in `server/test/auth.ts` (email defaults stay as today when neither is given).

- [ ] **Step 1: Tests** in `phone.test.ts`:
  - `normalizePhone` of `050 123 45 67`, `+38 (050) 123-45-67`, `+380501234567` → `+380501234567`; `12`, `abc`, `+3805012345678901` → `null`; `+48 512 345 678` → `+48512345678`.
  - `telegramPhone('380501234567')` and `telegramPhone('+380501234567')` → `+380501234567`.
  - `identifierSchema` accepts `{ email }` and `{ phone }`, rejects `{}`, `{ email, phone }` and an invalid phone (issue code `invalid_phone`).
- [ ] **Step 2: Tests** in `schema.test.ts`:
  - Insert a user with neither email nor phone → check violation `app_user_identifier_check`.
  - Two users with the same `phone` → unique violation; same `telegram_user_id` → unique violation.
  - A phone-only user (email `null`) inserts.
  - An invite with both or neither of `email` / `phone` → check violation; two pending invites for the same `(device_id, phone)` → unique violation; one accepted + one pending → allowed.
  - `one_time_token` accepts `PHONE_VERIFY` and `PHONE_RECOVER`.
- [ ] **Step 3: Run** `npm test -w shared -- src/api/phone.test.ts` and `npm test -w server -- src/db/schema.test.ts` → FAIL.
- [ ] **Step 4: Implement** per decision 1 and 2. Constraint names: `app_user_identifier_check`, `app_user_phone_key`, `app_user_telegram_user_id_key`, `device_invite_one_identifier_check`, `device_invite_pending_phone_key`, `one_time_token_telegram_user_idx`.
- [ ] **Step 5: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 6: Docs** per the Files list.
- [ ] **Commit point:** `shared/ server/src/ server/drizzle/ server/test/ docs/DATABASE.md package-lock.json` — `Add phone identity columns`

### Task 3: "Verified" means email or phone

**Files:**

- Modify: `server/src/http/auth/middleware.ts`, every `requireVerifiedEmail` caller (`devices.ts`, `channels.ts`, `sharing.ts`), `shared/src/api/common.ts` (`email_not_verified` → `not_verified`), `shared/src/api/account.ts`, `server/src/http/account/me.ts`, locales (error text: `Confirm your email or phone first.`), client users of the old code (`client/src/app/VerifyBanner.tsx`, `pages/devices/DevicesPage.tsx`, `pages/notifications/TelegramConnect.tsx`, `pages/invite/InvitePage.tsx` and their tests), `client/test/fixtures.ts`
- Docs: A §1 errors table, A §4 Account (`GET /me` example adds `"phone": null, "phone_verified": false`)

**Interfaces:**

- Produces: `requireVerified: RequestHandler` (403 `not_verified` unless `emailVerifiedAt` or `phoneVerifiedAt`); `isVerified(user: User): boolean`; `meSchema` with `email: string | null`, `phone: string | null`, `phone_verified: boolean`.

- [ ] **Step 1: Tests** in `middleware.test.ts`: unverified → `403 not_verified`; email verified → next; phone-only with `phoneVerifiedAt` → next. In `me.test.ts`: a phone-only verified user's `GET /me` → `email: null, phone: '+380501234567', phone_verified: true, email_verified: false`.
- [ ] **Step 2: Run** `npm test -w server -- src/http/auth/middleware.test.ts src/http/account/me.test.ts` → FAIL.
- [ ] **Step 3: Implement** the rename across server and client; `POST /devices` by a verified phone-only user → `201` (add to `devices.test.ts`).
- [ ] **Step 4: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `shared/src/ server/src/ client/ docs/API.md` — `Treat a verified phone as verified`

### Task 4: Telegram pushes from the API

**Files:**

- Modify: `server/src/config.ts` (API config `telegram` gains `transport` and `botToken`, same env rules as the worker), `server/src/config.test.ts`, `server/src/http/app.ts` (`AppDeps.telegram: TelegramClient`), `server/src/api.ts`, `server/test/app.ts` (`FakeTelegramClient` by default), `server/test/fakes.ts` (`FakeTelegramClient` records `{ chatId, text }` and can be told to return `PERMANENT`), locales (`telegram.auth.*`)
- Create: `server/src/telegram/pushes.ts`, `server/src/telegram/pushes.test.ts`
- Docs: P §12 Config (API needs `TELEGRAM_TRANSPORT`, `TELEGRAM_PLATFORM_BOT_TOKEN`); A §6 ("The API never calls Telegram itself" → only for webhook replies; auth pushes are listed)

**Interfaces:**

- Produces:
  - `type TelegramAuthKind = 'resetLink' | 'signupAttempt' | 'invite'`.
  - `renderTelegramAuth(i18n: i18n, kind: TelegramAuthKind, vars: { lang: Language; link: string; inviter?: string; device?: string }): string`.
  - `sendTelegramInBackground(client: TelegramClient, logger: Logger, chatId: bigint, text: string): void` — logs `telegram push failed` on a non-`SENT` result or a throw.

- [ ] **Step 1: Tests** in `pushes.test.ts`:
  - `resetLink` `en` with link `https://app.test/reset-password?token=abc` → exactly decision 8's text with the link.
  - `invite` `en`, inviter `John`, device `<b>Дім & "Home"` → text contains the device name verbatim (plain text, no escaping).
  - `uk` and `ru` differ from `en`.
  - `sendTelegramInBackground` with a client answering `PERMANENT` → `logger.error` called once, no throw.
- [ ] **Step 2: Tests** in `config.test.ts`: API config with `TELEGRAM_TRANSPORT=telegram` and no token → `ConfigError`; `log` without a token → OK.
- [ ] **Step 3: Run** both files → FAIL.
- [ ] **Step 4: Implement** per decision 5 and 8 (translate `uk`, `ru`).
- [ ] **Step 5: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 6: Docs** per the Files list.
- [ ] **Commit point:** `server/src/ server/test/ shared/src/i18n/ docs/` — `Let the API push Telegram messages`

### Task 5: Confirm a phone in the bot

**Files:**

- Modify: `server/src/auth/oneTimeTokens.ts`, `server/src/telegram/commands.ts` (schema: `message.from.id`, `message.contact { phone_number, user_id? }`), `server/src/telegram/bot.ts` (extract `connectPlatformChat`), `server/src/http/telegram/webhook.ts` (`reply_markup`), `server/src/sharing/invites.ts` (`applyPendingInvites` signature), its callers, locales (`telegram.auth.askContact`, `contactButton`, `privateOnly`, `mismatch`, `numberInUse`, `confirmed`)
- Create: `server/src/auth/phone.ts`, `server/src/telegram/contact.test.ts`
- Docs: A §6 (`/start p_<code>`, contact messages, `reply_markup`), P §7 platform bot (phone confirmation also links the chat)

**Interfaces:**

- Consumes: `telegramPhone`, `createUser({ phone, telegramUserId })`.
- Produces:
  - `OneTimePurpose` adds `PHONE_VERIFY` (86 400 s) and `PHONE_RECOVER` (3 600 s). `issueOneTimeToken(db, clock, userId, purpose, opts?: { phone?: string }): Promise<string>`. `consumeOneTimeToken(...)` returns `{ userId: string; phone: string | null } | null` (callers updated).
  - `phoneCodeUrl(botUsername: string, token: string): string` → `https://t.me/<bot>?start=p_<token>`; `PHONE_CODE_PREFIX = 'p_'`.
  - `claimPhoneCode(db: Executor, clock: Clock, token: string, telegramUserId: bigint): Promise<void>` (no-op for unknown, used or expired).
  - `confirmContact(db: Db, clock: Clock, input: { telegramUserId: bigint; contactUserId: number | undefined; phone: string | null; chat: Chat }): Promise<ContactOutcome>` with `type ContactOutcome = { kind: 'mismatch' } | { kind: 'numberInUse'; userId: string } | { kind: 'confirmed'; userId: string } | { kind: 'recovered'; userId: string; resetToken: string }`.
  - `bindTelegramUser(tx: Tx, userId: string, telegramUserId: bigint): Promise<void>` (clears it from any other account first).
  - `connectPlatformChat(tx: Tx, clock: Clock, userId: string, chat: Chat): Promise<'linked' | 'alreadyLinked'>`.
  - `applyPendingInvites(tx: Tx, clock: Clock, userId: string, identifier: { email: string } | { phone: string }): Promise<string[]>`.
  - `BotReply` gains `replyMarkup?: { keyboard: [[{ text: string; request_contact: true }]]; resize_keyboard: true; one_time_keyboard: true } | { remove_keyboard: true }`; the webhook returns it as `reply_markup`.

- [ ] **Step 1: Tests** in `contact.test.ts` (through the webhook with supertest; private chat `id = from.id = 777`):
  - `/start p_<valid PHONE_VERIFY>` → reply `askContact` with the `request_contact` keyboard; the token row has `telegram_user_id = 777`.
  - `/start p_<unknown>` and `/start p_<expired>` → the same reply body as the valid one.
  - `/start p_<valid>` in a group chat → `privateOnly`; token not claimed.
  - Contact `{ phone_number: '380501234567', user_id: 777 }` after a valid claim for `+380501234567` → `confirmed` with `remove_keyboard`; the user has `phone_verified_at`, `telegram_user_id = 777`; a `TELEGRAM_PLATFORM` channel for chat 777 exists, attached to the user's owned device and a device they view; the token is used.
  - The same contact again → `mismatch` (token used).
  - Contact with `user_id: 999` or without `user_id` → `mismatch`, nothing changed.
  - Contact with another number → `mismatch`.
  - Contact without any claimed code → `mismatch`.
  - `PHONE_VERIFY` carrying a number another account already has → `numberInUse`, nothing changed.
  - Account A has `telegram_user_id = 777`; 777 confirms a phone for account B → B has 777, A has `null` and keeps `phone_verified_at`.
  - A pending phone invite for `+380501234567` is accepted on `confirmed` (viewer row exists).
  - `PHONE_RECOVER` claim + matching contact → reply text contains `https://app.test/reset-password?token=`; the user's `telegram_user_id = 777`; `phone_verified_at` still `null`; one unused `RESET_PASSWORD` token with `phone = '+380501234567'`.
  - Existing `/start <TELEGRAM_LINK code>` tests in `bot.test.ts` still pass.
- [ ] **Step 2: Run** `npm test -w server -- src/telegram` → FAIL.
- [ ] **Step 3: Implement** decision 4 in `server/src/auth/phone.ts` and the bot; keep `link()` using `connectPlatformChat`.
- [ ] **Step 4: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `server/src/ shared/src/i18n/ docs/` — `Confirm phone numbers in the bot`

### Task 6: Auth endpoints with a phone

**Files:**

- Modify: `shared/src/api/auth.ts` (`signupBodySchema`, `loginBodySchema`, `forgotBodySchema` take `identifierSchema`; new `telegramUrlSchema` `{ telegram_url: string }` `.meta({ id: 'TelegramUrl' })`, `addPhoneBodySchema`, `addEmailBodySchema`), `server/src/http/rateLimit.ts` (`phone` rule key from `body.phone` normalized), `server/src/http/auth/signup.ts`, `session.ts`, `password.ts`, `google.ts`, `server/src/http/app.ts` (router)
- Create: `server/src/http/auth/phone.ts` (`phonePaths`, `phoneRouter`), `server/src/http/auth/phone.test.ts`; extend `signup.test.ts`, `session.test.ts`, `password.test.ts`, `google.test.ts`, `rateLimit.test.ts`
- Docs: A §3 table (bodies `email | phone`, the phone answers, the two new endpoints), A §1 Rate limits ("per email" → "per email or phone"), P §3 new "Phone + password" subsection summarising decision 6

**Interfaces:**

- Consumes: Task 5 (`issueOneTimeToken` with `phone`, `phoneCodeUrl`, `applyPendingInvites`, `bindTelegramUser`), Task 4 (`renderTelegramAuth`, `sendTelegramInBackground`).
- Produces: `phoneRouter(deps: AppDeps): Router`, `phonePaths: ZodOpenApiPathsObject`; `rateLimit` `Rules` gains `phone?: RateRule`.

- [ ] **Step 1: Tests** (controlled clock, `FakeTelegramClient`, bot username `TestBot`):
  - Signup `{ phone: '050 123 45 67', … }` → `201 { telegram_url: 'https://t.me/TestBot?start=p_<43>' }`; user stored with `+380501234567`, `phone_verified_at` null, `email` null; no email sent.
  - Signup with an existing phone (verified, `telegram_user_id = 777`) → `201` with a URL of the same shape; no new user; one push to 777 containing `/login`. With no `telegram_user_id` → no push.
  - Signup with both `email` and `phone` → `400`.
  - Login `{ phone: '+380501234567', password }` → `200` session; wrong password → `401 invalid_credentials`; `{ phone: '0501234567' }` finds the same account.
  - Forgot `{ phone }` for an account with `telegram_user_id` → `200 { telegram_url }` and one push with a `/reset-password?token=` link; unknown phone → `200` with the same body shape and no push; `FakeTelegramClient` answering `PERMANENT` → still `200`, error logged.
  - Reset with a token from the push → `204`, `phone_verified_at` set, all sessions revoked. A reset token without a phone on a phone account leaves `phone_verified_at` unchanged.
  - **Pre-registration:** user X signs up with Y's number and password `pw-x`. Y signs up with the same number → recovery URL; Y's Telegram (contact for that number) gets a reset link; Y resets to `pw-y` → login with `pw-x` → `401`, X's session refresh → `401`, `phone_verified_at` set.
  - `POST /api/auth/phone` `{ phone }` → `200 { telegram_url }`; the token carries the number and the user row is unchanged. Another account's number → `409` with detail `phone` / `already_in_use`. Own verified number → `409`.
  - `POST /api/auth/email` on a phone-only account → `204`, `email` set unverified, one verification email. Taken email → `204`, email unchanged on the caller, one "account exists" email to the other account. Account that already has an email → `409`.
  - Google `LINK` on a phone-only account → `email` set from Google, `email_verified_at` set. Google email belonging to another account → redirect with `google_account_in_use`.
  - Rate limits: the 4th signup or forgot for one phone in an hour → `429` (rule `EMAIL_SEND` keyed by phone), formatted variants count as the same phone.
- [ ] **Step 2: Run** `npm test -w server -- src/http/auth src/http/rateLimit.test.ts` → FAIL.
- [ ] **Step 3: Implement** decision 6.
- [ ] **Step 4: Run** `npm run typecheck && npm test`, then update the OpenAPI snapshot → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `shared/src/api/ server/src/ docs/` — `Sign up and log in with a phone`

### Task 7: Share devices by phone

**Files:**

- Modify: `shared/src/api/sharing.ts` (`createInviteBodySchema = identifierSchema`; `inviteSchema` `email: string | null`, `phone: string | null`, optional `url`; `invitePreviewSchema` same; `memberSchema` + `phone`), `server/src/sharing/invites.ts` (`isMember`, `memberSlotsUsed`, `createInvite`, `acceptInvite` by identifier), `server/src/sharing/members.ts`, `server/src/http/sharing/sharing.ts` (push and `url`), `server/test/sharing.ts` (`seedInvite` takes `email` or `phone`)
- Extend: `server/src/http/sharing/invites.test.ts`, `accept.test.ts`, `members.test.ts`, `server/src/sharing/sharing.pg.test.ts`
- Docs: A §4 Sharing (phone bodies, `url`, accept rules), P §6

**Interfaces:**

- Consumes: `applyPendingInvites(tx, clock, userId, identifier)`, `renderTelegramAuth('invite')`, `sendTelegramInBackground`.
- Produces: `createInvite(tx, clock, input: { deviceId: string; invitedBy: string } & ({ email: string } | { phone: string }))`; `acceptInvite(tx, clock, token, user: User)`.

- [ ] **Step 1: Tests:**
  - Create `{ phone: '050 123 45 67' }` → `201` with `phone: '+380501234567'`, `email: null`, `url: 'https://app.test/invite?token=<43>'`; no email sent.
  - The number belongs to an account with `telegram_user_id = 777` → one push to 777 containing the same URL; without a binding → no push; the response body has the same keys in both cases.
  - The owner's phone or a viewer's phone → `409` with detail `phone` / `already_member`. The member limit counts phone invites (9 viewers + 1 pending phone invite → a new email gets `409`).
  - Re-inviting the same phone upserts one pending row; the first token's preview → `410`.
  - Preview of a phone invite → `{ phone: '+380501234567', email: null, … }`.
  - Accept: caller with the same verified phone → `200`, viewer row; same phone unverified → `403 not_verified`, no viewer row; other phone or email-only caller → `403 forbidden`. The caller's `phone_verified_at` is unchanged in every case.
  - Members: a phone-only viewer shows `phone` to the owner and to themselves, `null` to other viewers.
  - `sharing.pg.test.ts`: a phone confirmation and an accept for the same invite at once → one viewer row.
- [ ] **Step 2: Run** `npm test -w server -- src/http/sharing src/sharing` → FAIL.
- [ ] **Step 3: Implement** decision 7.
- [ ] **Step 4: Run** `npm run typecheck && npm test`, update the OpenAPI snapshot → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `shared/src/api/ server/src/ server/test/ docs/` — `Share devices by phone`

### Task 8: Client sign-up, log in and reset with a phone

**Files:**

- Create: `client/src/pages/auth/TelegramConfirm.tsx` (title, hint and an "Open Telegram" button linking `telegram_url` with `target="_blank" rel="noreferrer"`), `client/src/pages/auth/IdentifierField.tsx` (one input; `toIdentifier(value): { email } | { phone }` via `isEmailInput`)
- Modify: `client/src/api/endpoints.ts`, `client/src/api/queries.ts`, `SignupPage.tsx` (Email / Phone switch, `?phone=` prefill), `LoginPage.tsx` (`IdentifierField`, `?phone=` prefill), `ForgotPasswordPage.tsx`, `client/src/app/VerifyBanner.tsx` (phone variant calls `POST /api/auth/phone` with `me.phone` and opens the URL), `client/test/fixtures.ts`, `client/test/server.ts` handlers, locales (`app.auth.phone.*`)
- Tests: `SignupPage.test.tsx`, `LoginPage.test.tsx`, `PasswordPages.test.tsx`, `VerifyBanner.test.tsx`

**Interfaces:**

- Consumes: Task 6 endpoints and `telegramUrlSchema`.
- Produces: `<TelegramConfirm url={string} title={string} hint={string} />`, `<IdentifierField name="identifier" />`, `toIdentifier(value: string)`.

- [ ] **Step 1: Tests:**
  - Sign up with Phone, `050 123 45 67` → the request body has `phone: '050 123 45 67'` (the server normalizes) and no `email`; the page shows "Confirm in Telegram" with a link to the returned `telegram_url`.
  - Invalid phone → the server's `400` detail `invalid_phone` shows "Enter a valid phone number" under the field.
  - Log in with `+380501234567` → body `{ phone, password }`; with `john@example.com` → `{ email, password }`.
  - Forgot with a phone → the "We sent a link to Telegram…" screen with the button; with an email → today's screen.
  - Verify banner for `me.email = null, me.phone_verified = false` → "Confirm your number in Telegram"; clicking calls `POST /api/auth/phone` and opens the returned URL (`window.open` spy).
- [ ] **Step 2: Run** `npm test -w client -- src/pages/auth src/app/VerifyBanner.test.tsx` → FAIL.
- [ ] **Step 3: Implement** decision 9 (auth parts); texts in `uk`, `en`, `ru`.
- [ ] **Step 4: Run** `npm run typecheck && npm test -w client` → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add phone sign-in to the client`

### Task 9: Client account and sharing with a phone

**Files:**

- Create: `client/src/pages/account/Identifiers.tsx` (rows for email and phone: value + "Confirmed" / "Not confirmed"; "Add phone" opens a small form → `POST /api/auth/phone` → `TelegramConfirm`; "Add email" → `POST /api/auth/email` → "Check your inbox" note), `client/src/pages/account/Identifiers.test.tsx`
- Modify: `AccountPage.tsx` (place `Identifiers` above `SignInMethods`), `DeviceMembers.tsx` (invite input uses `IdentifierField`; after a phone invite, a read-only field with the URL and a **Copy** button; pending invites and members show `phone` when `email` is null), `InvitePage.tsx` (phone invite: sign-up/log-in links use `?phone=`; signed in with the same unverified phone → `TelegramConfirm` via `POST /api/auth/phone`), their tests, locales (`app.account.identifiers.*`, `app.members.phoneInvite*`, `app.invite.phone*`)

**Interfaces:**

- Consumes: Task 8 `TelegramConfirm`, `IdentifierField`; Task 7 `Invite.url`.

- [ ] **Step 1: Tests:**
  - Account for a phone-only user → phone row "Confirmed", email row with **Add email**; submitting `john@example.com` → `POST /api/auth/email` and the inbox note.
  - Account for an email-only user → **Add phone** → `TelegramConfirm` with the returned URL; a `409 already_in_use` → "This number is used by another account".
  - DeviceMembers: inviting `+380501234567` shows the returned `url` with Copy (clipboard spy gets the URL); inviting an email shows no link.
  - InvitePage for a phone invite, signed out → links to `/signup?phone=%2B380501234567&invite=1` and `/login?phone=…&next=…`; signed in with the same unverified phone → "Confirm in Telegram"; with the same verified phone → **Accept**.
- [ ] **Step 2: Run** `npm test -w client -- src/pages/account src/pages/devices/DeviceMembers.test.tsx src/pages/invite` → FAIL.
- [ ] **Step 3: Implement** decision 9 (account and sharing parts).
- [ ] **Step 4: Run** `npm run typecheck && npm test -w client` → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add phone to account and sharing UI`

### Task 10: OpenAPI coverage, docs and roadmap

**Files:**

- Modify: `server/src/http/openapi.test.ts`, `docs/ROADMAP.md`, `docs/PROJECT_V2.md` §12 (API service env), `docs/API.md` §7

- [ ] **Step 1: OpenAPI test:** the document has `post /api/auth/phone` and `post /api/auth/email` (`bearerAuth`); `components.schemas` has `TelegramUrl`; no path or schema mentions `token`-scoped security or `api_token`; `Me`, `Invite`, `InvitePreview`, `Member` have `phone`.
- [ ] **Step 2: Full check:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` all exit 0.
- [ ] **Step 3: Roadmap:**
  - Decisions table: new ✅ row "Q16 Phone identifiers; API tokens removed — M7" (decision recorded in P §3, A §3, D §3).
  - Tick merged deliverables; status 🟡 until the manual checks pass, then ✅.
- [ ] **Commit point:** `server/src/http/openapi.test.ts docs/` — `Complete M7 docs and OpenAPI coverage`

---

## Manual checks (staging)

Before deploying: add `TELEGRAM_TRANSPORT=telegram` and `TELEGRAM_PLATFORM_BOT_TOKEN` to the API service env on EC2 (the worker already has them), then run migrations.

Verify by hand:

1. Sign up with a phone, tap "Open Telegram", share the number → "Your number is confirmed"; the Account page shows the phone as confirmed and Notifications lists the Telegram chat.
2. Log out, log in with the phone typed as `050…` and as `+380…`.
3. Forgot password with the phone → the reset link arrives in Telegram without opening the bot; reset and log in.
4. Block the bot in Telegram, request a reset again → the page still offers "Open the bot"; unblock, share the number, get the link.
5. From an email account, invite the phone account to a device → the invite arrives in Telegram and the owner sees the copy link; accept it.
6. Add an email to the phone account and verify it; log in with either.
