# M8 — Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** users add signed webhooks as notification channels. The webhooks get the same outage events as Telegram, with retries, an SSRF guard, a delivery log and redelivery.

**Architecture:** a new `server/src/webhooks/` module holds the SSRF guard (`net.BlockList`, no dependency), HMAC signing and an HTTPS sender. The sender resolves DNS itself, checks every address and connects only to the address it checked, so DNS rebinding can't bypass the guard. The channels router gains webhook create, edit, rotate-secret, test, the delivery log and redeliver. The worker's `decide()` sends to webhooks by channel type. Webhooks skip the Telegram pacer and quiet hours. Every failed attempt counts toward the 20 that disable a channel, and disabling a channel emails its owner. The client turns on the Webhook entry in the Add channel menu. Webhook rows can be edited, rotate their secret and show the delivery log.

**Tech Stack:** unchanged (server: Node 26, Express 5, Drizzle, Zod, zod-openapi, i18next, Vitest + PGlite + supertest; client: React 19, TanStack Query 5, React Hook Form, `components/ui`, Vitest + Testing Library + MSW). No new dependencies: `node:https`, `node:dns/promises`, `node:net` `BlockList`, `node:crypto`.

**Spec:** [ROADMAP.md § M8](../ROADMAP.md#m8--webhooks) · [PROJECT_V2.md](../PROJECT_V2.md) §7 Webhooks, §9 Notifications, §10, §12 Config · [API.md](../API.md) §1 Rate limits, §4 Notification channels, §8 · [DATABASE.md](../DATABASE.md) §1 Secrets, §7 `notification_channel`, `delivery`.

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints)–[M6](M06-sharing.md#global-constraints) constraints still applies (ESM, strict TS, `newId()`, `clock.now()` only, error shape, no comments, no real names, shared Zod schemas, theme and motion tokens, `components/ui` only, MSW `onUnhandledRequest: 'error'`).
- **No migration in M8.** The `webhook_*` columns, their checks and `delivery` exist since M0. If a task seems to need one, stop and ask.
- Secrets: `encrypt(config.encryptionKey, secret)` into `webhook_secret_enc` (AES-256-GCM, `nonce || ciphertext || tag`). The plaintext appears only in the `201` / rotate response. It is never logged and never put in `last_error`.
- No real outbound HTTP in tests. Sender tests use an in-process `http` server on `127.0.0.1` with an injected `request` and an injected address check. All other tests use `FakeWebhookSender`.
- Time comes only from `clock.now()`. Retry tests use `FakeClock`.
- Access: another user's channel or delivery → `404 not_found`. Webhook endpoints are JWT + verified (`requireUser`, `requireVerified`), like the existing channel routes.
- Every endpoint change goes into the OpenAPI document under the `Notifications` tag and into API.md in the same task. Run `npm run test -w server -- -u` only for the OpenAPI snapshot, and review the diff.
- User-facing text: `app.*` and `email.*` keys in `uk`, `en` and `ru` (parity test). Webhook headers, field names and event names are never translated (P §7).
- New env keys go into `server/.env.example`, `deploy/staging.env.example` and P §12 in the same task (CLAUDE.md).

## Decisions made in this plan

Each task records its decisions in the spec. Task 7 marks them in the ROADMAP.

1. **Failure counting (decided with the user).** Every failed webhook attempt adds 1 to `consecutive_failures`. That covers non-2xx, a redirect, a timeout, a network error and a blocked address. Any `2xx` resets the count to 0. The update that reaches 20 sets `enabled = false, disabled_reason = 'TOO_MANY_FAILURES'` and emails the owner once. The retry schedule stays the same: 1 min, 5 min, 30 min, 2 h, 6 h, then `FAILED`.
2. **`sent_at` per attempt (decided with the user).** The body is `{ ...delivery.payload, sent_at: <attempt time> }`. It is serialized once per attempt and signed. Event data stays the same across retries. Receivers deduplicate by `X-Elec-Delivery` and can reject stale `sent_at`. D §7 "resend the same body" becomes "resend the same event data".
3. **Request.** `POST` with headers `Content-Type: application/json`, `User-Agent: ElecMonitor-Webhook/1`, `X-Elec-Event`, `X-Elec-Delivery: <delivery.id>` and `X-Elec-Signature: sha256=<lowercase hex HMAC-SHA256(secret, raw body)>`. Success means any `2xx` within **10 s** (the whole request, including connect). The sender reads at most 1 KiB of the response and discards it.
4. **Redirects are not followed.** A `3xx` is a failure with `last_error = 'HTTP 302: redirect not followed'`.
5. **SSRF guard.** A URL is allowed only when every check passes:
   - The scheme is `https:`. There are no credentials (`user:pass@`). The URL is at most 2048 chars. Any port is allowed.
   - The host is an IP literal or resolves with `dns.lookup(host, { all: true, verbatim: true })`. **Every** resolved address must be public.
   - Blocked IPv4: `0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4`.
   - IPv6 is allowed only inside `2000::/3`. Blocked even there: `2001::/32` (Teredo), `2001:db8::/32`, `2002::/16` (6to4). `::ffff:a.b.c.d` and `64:ff9b::a.b.c.d` are judged by their embedded IPv4.
   - The check runs at create, at URL edit, at test and **at every send**. At send time the guarded `lookup` passed to `https.request` returns only the addresses it checked, so the socket connects to a checked IP. A blocked address or a DNS failure at create or edit → `400 url_not_allowed`. At send time it is a counted failure (`last_error = 'address not allowed'` or `'DNS lookup failed'`).
6. **Create** `POST /channels` strict `{ type: 'WEBHOOK', name (1–64, trimmed), url, events (1–3, unique, from deliveryEvents) }` → `201 { ...Channel, secret }`. The secret is `whsec_` + `randomToken()`. The new channel is attached to no devices. The client goes on to the device picker. There are at most **10 webhooks per user**; the 11th → `409 conflict` "Webhook limit reached".
7. **Channel `config`** becomes a union by `type`: `{ chat_id }` for `TELEGRAM_PLATFORM` and `{ url, events }` for `WEBHOOK`. `Channel` gains `failures: number` (`consecutive_failures`), so the row can show "3 failures in a row".
8. **Edit** `PATCH /channels/:id` also takes `url` and `events`. On a Telegram channel they → `400 validation_error` with detail `{ path: 'url' | 'events', code: 'not_allowed' }`. A changed URL runs the SSRF check. Editing doesn't re-enable the channel or reset the failure count.
9. **Rotate** `POST /channels/:id/rotate-secret` (webhook only, else `409 conflict`) → `200 { ...Channel, secret }`. The old secret stops working at once, with no grace period. Already queued retries are signed with the new secret. Remove **(proposed)** from API.md.
10. **Test** `POST /channels/:id/test` on a webhook sends right away from the API: `X-Elec-Event: ping`, body `{ "event": "ping", "channel": { "id", "name" }, "sent_at" }`, a fresh `X-Elec-Delivery`, not stored. Success re-enables a `TOO_MANY_FAILURES` channel and resets the count, like Telegram. A failure → `409 conflict` with message `The receiver did not accept the request (<error>)`. The existing 5 / min limit applies.
11. **Worker rules for webhooks.** No pacer token and no quiet hours. `skipped: no access` and `skipped: channel disabled` apply as before. `skipped: outage closed` applies **only to Telegram**: a webhook still gets `device.offline` with its snapshot, because machines order events by the data. Every webhook failure is retried on the schedule. There is no `PERMANENT` path for webhooks.
12. **Delivery log** `GET /channels/:id/deliveries?limit&cursor` works for any channel type (A §4 shape plus `device_id` from the outage). Order is `created_at desc, id desc` on index `delivery_channel_created_idx`. `limit` defaults to 20, max 100. The cursor is `encodeCursor([created_at, id])`.
13. **Redeliver** `POST /deliveries/:id/redeliver` → `202` with the delivery item. The caller must own the delivery's channel, else `404`. The channel must be a webhook (else `409`) and enabled (else `409` "Turn the channel on first"). The delivery status must be `SENT` or `FAILED`; `QUEUED` or `RETRYING` → `409`. The update sets `status = 'QUEUED', attempts = 0, next_attempt_at = now, last_error = null, sent_at = null` on the same row and keeps the same ID. Rate limit `REDELIVER_PER_USER` = 30 / min per user.
14. **"Webhook disabled" email.** Sent by the worker in the owner's language through `renderEmail(i18n, 'webhookDisabled', { lang, name, link, channelName })`, with the link `${CLIENT_URL}/notifications?type=WEBHOOK`. It goes out after the update commits.
15. **Config.** `ENCRYPTION_KEY` (base64, decodes to exactly 32 bytes) is required by the API and the worker. The worker also gains `CLIENT_URL` and the email keys (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`), validated with the API's existing schemas.

## Review Focus

1. **A hostname that resolves to a public and a private address** (`A` records for `1.2.3.4` and `10.0.0.1`) must be rejected, not connected to the first address. Pinned in Task 2.
2. **DNS changes between create and send** (rebinding to `127.0.0.1`) must fail the send as `address not allowed` without opening a socket to it. Pinned in Task 3.
3. **A receiver that hangs after the headers** (slow body) must still stop at 10 s total, not 10 s idle. Pinned in Task 3.
4. **Rotating the secret while a retry is queued** signs that retry with the new secret. Pinned in Task 5.
5. **A channel at 19 failures with two failing deliveries in one batch** ends disabled and sends exactly one email. Only the update that flips `enabled` sends it. Pinned in Task 5.

---

### Task 1: Config — encryption key and worker email

**Files:**

- Modify: `server/src/config.ts`, `server/src/config.test.ts`, `server/test/app.ts` (`testConfig.encryptionKey`), `server/.env.example`, `deploy/staging.env.example`, `docs/PROJECT_V2.md` §12 (the line "The worker and `db:migrate` need only `DATABASE_URL`" becomes accurate)

**Interfaces:**

- Produces: `Config.encryptionKey: Buffer`. `WorkerConfig = { databaseUrl; telegram; encryptionKey: Buffer; urls: { client: string }; email: EmailConfig }`.

- [ ] **Step 1: Failing tests in `config.test.ts`:** `ENCRYPTION_KEY` missing → `ConfigError` for both `loadConfig` and `loadWorkerConfig`. A key that decodes to 31 bytes → error. A valid key → `encryptionKey.length === 32`. Worker with `EMAIL_TRANSPORT=resend` and no `RESEND_API_KEY` → error. Worker without `CLIENT_URL` → error.
- [ ] **Step 2:** Run `npm run test -w server -- config` → FAIL.
- [ ] **Step 3:** Add `encryptionKeySchema` (base64 string → `Buffer`, refine length 32). Reuse the existing email and URL shapes in `workerEnvSchema`. Local value in `.env.example`: the output of `openssl rand -base64 32`, committed (local only). Placeholder in staging: `ENCRYPTION_KEY="<openssl rand -base64 32>"`.
- [ ] **Step 4:** Run `npm run test -w server` → PASS. Also run `npm run typecheck`.
- [ ] **Commit point:** `Add encryption key and worker email config`

### Task 2: SSRF guard

**Files:**

- Create: `server/src/webhooks/ssrf.ts`, `server/src/webhooks/ssrf.test.ts`

**Interfaces:**

- Produces:

  ```ts
  type LookupAll = (host: string) => Promise<{ address: string; family: 4 | 6 }[]>;
  isPublicAddress(ip: string): boolean;
  checkWebhookUrl(url: string, lookup?: LookupAll): Promise<
    | { ok: true; url: URL; addresses: { address: string; family: 4 | 6 }[] }
    | { ok: false; reason: 'scheme' | 'credentials' | 'too_long' | 'invalid' | 'dns' | 'address' }
  >;
  ```

  The default `lookup` is `dns.lookup(host, { all: true, verbatim: true })`.

- [ ] **Step 1: Failing tests** (table-driven `test.each`):
  - `isPublicAddress` false for one address inside each blocked range in decision 5: `127.0.0.1`, `10.1.2.3`, `172.31.255.255`, `192.168.0.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `224.0.0.1`, `255.255.255.255`, `::`, `::1`, `fe80::1`, `fc00::1`, `fd12::1`, `ff02::1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `64:ff9b::a00:1`, `2001:db8::1`, `2002::1`, `2001::1`.
  - True for `1.1.1.1`, `172.32.0.1`, `100.128.0.1`, `2606:4700:4700::1111`, `::ffff:8.8.8.8`.
  - `checkWebhookUrl`: `http://example.com` → `scheme`. `https://u:p@example.com` → `credentials`. `https://[::1]/` → `address` with no lookup call. A lookup returning `[1.2.3.4, 10.0.0.1]` → `address` (Review Focus 1). A lookup that throws → `dns`. `https://example.com:8123/hook` with a public lookup → `ok`.
- [ ] **Step 2:** Run `npm run test -w server -- ssrf` → FAIL.
- [ ] **Step 3:** Implement with two `net.BlockList`s. Normalize IPv4-mapped and NAT64 addresses to their IPv4 first. An IPv6 address is public only if it is in `2000::/3` and not in the IPv6 blocklist.
- [ ] **Step 4:** Run → PASS.
- [ ] **Commit point:** `Add webhook SSRF guard`

### Task 3: Signing and the HTTPS sender

**Files:**

- Create: `server/src/webhooks/sender.ts`, `server/src/webhooks/sender.test.ts`
- Modify: `server/test/fakes.ts` (add `FakeWebhookSender`)

**Interfaces:**

- Consumes: `checkWebhookUrl`, `isPublicAddress` (Task 2).
- Produces:

  ```ts
  signBody(secret: string, body: string): string; // 'sha256=<hex>'
  type WebhookRequest = { url: string; secret: string; event: string; deliveryId: string; body: string };
  type WebhookResult = { type: 'SENT'; status: number } | { type: 'FAILED'; error: string };
  interface WebhookSender {
    send(req: WebhookRequest): Promise<WebhookResult>;
    check(url: string): ReturnType<typeof checkWebhookUrl>; // same lookup and isAllowed as send
  }
  createWebhookSender(opts?: { lookup?: LookupAll; request?: typeof https.request; isAllowed?: (ip: string) => boolean; timeoutMs?: number }): WebhookSender;
  class FakeWebhookSender implements WebhookSender { sent: WebhookRequest[]; next: WebhookResult[]; blockedHosts: Set<string> } // send shifts `next` (default SENT 200); check runs the real URL rules and fails hosts in blockedHosts with 'address'
  ```

- [ ] **Step 1: Signature test vector:**
  ```ts
  const body =
    '{"event":"device.offline","device":{"id":"0190a000-0000-7000-8000-000000000001","name":"Home"},"outage":{"id":"0190a000-0000-7000-8000-000000000002","type":"OUTAGE","started_at":"2026-11-21T16:42:00.000Z","ended_at":null,"duration_s":null,"cause":null,"kind":null,"ota_attempt_id":null},"sent_at":"2026-11-21T16:42:05.000Z"}';
  expect(signBody('whsec_test_secret', body)).toBe(
    'sha256=41fb456c5318b16f0baa3c41640285a49ce87998d07c8aa1c696762012939f71',
  );
  ```
- [ ] **Step 2: Sender tests** against an in-process `http.createServer` on `127.0.0.1`, with `request: http.request` and `isAllowed: () => true` unless stated:
  - It sends the four `X-Elec-*` and `Content-Type` headers. The signature matches `signBody` of the received raw body.
  - `204` → `SENT`. `500` → `FAILED 'HTTP 500'`. `302` with `Location` → `FAILED 'HTTP 302: redirect not followed'`, and the server sees one request.
  - A server that sends headers and then stalls the body → `FAILED` with `timeout`, measured with `timeoutMs: 200` (Review Focus 3).
  - Connection refused → `FAILED` whose error starts with `network:`.
  - Default `isAllowed` with a lookup returning `127.0.0.1` → `FAILED 'address not allowed'` and the server sees **no** connection (Review Focus 2).
  - The error never contains the secret.
- [ ] **Step 3:** Run `npm run test -w server -- webhooks` → FAIL.
- [ ] **Step 4:** Implement `send` as follows. Run `checkWebhookUrl`. Pass `lookup` to `request` as a function that returns only the checked addresses. Set `servername` to the URL host so TLS SNI and certificate checks use the hostname. Use one `AbortSignal.timeout(timeoutMs ?? 10_000)` for the whole request. Read and discard up to 1 KiB. Cut errors to 300 chars.
- [ ] **Step 5:** Run → PASS.
- [ ] **Commit point:** `Add signed webhook sender`

### Task 4: Webhook channel API

**Files:**

- Modify: `shared/src/api/channels.ts`, `server/src/channels/views.ts`, `server/src/http/channels/channels.ts`, `server/src/http/channels/channels.test.ts`, `server/src/http/app.ts` (`AppDeps.webhooks: WebhookSender`), `server/src/api.ts` (wire `createWebhookSender()`), `server/test/app.ts`, `server/test/channels.ts` (seed a webhook channel), OpenAPI snapshot
- Docs: `docs/API.md` §4 Notification channels (decisions 6–10), §8 (request headers, `ping`, `sent_at` per attempt), §9 (rotate row ✅, webhook `"id": 123` inconsistency resolved); `docs/PROJECT_V2.md` §7 Webhooks (decisions 2–5, 10; outage `id` is a UUID string)

**Interfaces:**

- Consumes: `checkWebhookUrl`, `WebhookSender`, `signBody` (Tasks 2–3), `Config.encryptionKey` (Task 1).
- Produces (shared):
  ```ts
  webhookConfigSchema = z.object({ url: z.string(), events: z.array(z.enum(deliveryEvents)) });
  channelSchema.config: z.union([z.object({ chat_id }), webhookConfigSchema]); channelSchema.failures: z.number().int();
  createWebhookSchema = z.strictObject({ type: z.literal('WEBHOOK'), name, url: z.string().max(2048), events: z.array(z.enum(deliveryEvents)).min(1).max(3) }); // events unique via refine
  channelPatchSchema: + url?, events?
  channelWithSecretSchema = channelSchema.extend({ secret: z.string() });
  MAX_WEBHOOKS = 10;
  ```
- Produces (server): `toChannel(row, deviceIds)` returns the webhook config. `webhookSecret(config, row): string` decrypts the secret.

- [ ] **Step 1: Failing tests in `channels.test.ts`:**
  - Create → `201`. `secret` matches `/^whsec_[A-Za-z0-9_-]{43}$/`. `GET /channels` has no `secret`. The DB holds `webhook_secret_enc`, and `decrypt` gives back the returned secret.
  - Create with `http://`, a private IP literal, or a host whose stubbed lookup is private → `400 url_not_allowed`. Duplicate events → `400`. The 11th webhook → `409`.
  - `PATCH` with `url` and `events` → updated config. A private URL → `400 url_not_allowed`. `url` on a Telegram channel → `400` with detail `{ path: 'url', code: 'not_allowed' }`.
  - Rotate → a new secret that differs from the old one, and the stored ciphertext changes. Rotate on Telegram → `409`.
  - Test on a webhook: `FakeWebhookSender` gets `event: 'ping'`, and its signature verifies with the stored secret. A failed test → `409`. A `TOO_MANY_FAILURES` channel turns back on after a successful test and `failures` becomes `0`.
  - Access: another user's webhook → `404` for `PATCH`, rotate and test.
- [ ] **Step 2:** Run `npm run test -w server -- channels` → FAIL.
- [ ] **Step 3:** Implement the routes from decisions 6–10. Routes call `deps.webhooks.check(url)` and never call `checkWebhookUrl` directly. `testApp` uses `FakeWebhookSender`, so a private host is simulated with `blockedHosts`. Add the new error code `url_not_allowed` to the error code list (A §1 Errors).
- [ ] **Step 4:** Run the server tests and update the OpenAPI snapshot → PASS. Then run `npm run typecheck`.
- [ ] **Commit point:** `Add webhook channel create, edit and rotate`

### Task 5: Worker delivery to webhooks

**Files:**

- Modify: `server/src/notifications/deliveries.ts` (claim selects `webhookUrl`, `webhookSecretEnc`, the channel owner's email, name and language; new outcome), `server/src/notifications/deliveryLoop.ts`, `server/src/notifications/deliveryLoop.test.ts`, `server/src/notifications/deliveries.test.ts`, `server/src/email/templates.ts` (+ test), `server/src/worker.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts` (`email.webhookDisabled.*`), `server/test/deliveries.ts` (seed a webhook delivery)
- Docs: `docs/DATABASE.md` §7 `delivery` (decisions 1, 2 and 11, plus webhook outcomes next to "Platform bot outcomes"), `docs/PROJECT_V2.md` §7 (failure counting)

**Interfaces:**

- Consumes: `WebhookSender` (Task 3), `decrypt`, `WorkerConfig` (Task 1), `EmailSender`, `sendInBackground`.
- Produces:

  ```ts
  ClaimedDelivery.channel += { webhookUrl: string | null; webhookSecretEnc: Buffer | null };
  ClaimedDelivery.owner = { email: string | null; name: string; language: Language };
  type Outcome = ... | { type: 'WEBHOOK_FAILED'; error: string };
  recordOutcome(...): Promise<{ disabled: boolean }>; // true only for the update that flipped enabled → false
  DeliveryDeps += { webhooks: WebhookSender; encryptionKey: Buffer; email: EmailSender; clientUrl: string };
  ```

- [ ] **Step 1: Failing tests** (`FakeClock`, `FakeWebhookSender`, `FakeEmailSender`):
  - A webhook `device.offline` delivery → one send with `X-Elec-Delivery = delivery.id`. The body is the payload plus `sent_at = clock.now()`. The signature verifies with the decrypted secret. The pacer is never called.
  - Retry schedule: the receiver fails every time, and the clock advances by exactly 60, 300, 1800, 7200 and 21 600 s between runs. After 6 attempts → `FAILED`. Each retry has the same `X-Elec-Delivery`, and each `sent_at` equals the attempt time.
  - Each failure adds 1 to `consecutive_failures`, and a `SENT` resets it to 0.
  - Disabling on the 20th: seed `consecutive_failures = 19`, then fail one attempt. The channel ends `enabled = false, disabled_reason = 'TOO_MANY_FAILURES'`. Exactly one email in the owner's language holds the link `<client>/notifications?type=WEBHOOK`. Then seed two due deliveries for a channel at 19 in one batch → still one email (Review Focus 5).
  - Rotate between attempts (update `webhook_secret_enc`) → the retry verifies only with the new secret (Review Focus 4).
  - A closed outage's `device.offline` still goes to a webhook, but stays `skipped: outage closed` for Telegram. A quiet-hours window has no effect on webhooks.
  - An owner with a phone and no email: the channel is disabled and no email is sent.
- [ ] **Step 2:** Run `npm run test -w server -- notifications` → FAIL.
- [ ] **Step 3:** Implement. In `decide()`, branch on `channel.type`. For `WEBHOOK_FAILED`, `recordOutcome` uses `nextRetryAt` and then `failChannel`. `failChannel` returns whether its guarded update (`enabled = true` in `where`) changed a row. Send the email from `handle()` after `recordOutcome` returns `disabled: true`. Add the `webhookDisabled` email kind: no expiry note, action "Open notifications", and the intro names the webhook. Wire `createWebhookSender()`, `createEmailSender` and the key in `worker.ts`.
- [ ] **Step 4:** Run the server tests → PASS. Also run the i18n parity test.
- [ ] **Commit point:** `Deliver webhooks with retries and disabling`

### Task 6: Delivery log and redeliver API

**Files:**

- Create: `shared/src/api/deliveries.ts` (exported from `@elec/shared/api`), `server/src/http/channels/deliveries.ts`, `server/src/http/channels/deliveries.test.ts`
- Modify: `server/src/http/app.ts` (mount the router), `server/src/rateLimit/limiter.ts` (`REDELIVER_PER_USER = { limit: 30, windowS: 60 }`), OpenAPI snapshot
- Docs: `docs/API.md` §1 Rate limits (Redeliver 30 / min per user), §4 deliveries (decisions 12–13)

**Interfaces:**

- Produces:

  ```ts
  deliveryItemSchema = z.object({ id, event: z.enum(deliveryEvents), device_id: z.uuid(), status: z.enum(deliveryStatuses), attempts: z.number().int(), last_attempt_at: isoDate.nullable(), last_error: z.string().nullable(), created_at: isoDate }).meta({ id: 'Delivery' });
  deliveryListSchema = z.object({ items: z.array(deliveryItemSchema), next_cursor: z.string().nullable() });
  deliveriesRouter(deps: AppDeps): Router;
  ```

- [ ] **Step 1: Failing tests:**
  - Seed 25 deliveries → page 1 has 20 newest first plus a `next_cursor`, and page 2 has 5 with `next_cursor: null`. Rows with an equal `created_at` are ordered by `id desc`, with no duplicates or gaps across pages. `limit=101` → `400`. A bad cursor → `400 invalid_cursor`.
  - Redeliver a `FAILED` row → `202`. The same row (same ID, row count unchanged) has `QUEUED`, `attempts 0` and `next_attempt_at = now`. Then `processDueDeliveries` sends it with the **same** `X-Elec-Delivery`.
  - `RETRYING` → `409`. Telegram channel → `409`. Disabled channel → `409`.
  - Access: stranger → `404` on both endpoints. A device viewer who doesn't own the channel → `404`. The owner of the device (not of the channel) → `404`.
  - The 31st redeliver in a minute → `429` with `Retry-After`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keyset on `(created_at, id) < (cursor)`. Get `device_id` by joining `outage`. Redeliver uses one `update … where id = ? and status in ('SENT','FAILED') returning`, so a concurrent claim can't be overwritten.
- [ ] **Step 4:** Run the server tests and update the snapshot → PASS.
- [ ] **Commit point:** `Add delivery log and redeliver`

### Task 7: Client — webhooks on the Notifications page

**Files:**

- Create: `client/src/pages/notifications/WebhookForm.tsx` (create and edit dialog), `client/src/pages/notifications/WebhookSecretDialog.tsx`, `client/src/pages/notifications/DeliveryLog.tsx`, plus `*.test.tsx` for each
- Modify: `client/src/pages/notifications/channelTypes.tsx` (`WEBHOOK.available = true`; summary = URL host and events), `ChannelRow.tsx` (webhook actions: edit, rotate secret, delivery log; failure count tag), `NotificationsPage.tsx` (`onAdd('WEBHOOK')` opens the form, and after create shows the secret, then the device picker), `client/src/api/endpoints.ts`, `client/src/api/queries.ts` (`queryKeys.deliveries(id)`, `useDeliveries` as an infinite query), `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.notifications.webhook.*`), MSW handlers
- Docs: `docs/PROJECT_V2.md` §9 Notifications (webhook row contents)

**Interfaces:**

- Consumes: the shared schemas from Tasks 4 and 6.
- Produces: `createWebhook(api, body)`, `rotateSecret(api, id)`, `getDeliveries(api, id, cursor?)`, `redeliver(api, deliveryId)`.

- [ ] **Step 1: Failing tests** (Testing Library + MSW):
  - Add channel → Webhook opens the form, built with `components/ui` `Input`, `Checkbox` and `Button`. An `http://` URL shows a field error before submit. A server `400 url_not_allowed` shows a translated error on the URL field.
  - After create, the secret dialog shows the secret with a Copy button and a "shown only once" note. Closing it opens the device picker for the new channel. The secret appears in no other DOM.
  - The webhook row summary shows the host (`hooks.example.com`) and the event list. A failure tag shows "3 failures in a row" when `failures > 0`.
  - Rotate asks for confirmation (`ConfirmDialog`), then shows the new secret in the same dialog.
  - Delivery log: rows show event, device name, status `Tag`, attempts, `last_error` and a local time. "Load more" follows `next_cursor`. Redeliver on a `FAILED` row calls the endpoint and refreshes the log. `QUEUED` and `RETRYING` rows have no Redeliver button.
  - Motion: the log panel has `data-motion="panel"`. Rows have `data-motion="enter"` and `--i`. `motion.test.tsx` and `consistency.test.ts` pass unchanged.
- [ ] **Step 2:** Run `npm run test -w client -- notifications` → FAIL.
- [ ] **Step 3:** Implement. Use React Hook Form with `createWebhookSchema` for the resolver. Hold the secret only in dialog state, and clear it on close.
- [ ] **Step 4:** Run `npm run test -w client`, `npm run lint`, `npm run fmt:check` and `npm run typecheck` → PASS.
- [ ] **Commit point:** `Add webhooks to the Notifications page`

### Task 8: Roadmap and wrap-up

**Files:**

- Modify: `docs/ROADMAP.md`

- [ ] **Step 1:** Make the ROADMAP changes:
  - Tick the four deliverables. M8 stays 🟡 until the manual checks below are done.
  - Q13: mark the webhook half done (the outage `id` is a UUID). `CANCELLED` stays for M11.
  - Q14: add "✅ M8: `POST /channels/:id/rotate-secret`".
- [ ] **Step 2:** Run the full suite with `npm run lint && npm run fmt:check && npm run typecheck && npm test && npm run build` → all green.
- [ ] **Commit point:** `Mark M8 webhooks in the roadmap`

## Done when

These come from the ROADMAP. SSRF ranges (IPv4 and IPv6) and redirects are covered by Tasks 2 and 3. The signature test vector is in Task 3. The retry schedule with a controlled clock and disabling on the 20th failure are in Task 5. Redeliver keeping its ID is in Task 6.

## Manual checks (staging)

Verify by hand:

1. Set `ENCRYPTION_KEY` in `/etc/elec/staging.env` (`openssl rand -base64 32`), then restart the API and the worker. Both start cleanly.
2. Add a webhook that points to a request inspector (for example webhook.site). Send test → `ping` arrives with a valid `X-Elec-Signature`.
3. Attach it to a device, then unplug the device → `device.offline` arrives. Plug it back in → `device.online` arrives with `ended_at` and `duration_s`.
4. Point the URL at a receiver that returns `500`. The delivery log shows `RETRYING` with `HTTP 500`. Redeliver after fixing the receiver → it arrives with the same `X-Elec-Delivery`.
5. `https://127.0.0.1/` and `https://localhost/` are rejected in the form.
6. Rotate the secret. The next test verifies only with the new secret.
