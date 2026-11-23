# M3 — Worker and platform Telegram bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the worker turns missed check-ins into outages, queues OFF, recovery,
summary and power blip notifications into `delivery`, and sends them through
the platform Telegram bot. Users link the bot to their account and choose
which devices notify which chat.

**Architecture:** The rules for whether and what to notify are pure functions
in `server/src/notifications/rules.ts`. `createNotificationQueue` replaces the
M2 no-op. It fans an event out to the device's linked channels inside the
caller's transaction (`on conflict do nothing`). The worker runs two loops. The
monitor loop runs every 10 s: heartbeat, offline check, due OFF alerts,
rate-limit cleanup and the daily cleanup. The delivery loop runs continuously:
it claims a leased batch, renders the text at send time in the recipient's
language and timezone, sends through a `TelegramClient` behind a 30 msg/s
pacer, then writes the result. The Telegram webhook answers commands in the
webhook response body, so the API never calls Telegram itself.

**Tech Stack:** Node.js 26, Express 5, Drizzle 0.45 (PGlite in tests,
postgres.js in prod), Zod 4, zod-openapi 6, i18next, Vitest 5, supertest,
`fetch` for the Bot API (no Telegram library).

**Spec:** [ROADMAP.md § M3](../ROADMAP.md#m3--worker-and-platform-telegram-bot) ·
[PROJECT_V2.md](../PROJECT_V2.md) §5 worker and device settings, §7 platform
bot and message texts, §11, §12 Config · [API.md](../API.md) §4 Notification
channels, §6, §9 · [DATABASE.md](../DATABASE.md) §3 `one_time_token`, §7, §9,
§10 Cleanup, §12.

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints), [M1](M01-auth.md#global-constraints) and [M2](M02-devices.md#global-constraints) constraints still applies (ESM, strict, UUIDv7 from `newId()`, `timestamptz`, error shape, no comments, no real names, `clock.now()` only, `404` for inaccessible devices).
- **No migration in M3.** The M0 schema already has every table and column. If a task seems to need one, stop and ask.
- Lock order: the `device` row first (`for update`, or `for update skip locked` in the worker), then its outage, then deliveries (D §9). Re-check the condition after taking the lock. No Telegram or other HTTP call inside a transaction.
- Every timestamp M3 writes comes from `clock.now()`, including `delivery.created_at`, `next_attempt_at`, `outage.created_at` and `off_alert_*`.
- Deliveries are inserted in the same transaction as the state change, with `on conflict do nothing` on `(outage_id, channel_id, event)` (D §7).
- Offline check every 10 s, at most 100 devices per batch (D §9). Delivery lease: `attempts + 1`, `next_attempt_at = now + 2 min` (D §9).
- Retries: 1 min, 5 min, 30 min, 2 h, 6 h, then `FAILED` (6 attempts). Channel disabled with `TOO_MANY_FAILURES` at 20 counted failures (D §7).
- Telegram: ≤ 30 messages/s for the platform bot (P §11). Plain text (no `parse_mode`). `disable_notification: true` during quiet hours (P §5).
- Messages in the recipient's `language` and `timezone`, `uk` when unknown (P §7, §9). New keys exist in `uk`, `en` and `ru` (parity test). No i18next plural keys and no `count` interpolation variable, because plural suffixes differ per language and break the parity test.
- Tests never call Telegram: `FakeTelegramClient` only. No real HTTP.
- Every new `/api/v1` endpoint is in the OpenAPI document under its tag, and API.md is updated in the same task. The Telegram webhook is not in the public document (A §7).

## Decisions made in this plan

Each task records its decisions in the spec. Task 11 marks Q6, Q7 and the M3 part of Q14 ✅ in the ROADMAP.

1. **Notification rules stay on the device (Q6).** The owner sets `notify_short_outages`, `notify_network_outages` and quiet hours for everyone who receives the device's alerts (viewers too, from M6). Quiet hours are read in **each recipient's** timezone. `outage.off_alert_due_at` stays one value per outage. P §5, D §4 notes, D §12 Q1, A §9 Q1–2.
2. **Which events notify:**
   - OFF alert → `device.offline`, always, once `off_alert_due_at` has passed.
   - Recovery (an OFF alert was queued) → `device.online`, **always**. The 🔴 message always gets its 🟢.
   - Summary (no OFF alert was queued) and power blip → `device.online` or `device.power_blip`, unless `kind = SHORT` and `notify_short_outages` is off, or `cause = NETWORK` and `notify_network_outages` is off.

   P §5 Device settings is reworded so that "notify on suspected network outages" affects summaries only.

3. **OFF alert timing.** When the worker opens the outage: `off_alert_due_at = now` if `notify_short_outages`, else `max(now, started_at + short_outage_threshold_s)`. The OFF alert is then queued by the due-alert step in the same tick. `state_since` of `OFFLINE` = the old `offline_at` (the deadline), not the worker's run time.
4. **Retention 90 days (Q7)** for `delivery` (by `created_at`) and `device_diagnostic` (by `started_at`). D §10, D §12 Q2.
5. **Linking.** `POST /channels/telegram-link` issues a `TELEGRAM_LINK` one-time token (the existing 43-char base64url `randomToken()`, valid 15 min). Earlier unused link tokens of the user are expired. The response is `{ url: https://t.me/<bot>?start=<code>, group_url: https://t.me/<bot>?startgroup=<code>, expires_at }`. Rate limit: 10 / 15 min per user. A new channel is linked to **every device the user owns** at that moment. Devices created later are not auto-linked.
6. **Channel name** = the group title, or the private chat's `first_name last_name`, or `@username`, or `Telegram`, trimmed to 64 chars. Linking the same chat again for the same user replies "already linked" and changes nothing.
7. **Bot commands.**
   - `/start <code>` links the chat. `/start` without a code shows the welcome text.
   - `/status` lists the devices that notify **this chat** (through `device_channel`), not every device the linked users own. It is ordered by name and shows state and "since".
   - `/stop` deletes every `TELEGRAM_PLATFORM` channel for this chat. That cascades links and the delivery log.
   - A `my_chat_member` update with status `kicked` or `left` does the same, silently.
   - `/cmd@OtherBot` is ignored. `/stats` arrives in M9 and until then gets the help text.
   - Replies go in the language of the oldest linked channel's user. An unlinked chat uses `from.language_code` when it is `uk`, `en` or `ru`, else `uk`.
8. **Webhook.** `:secret` and `X-Telegram-Bot-Api-Secret-Token` must both equal `TELEGRAM_WEBHOOK_SECRET` (timing-safe compare), else `404`. A valid request always gets `200`. The reply is the webhook response body `{ "method": "sendMessage", "chat_id": "<id>", "text": "…" }`, or an empty body. A handler error is logged and still answered with `200`, so Telegram doesn't retry forever. `allowed_updates`: `message`, `my_chat_member`.
9. **Message texts** (en, from P §7, plus a summary text and a long power blip variant):
   - Offline: `🔴 {name} — device stopped checking in` / `Last signal: {time}`.
   - Recovery: `🟢 {name} — device is back online` / `Offline for {duration} ({range})` plus ` · suspected power outage` or ` · suspected network outage`. Nothing is added for `UNKNOWN`.
   - Summary: `🟠 {name} — device was out of contact` / the recovery body.
   - Power blip: `🟡 {name} — suspected short power interruption` (`LONG`: `suspected power interruption`) / `Device restarted · {duration} between check-ins`.
   - `{time}` = `21 Nov 18:42` in the recipient's timezone. `{range}` = `18:42 → 20:57` on the same local day, else `21 Nov 23:50 → 22 Nov 00:10`.
   - `{duration}` is floored: `< 60 s` → `25 s`, `< 1 h` → `12 min`, `< 24 h` → `2 h 15 min` (` 0 min` dropped), else `1 d 3 h`.
   - The device name comes from the payload snapshot. The outage end and `off_alert_queued_at` are read at send time.
10. **Send outcomes.**

    | Outcome                            | Delivery                                                                                         | Channel failures                  |
    | ---------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
    | `2xx`                              | `SENT`, `sent_at`                                                                                | Reset to 0                        |
    | `429`                              | `RETRYING` at `now + retry_after`, the attempt is not counted (`attempts − 1`)                   | Unchanged                         |
    | `400` / `403` (permanent)          | `FAILED` at once                                                                                 | +1                                |
    | `5xx`, network error, 10 s timeout | Retry schedule                                                                                   | Unchanged for `TELEGRAM_PLATFORM` |
    | `400` with `migrate_to_chat_id`    | Channel's `telegram_chat_id` updated, then due at once. A unique-key conflict makes it permanent | Unchanged                         |

    A Telegram-wide outage therefore can't disable every platform channel. M8 applies its own counting to webhooks.

11. **Stale OFF alerts are skipped.** A `device.offline` delivery whose outage has already closed when it is sent becomes `FAILED` with `last_error = 'skipped: outage closed'`, with no channel failure. The 🟢 message carries the full story. A delivery whose channel is disabled is skipped the same way (`'skipped: channel disabled'`).
12. **Send order and rate.** The delivery loop claims up to 30 due rows, ordered by `next_attempt_at, created_at`. It groups them by channel, sends each group in order, and runs up to 10 groups at once. Every send first takes a token from a 30/s pacer. When nothing is due it sleeps 1 s. The loop upserts its own heartbeat `worker = 'delivery'`, at most once per 10 s.
13. **Daily cleanup** runs on the first monitor tick after start, then every 24 h (tracked in memory; it is idempotent). It deletes:
    - `one_time_token` 1 day after `expires_at`
    - `session` rows that are revoked, or whose refresh tokens have all expired
    - `device_invite` 30 days after `expires_at`
    - `delivery` and `device_diagnostic` older than 90 days
14. **Config.**
    - API gains `TELEGRAM_PLATFORM_BOT_USERNAME` (`^[A-Za-z0-9_]{5,32}$`, a leading `@` stripped) and `TELEGRAM_WEBHOOK_SECRET` (`^[A-Za-z0-9_-]{32,256}$`, the Bot API `secret_token` alphabet).
    - The worker uses `loadWorkerConfig`: `DATABASE_URL`, `TELEGRAM_TRANSPORT` (`telegram` default | `log`), and `TELEGRAM_PLATFORM_BOT_TOKEN` (required when `telegram`).
    - The API doesn't need the bot token. P §12 Config.
15. **Proposed endpoints accepted (Q14):** `POST /channels/telegram-link`, `GET /devices/:id/channels` (`{ channel_ids }`). `PUT /devices/:id/channels` returns `200 { channel_ids }`. An unknown or foreign channel ID → `400 validation_error` with detail `{ path: 'channel_ids.<i>', code: 'not_found' }`. At most 50 IDs, duplicates collapsed. Device access is `read` (owner in M3; M6 adds viewers). Fan-out sends only to channels whose user can still read the device.
16. **Webhook registration** is a script, `npm run telegram:webhook -w server -- set|info|delete`, run by hand per environment.

## Review Focus

1. **Telegram returns `5xx` or times out during a mass outage** → deliveries go `RETRYING` on the schedule, nothing is sent twice, and no platform channel is disabled (decision 10). Tests in Task 6.
2. **The 🔴 delivery is still retrying when the device comes back** → the 🔴 message is skipped and only the 🟢 is sent. When both are due together for one chat, they go out in creation order. Tests in Task 6.
3. **Quiet hours `23:00–07:00` across midnight and a DST change** (recipient in `Europe/Kyiv` on 2026-10-25, another in `America/New_York`) → silent exactly inside the local window. Tests in Task 1.
4. **Group chats**: `/start@<OurBot> <code>` links the group, `/status@OtherBot` is ignored, removing the bot from the group deletes its channels. Tests in Task 9.
5. **A device name with `<b>&`, emoji or 64 chars, and a device deleted while its delivery is in flight** → the text is sent as-is, and writing the result for a cascaded row is a no-op, not a crash. Tests in Tasks 2 and 6.

---

## File structure

```
shared/src/enums.ts                        + deliveryEvents, deliveryStatuses, channelTypes
shared/src/i18n/locales/{uk,en,ru}.ts      + telegram.* keys
server/src/config.ts                       + telegram API keys, loadWorkerConfig
server/src/notifications/format.ts         formatDuration, formatMoment, formatRange, isQuietTime
server/src/notifications/render.ts         renderDeliveryText
server/src/notifications/rules.ts          notificationEvent, offAlertDueAt
server/src/notifications/queue.ts          NotificationQueue (+ offAlert), createNotificationQueue, fan-out
server/src/notifications/telegram.ts       TelegramClient, createTelegramClient, createLogTelegramClient
server/src/notifications/pacer.ts          createPacer
server/src/notifications/deliveries.ts     claimDeliveries, recordOutcome, nextRetryAt
server/src/notifications/deliveryLoop.ts   processDueDeliveries, runDeliveryLoop
server/src/monitoring/offline.ts           checkOffline, queueDueOffAlerts
server/src/worker/cleanup.ts               runCleanup, dailyRunner
server/src/worker.ts                       two loops
server/src/channels/views.ts               channelSchema, toChannel
server/src/http/channels/channels.ts       telegram-link, GET /channels, GET|PUT /devices/:id/channels
server/src/telegram/commands.ts            parseCommand
server/src/telegram/bot.ts                 handleUpdate
server/src/http/telegram/webhook.ts        POST /telegram/webhook/:secret
server/scripts/telegram-webhook.ts         set | info | delete
server/test/fakes.ts                       + FakeTelegramClient, RecordingNotificationQueue.offAlert
server/test/channels.ts                    createPlatformChannel, linkChannel
```

Tests sit next to the code (`*.test.ts`). Real-Postgres tests are `*.pg.test.ts` and skip without `TEST_DATABASE_URL`.

---

### Task 1: Formatting and quiet hours

**Files:**

- Create: `server/src/notifications/format.ts`, `server/src/notifications/format.test.ts`
- Modify: `shared/src/enums.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts`

**Interfaces:**

- Produces (shared): `deliveryEvents = ['device.offline', 'device.online', 'device.power_blip'] as const`, `type DeliveryEvent`; `deliveryStatuses = ['QUEUED', 'SENT', 'RETRYING', 'FAILED'] as const`; `channelTypes = ['TELEGRAM_PLATFORM', 'TELEGRAM_BOT', 'WEBHOOK'] as const`, `type ChannelType`.
- Produces (i18n): `telegram.duration.{seconds,minutes,hours,days}` with `{{value}}`. For example, en is `'{{value}} s'`, `'{{value}} min'`, `'{{value}} h'` and `'{{value}} d'`. uk uses `с`, `хв`, `год`, `д`. ru uses `с`, `мин`, `ч`, `д`.
- Produces:

  ```ts
  type QuietHours = { start: string; end: string }; // 'HH:MM' or 'HH:MM:SS' (Drizzle time)
  formatDuration(seconds: number, t: TFunction): string;
  formatMoment(at: Date, language: Language, timezone: string): string; // '21 Nov 18:42'
  formatRange(from: Date, to: Date, language: Language, timezone: string): string;
  isQuietTime(now: Date, quiet: QuietHours | null, timezone: string): boolean;
  ```

  `formatMoment` builds day, short month and `HH:mm` (h23) from `Intl.DateTimeFormat#formatToParts`. Locales: `uk-UA`, `en-GB`, `ru-RU`. An invalid timezone falls back to `Europe/Kyiv`.

- [ ] **Step 1: Tests:**
  - `formatDuration` (en): 0 → `0 s`, 25 → `25 s`, 59 → `59 s`, 60 → `1 min`, 749 → `12 min`, 3600 → `1 h`, 8100 → `2 h 15 min`, 86 399 → `23 h 59 min`, 97 200 → `1 d 3 h`, 86 400 → `1 d`.
  - `formatMoment(2026-11-21T16:42:00Z, 'en', 'Europe/Kyiv')` → `21 Nov 18:42`. With `uk` and `ru`, the result contains `21` and `18:42`.
  - `formatRange`: 16:42Z → 18:57Z in Kyiv → `18:42 → 20:57`. 21:50Z → 22:10Z → `21 Nov 23:50 → 22 Nov 00:10`.
  - `isQuietTime` with `{ start: '23:00', end: '07:00' }`, Kyiv: 22:59 local → false, 23:00 → true, 03:00 → true, 06:59 → true, 07:00 → false. `{ '01:00', '05:00' }`: 00:59 false, 01:00 true, 05:00 false. `null` → false.
  - DST (Review Focus 3): on 2026-10-25 at 01:00Z Kyiv goes from UTC+3 to UTC+2. 2026-10-24T19:59Z (22:59 local) → false, 2026-10-24T20:00Z (23:00) → true, 2026-10-25T04:59Z (06:59 local) → true, 2026-10-25T05:00Z (07:00) → false.
  - Recipient timezone: the instant 2026-10-25T22:00Z is quiet in `Europe/Kyiv` (00:00) and not quiet in `America/New_York` (18:00).
  - Invalid timezone `'Mars/Base'` → no throw, Kyiv result.
- [ ] **Step 2: Run** `npm test -w server -- format` → FAIL, implement, → PASS. `npm test -w shared` (parity) → PASS.
- [ ] **Commit point:** `shared/src/ server/src/notifications/format*` — `Add notification formatting and quiet hours`

### Task 2: Message rendering

**Files:**

- Create: `server/src/notifications/render.ts`, `server/src/notifications/render.test.ts`
- Modify: `shared/src/i18n/locales/{uk,en,ru}.ts`
- Docs: `docs/PROJECT_V2.md` §7 Message texts (decision 9: summary text, long blip, time and range format, plain text)

**Interfaces:**

- Consumes: Task 1, `createI18n()`, `OutageItem` from `http/devices/views.ts`.
- Produces (i18n): `telegram.offline.{title,body}`, `telegram.recovery.{title,body}`, `telegram.summary.title`, `telegram.powerBlip.{titleShort,titleLong,body}`, `telegram.cause.{POWER,NETWORK}`, with the en copy from decision 9 (`{{name}}`, `{{time}}`, `{{duration}}`, `{{range}}`, `{{cause}}`).
- Produces:

  ```ts
  type DeliveryPayload = { event: DeliveryEvent; device: { id: string; name: string }; outage: OutageItem };
  type RenderInput = { payload: DeliveryPayload; offAlertQueued: boolean; language: Language; timezone: string };
  renderDeliveryText(i18n: i18n, input: RenderInput): string; // lines joined with '\n'
  ```

  `device.online` uses the recovery title when `offAlertQueued`, else the summary title.

- [ ] **Step 1: Tests** (en, Kyiv, outage started 16:42Z):
  - offline → `'🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42'`.
  - online, ended 18:57Z, `POWER`, `offAlertQueued` → `'🟢 Home — device is back online\nOffline for 2 h 15 min (18:42 → 20:57) · suspected power outage'`.
  - same with `offAlertQueued: false`, `NETWORK`, 150 s → `'🟠 Home — device was out of contact\nOffline for 2 min (18:42 → 18:44) · suspected network outage'`. With `UNKNOWN` there is no ` · …` suffix.
  - power blip, 25 s, `SHORT` → `'🟡 Home — suspected short power interruption\nDevice restarted · 25 s between check-ins'`. With `LONG`, the title says `suspected power interruption`.
  - `language: 'uk'` and `'ru'` → the text differs from en and still contains the device name.
  - Review Focus 5: name `'<b>&amp; 💡'` appears unchanged, and a 64-char name is not truncated.
- [ ] **Step 2: Run** → FAIL, write the uk / ru copy, implement, → PASS (parity test too).
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `shared/src/i18n/ server/src/notifications/render* docs/PROJECT_V2.md` — `Add Telegram message rendering`

### Task 3: Notification rules and queue

**Files:**

- Create: `server/src/notifications/rules.ts`, `server/src/notifications/rules.test.ts`, `server/src/notifications/queue.test.ts`, `server/test/channels.ts`
- Modify: `server/src/notifications/queue.ts`, `server/src/api.ts`, `server/test/fakes.ts`
- Docs: `docs/PROJECT_V2.md` §5 Device settings (decisions 1, 2), `docs/DATABASE.md` §4 notes and §7 `delivery` (payload shape, fan-out access rule), §12 Q1

**Interfaces:**

- Consumes: Task 2 (`DeliveryPayload`), `toOutageItem`.
- Produces:
  ```ts
  type NotificationKind = 'offAlert' | 'recovery' | 'summary' | 'powerBlip';
  type NotifyRules = { notifyShortOutages: boolean; notifyNetworkOutages: boolean };
  notificationEvent(kind: NotificationKind, outage: { kind: OutageKind | null; cause: OutageCause | null }, rules: NotifyRules): DeliveryEvent | null;
  offAlertDueAt(startedAt: Date, now: Date, s: { notifyShortOutages: boolean; shortOutageThresholdS: number }): Date;

  interface NotificationQueue {               // offAlert added to the M2 interface
    offAlert(tx: Tx, event: OutageEvent): Promise<void>;
    recovery(tx: Tx, event: OutageEvent): Promise<void>;
    summary(tx: Tx, event: OutageEvent): Promise<void>;
    powerBlip(tx: Tx, event: OutageEvent): Promise<void>;
  }
  createNotificationQueue(clock: Clock): NotificationQueue;
  ```
  Each method reads the outage joined with its device, applies `notificationEvent`, and returns early when that gives `null`. Otherwise it selects the channels: `device_channel` → `notification_channel` with `enabled`, the channel's user able to read the device (M3: `user_id = device.owner_id`), and for `WEBHOOK` the event in `webhook_events`. It then inserts one `delivery` per channel with `newId()`, `payload: DeliveryPayload`, and `created_at = next_attempt_at = clock.now()`, `on conflict do nothing`.
- Produces (test): `RecordingNotificationQueue` gains `offAlert`. `createPlatformChannel(db, userId, overrides?: { chatId?: bigint; enabled?: boolean }): Promise<ChannelRow>`; `linkChannel(db, deviceId, channelId): Promise<void>`.
- `api.ts` passes `createNotificationQueue(systemClock)`.

- [ ] **Step 1: `rules.test.ts`:**
  - `notificationEvent('offAlert', …)` → `device.offline` for any rules.
  - `recovery` → `device.online` even with both rules off and `NETWORK` / `SHORT`.
  - `summary`: `SHORT` + short off → `null`; `LONG` + short off → `device.online`; `NETWORK` + network off → `null`; `POWER` + network off → `device.online`.
  - `powerBlip`: `SHORT` + short off → `null`, otherwise `device.power_blip`.
  - `offAlertDueAt(T, T+120 s, { true, 180 })` = T + 120 s; `{ false, 180 }` → T + 180 s; `{ false, 60 }` → T + 120 s.
- [ ] **Step 2: `queue.test.ts`** (PGlite):
  - The owner has two linked platform channels and one unlinked one → `offAlert` inserts two `device.offline` rows. `payload.device.name` and `payload.outage` equal `toOutageItem` of the row.
  - Calling `offAlert` twice → still two rows (unique index).
  - A disabled channel → no row.
  - A channel of another user linked to the device → no row (access rule).
  - `summary` with `notify_short_outages` off on a `SHORT` outage → no rows.
  - `recovery` with `notify_network_outages` off on a `NETWORK` outage → rows inserted.
- [ ] **Step 3: Run** → FAIL, implement, → PASS. The M2 tests still pass with `RecordingNotificationQueue`.
- [ ] **Step 4: Docs** per the Files list.
- [ ] **Commit point:** `server/src/notifications/ server/src/api.ts server/test/ docs/` — `Add notification rules and delivery fan-out`

### Task 4: Offline checker and due OFF alerts

**Files:**

- Create: `server/src/monitoring/offline.ts`, `server/src/monitoring/offline.test.ts`, `server/src/monitoring/offline.pg.test.ts`
- Docs: `docs/PROJECT_V2.md` §5 (decision 3: `state_since`), `docs/DATABASE.md` §6 `outage` notes (decision 3)

**Interfaces:**

- Consumes: Task 3 (`offAlertDueAt`, `NotificationQueue.offAlert`).
- Produces:

  ```ts
  type MonitorDeps = { db: Db; clock: Clock; logger: Logger; notifications: NotificationQueue };
  OFFLINE_BATCH = 100;
  checkOffline(deps: MonitorDeps): Promise<number>;      // devices flipped
  queueDueOffAlerts(deps: MonitorDeps): Promise<number>; // outages alerted
  ```
  - `checkOffline` loops over batches until one returns fewer than 100 rows, with at most 10 batches per call. Each batch is one transaction. It runs the D §9 query with `for update skip locked`, then for each row re-checks `state = 'ONLINE' && offlineAt <= now`. A device that passes is set to `OFFLINE`, `state_since = offline_at`, `offline_at = null`, and gets an inserted open `OUTAGE` with `started_at = last_seen_at`, `off_alert_due_at` from `offAlertDueAt` and `created_at = now`.
  - `queueDueOffAlerts` selects up to 100 due outages without a lock, using the D §9 query. Each outage gets its own transaction: lock the device `for update skip locked` (skip if locked), lock the outage, then re-check that it is still open, still unqueued and due. It then calls `notifications.offAlert` and sets `off_alert_queued_at = now`.

- [ ] **Step 1: Tests** (PGlite, `FakeClock`, `RecordingNotificationQueue`; device last seen at T with the default settings):
  - At T + 119 s → 0, the device is `ONLINE`. At T + 120 s → 1. The device is `OFFLINE` with `state_since = T + 120 s` and `offline_at = null`. The open outage has `started_at = T` and `off_alert_due_at = T + 120 s`.
  - Then `queueDueOffAlerts` at T + 120 s → 1, `off_alert_queued_at = T + 120 s`, one `offAlert` call. A second run → 0, no new call.
  - Short alerts off, threshold 180: open at T + 120 s with due T + 180 s. `queueDueOffAlerts` at T + 179 s → 0, at T + 180 s → 1.
  - A check-in closes the outage before it is due → `queueDueOffAlerts` → 0.
  - `PENDING`, `OFFLINE` and `UPDATING` devices are never touched.
  - 250 devices past their deadline → one call returns 250, and every one has exactly one open outage.
- [ ] **Step 2: Real-Postgres test** (`offline.pg.test.ts`):
  - Hold `select … for update` on a past-deadline device in a separate `sql.begin`. `checkOffline` → 0 and the device stays `ONLINE`. Release, run again → 1.
  - Race: at T + 125 s run `checkOffline` and a same-boot `recordCheckIn` together with `Promise.all`. Afterwards the device is `ONLINE`, there is no open outage, there is at most one `OUTAGE` row, and it is closed.
- [ ] **Step 3: Run** → FAIL, implement, → PASS.
- [ ] **Step 4: Docs** per the Files list.
- [ ] **Commit point:** `server/src/monitoring/offline* docs/` — `Add offline checker and OFF alert queueing`

### Task 5: Telegram client and worker config

**Files:**

- Create: `server/src/notifications/telegram.ts`, `server/src/notifications/telegram.test.ts`
- Modify: `server/src/config.ts`, `server/src/config.test.ts`, `server/test/fakes.ts`, `server/.env.example`
- Docs: `docs/PROJECT_V2.md` §12 Config (decision 14, worker keys)

**Interfaces:**

- Produces:
  ```ts
  type SendResult =
    | { type: 'SENT' }
    | { type: 'RETRY_AFTER'; seconds: number }
    | { type: 'MIGRATED'; chatId: bigint }
    | { type: 'PERMANENT'; error: string }
    | { type: 'TRANSIENT'; error: string };
  interface TelegramClient {
    sendMessage(chatId: bigint, text: string, opts: { silent: boolean }): Promise<SendResult>;
  }
  createTelegramClient(botToken: string, fetchFn?: typeof fetch): TelegramClient;
  createLogTelegramClient(logger: Logger): TelegramClient; // logs, returns SENT
  type WorkerConfig = { databaseUrl: string; telegram: { transport: 'telegram'; botToken: string } | { transport: 'log' } };
  loadWorkerConfig(env): WorkerConfig; loadWorkerConfigOrExit(env): WorkerConfig;
  ```
  - `sendMessage` makes a `POST https://api.telegram.org/bot<token>/sendMessage` with JSON `{ chat_id: String(chatId), text, disable_notification: silent, link_preview_options: { is_disabled: true } }` and `AbortSignal.timeout(10_000)`.
  - The result is mapped by decision 10. Error text is `HTTP <status>: <description>`, capped at 500 chars, and never contains the token.
- Produces (test): `FakeTelegramClient implements TelegramClient { sent: Array<{ chatId: bigint; text: string; silent: boolean; at: Date }>; script(...results: SendResult[]): void }`. It takes a clock, so `at` is the fake time. Unscripted calls return `SENT`.

- [ ] **Step 1: Tests** with a stub `fetchFn`:
  - The request URL and body are exact. A chat ID of `-1001234567890n` is sent as `"-1001234567890"`.
  - `200 { ok: true }` → `SENT`.
  - `429 { parameters: { retry_after: 7 } }` → `RETRY_AFTER 7`.
  - `400 { parameters: { migrate_to_chat_id: -100999 } }` → `MIGRATED -100999n`.
  - `403 "Forbidden: bot was blocked by the user"` → `PERMANENT`.
  - `400 "chat not found"` → `PERMANENT`.
  - `502` → `TRANSIENT`.
  - A rejected fetch and an `AbortError` → `TRANSIENT`.
  - The token string never appears in any `error`.
- [ ] **Step 2: Config tests:** `loadWorkerConfig` without `TELEGRAM_TRANSPORT` and without a token → `ConfigError` naming `TELEGRAM_PLATFORM_BOT_TOKEN`; `log` without a token → ok; it doesn't require `JWT_SECRET`.
- [ ] **Step 3: Run** → FAIL, implement, → PASS. `.env.example` gains `TELEGRAM_TRANSPORT=log`.
- [ ] **Step 4: Docs** per the Files list.
- [ ] **Commit point:** `server/src/notifications/telegram* server/src/config* server/test/fakes.ts server/.env.example docs/PROJECT_V2.md` — `Add Telegram client and worker config`

### Task 6: Delivery worker

**Files:**

- Create: `server/src/notifications/pacer.ts`, `server/src/notifications/pacer.test.ts`, `server/src/notifications/deliveries.ts`, `server/src/notifications/deliveries.test.ts`, `server/src/notifications/deliveries.pg.test.ts`, `server/src/notifications/deliveryLoop.ts`, `server/src/notifications/deliveryLoop.test.ts`
- Docs: `docs/DATABASE.md` §7 `notification_channel` and `delivery` notes (decisions 10–12)

**Interfaces:**

- Consumes: Tasks 1, 2, 5, `Sleep` from `worker/loop.ts`.
- Produces:

  ```ts
  createPacer(o: { ratePerS: number; clock: Clock; sleep: (ms: number) => Promise<void> }): { take(): Promise<void> };
  RETRY_DELAYS_S = [60, 300, 1800, 7200, 21600]; MAX_ATTEMPTS = 6; LEASE_MS = 120_000; FAILURES_TO_DISABLE = 20;
  nextRetryAt(attempts: number, now: Date): Date | null; // attempts after the claim; null when ≥ MAX_ATTEMPTS
  type ClaimedDelivery = {
    id: string; attempts: number; event: DeliveryEvent; payload: DeliveryPayload; createdAt: Date;
    channel: { id: string; type: ChannelType; enabled: boolean; chatId: bigint | null };
    recipient: { language: Language; timezone: string };
    quietHours: QuietHours | null; outageEndedAt: Date | null; offAlertQueued: boolean;
  };
  claimDeliveries(db: Db, clock: Clock, limit: number): Promise<ClaimedDelivery[]>;
  type Outcome = SendResult | { type: 'SKIPPED'; reason: string };
  recordOutcome(db: Db, clock: Clock, d: ClaimedDelivery, outcome: Outcome): Promise<void>;
  type DeliveryDeps = { db: Db; clock: Clock; logger: Logger; telegram: TelegramClient; i18n: i18n; pacer: { take(): Promise<void> } };
  DELIVERY_BATCH = 30; SEND_CONCURRENCY = 10;
  processDueDeliveries(deps: DeliveryDeps): Promise<number>; // deliveries handled
  runDeliveryLoop(deps: DeliveryDeps & { signal: AbortSignal; sleep?: Sleep; beat: () => Promise<void> }): Promise<void>;
  ```
  - `claimDeliveries` is one transaction. It selects due rows (D §9) `order by next_attempt_at, created_at limit $n for update skip locked`, then `update … set attempts = attempts + 1, last_attempt_at = now, next_attempt_at = now + LEASE_MS`. It joins the channel, the channel's `app_user` (language, timezone), the outage (`ended_at`, `off_alert_queued_at`) and the device (quiet hours).
  - `processDueDeliveries` handles each delivery in order. Disabled channel → `SKIPPED`. `device.offline` with `outageEndedAt` set → `SKIPPED`. Otherwise it renders (Task 2), takes from the pacer and sends with `silent = isQuietTime(now, quietHours, recipient.timezone)`. Only `TELEGRAM_PLATFORM` has a sender in M3. Any other type logs an error and becomes `PERMANENT 'unsupported channel'`.
  - `recordOutcome` writes decision 10. A row or channel that no longer exists updates 0 rows and doesn't throw. `MIGRATED` updates the chat ID and sets `next_attempt_at = now` with `attempts − 1`. A unique conflict becomes `PERMANENT`.
  - `runDeliveryLoop` calls `processDueDeliveries` until aborted. It sleeps 1 s when the result is 0, and calls `beat` at most once per 10 s of clock time. It catches and logs errors per iteration.

- [ ] **Step 1: `pacer.test.ts`:** with a `FakeClock` and a `sleep` that advances it, 90 `take()` calls give times where no 1 000 ms window has more than 30, and the last one is at or after 2 000 ms.
- [ ] **Step 2: `deliveries.test.ts`** (PGlite):
  - `nextRetryAt` for attempts 1…5 → now + 60 s, 300 s, 1 800 s, 7 200 s, 21 600 s. Attempts 6 → `null`.
  - Claim sets the lease. A row that isn't due, or is `SENT` or `FAILED`, is not claimed. Claiming again right away returns nothing.
  - `SENT` → status `SENT`, `sent_at`, channel `consecutive_failures` 0.
  - `TRANSIENT` on attempt 1 → `RETRYING` at now + 60 s, `last_error` set, failures unchanged. On attempt 6 → `FAILED` (Review Focus 1).
  - `RETRY_AFTER 7` → `RETRYING` at now + 7 s, `attempts` back to the pre-claim value.
  - `PERMANENT` → `FAILED`, failures +1. At 19 → 20, the channel gets `enabled = false`, `disabled_reason = 'TOO_MANY_FAILURES'`.
  - `MIGRATED` → the channel's chat ID changes and the row is due now.
  - `SKIPPED` → `FAILED` with the reason and failures unchanged.
  - Review Focus 5: delete the device after the claim, then `recordOutcome(SENT)` → resolves, and there are no rows.
- [ ] **Step 3: `deliveryLoop.test.ts`** (PGlite, `FakeTelegramClient`, real pacer on the fake clock):
  - A queued `device.offline` → one send with the rendered text, status `SENT`.
  - In quiet hours in the recipient's timezone → `silent: true`.
  - Review Focus 2: an OFF delivery whose outage has closed → no send, `FAILED 'skipped: outage closed'`, and the 🟢 delivery for the same channel is sent. Two due deliveries for one channel (offline created before online, outage still open at claim) are sent in creation order.
  - Telegram scripted `TRANSIENT` five times then `SENT` → advancing the clock through the schedule ends in `SENT` with `attempts` 6. The channel stays enabled.
  - A user with `language: 'ru'` gets ru text.
- [ ] **Step 4: Real-Postgres test:** 60 due rows. Two `claimDeliveries(db, clock, 30)` calls run with `Promise.all` and return disjoint sets of 30.
- [ ] **Step 5: Run** → FAIL, implement, → PASS.
- [ ] **Step 6: Docs** per the Files list.
- [ ] **Commit point:** `server/src/notifications/ docs/DATABASE.md` — `Add delivery worker with retries and pacing`

### Task 7: Worker wiring and daily cleanup

**Files:**

- Create: `server/src/worker/cleanup.ts`, `server/src/worker/cleanup.test.ts`
- Modify: `server/src/worker.ts`
- Docs: `docs/DATABASE.md` §10 Cleanup (decision 13, 90 days), §12 Q2; `docs/PROJECT_V2.md` §12 (two worker loops)

**Interfaces:**

- Consumes: Tasks 3–6, `cleanupRateLimits`, `beat`, `runLoop`.
- Produces:
  ```ts
  RETENTION_DAYS = 90;
  runCleanup(db: Db, clock: Clock): Promise<Record<'oneTimeTokens' | 'sessions' | 'invites' | 'deliveries' | 'diagnostics', number>>;
  dailyRunner(clock: Clock, run: () => Promise<void>): () => Promise<void>; // runs on first call, then when ≥ 24 h since the last start
  ```
- `worker.ts`:
  - Loads `loadWorkerConfigOrExit`. Builds the Telegram client from the transport, `createNotificationQueue(systemClock)`, `createI18n()` and `createPacer({ ratePerS: 30, … })`.
  - Monitor loop every 10 s, in order: `beat('main')`, `checkOffline`, `queueDueOffAlerts`, `cleanupRateLimits`, the daily cleanup. Each step is wrapped so that one failing step is logged and the rest still run.
  - `runDeliveryLoop` with `beat('delivery')`.
  - Both loops run under one `AbortController`. Shutdown waits for both with `Promise.all`, then closes the DB.

- [ ] **Step 1: `cleanup.test.ts`** (PGlite, `FakeClock`):
  - A `one_time_token` that expired 25 h ago is deleted, one that expired 23 h ago is kept.
  - A revoked session is deleted. A session whose refresh tokens are all expired is deleted. A session with one live token is kept.
  - An invite 31 days past expiry is deleted, one 29 days past is kept.
  - A delivery created 91 days ago is deleted, one 89 days ago is kept. Diagnostics work the same way by `started_at`.
  - Outages and boots are never deleted.
  - Returned counts match.
  - `dailyRunner`: runs at 0 h, not at 23 h 59 min, again at 24 h.
- [ ] **Step 2: Run** → FAIL, implement, → PASS. `npm run typecheck -w server` and `npm run build -w server` pass.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/worker/ server/src/worker.ts docs/` — `Run offline checks, deliveries and cleanup in the worker`

### Task 8: Channels API

**Files:**

- Create: `server/src/channels/views.ts`, `server/src/http/channels/channels.ts`, `server/src/http/channels/channels.test.ts`
- Modify: `server/src/auth/oneTimeTokens.ts` (`TELEGRAM_LINK: 900`), `server/src/rateLimit/limiter.ts`, `server/src/config.ts`, `server/src/config.test.ts`, `server/test/app.ts` (`testConfig.telegram`), `server/src/http/app.ts`, `server/.env.example`
- Docs: `docs/API.md` §4 Notification channels (decisions 5, 15; remove both **(proposed)** markers; platform channel `config`), §9 gap rows; `docs/DATABASE.md` §3 (`TELEGRAM_LINK` 15 min); `docs/PROJECT_V2.md` §7 platform bot (group link, auto-link)

**Interfaces:**

- Consumes: `getAccessibleDevice`, `requireUser`, `requireVerifiedEmail`, `issueOneTimeToken`, `expireOneTimeTokens`, `rateLimit`.
- Produces:
  - `Config.telegram: { botUsername: string; webhookSecret: string }` (decision 14).
  - `TELEGRAM_LINK_PER_USER: RateRule = { limit: 10, windowS: 900 }`.
  - `channelSchema` (`.meta({ id: 'Channel' })`) `{ id, type, name, enabled, disabled_reason, config: { chat_id: string }, created_at }`; M8 turns `config` into a union. `toChannel(row: ChannelRow): Channel`.
  - `channelsRouter(deps)`, `channelsPaths`. All routes need a JWT and a verified email:
    - `POST /api/v1/channels/telegram-link` → `201 { url, group_url, expires_at }`.
    - `GET /api/v1/channels` → `200 { items: Channel[] }`, the caller's channels, oldest first.
    - `GET /api/v1/devices/:id/channels` → `200 { channel_ids: string[] }`, only the caller's linked channels.
    - `PUT /api/v1/devices/:id/channels` strict `{ channel_ids: uuid[] (max 50) }` → `200 { channel_ids }`. In one transaction it deletes the caller's links for the device and inserts the new set. Other users' links are untouched.

- [ ] **Step 1: Tests:**
  - telegram-link → `201`. `url` is `https://t.me/TestBot?start=<43 chars>` and `group_url` uses `startgroup`. `expires_at` = now + 15 min. Only the hash is stored, with purpose `TELEGRAM_LINK`. A second call expires the first token. With a denying limiter → `429`.
  - `GET /channels` → only the caller's channels. `chat_id` is a string (`"-1001234567890"`). `config` has no other keys.
  - PUT `[a, b]` → GET returns `[a, b]`. PUT `[b]` → `[b]`. PUT `[]` → `[]`. Another user's link on the same device survives every PUT.
  - Errors:
    - A foreign channel ID → `400` with detail `channel_ids.0` / `not_found`.
    - `channel_ids: ['x']` → `400`.
    - 51 IDs → `400`.
    - `[a, a]` → stored once.
  - Stranger → `404` on both device routes. No JWT → `401`. Unverified → `403 email_not_verified` on all four.
  - Config: a missing `TELEGRAM_WEBHOOK_SECRET` → `ConfigError`. `@TestBot` → `TestBot`. A 31-char secret or one containing `/` → error.
- [ ] **Step 2: Run** → FAIL, implement, add a `Notifications` OpenAPI group after `Outages`, → PASS.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/channels/ server/src/http/ server/src/auth/oneTimeTokens.ts server/src/rateLimit/ server/src/config* server/test/app.ts server/.env.example docs/` — `Add channels API and Telegram link codes`

### Task 9: Telegram webhook and bot commands

**Files:**

- Create: `server/src/telegram/commands.ts`, `server/src/telegram/commands.test.ts`, `server/src/telegram/bot.ts`, `server/src/telegram/bot.test.ts`, `server/src/http/telegram/webhook.ts`, `server/src/http/telegram/webhook.test.ts`, `server/scripts/telegram-webhook.ts`, `server/scripts/telegram-webhook.test.ts`
- Modify: `server/src/http/app.ts`, `server/package.json` (`"telegram:webhook": "tsx --conditions=source --env-file-if-exists=.env scripts/telegram-webhook.ts"`), `shared/src/i18n/locales/{uk,en,ru}.ts` (`telegram.bot.*`)
- Docs: `docs/API.md` §6 (decision 8), `docs/PROJECT_V2.md` §7 bot commands (decision 7), §12 (webhook registration)

**Interfaces:**

- Consumes: Tasks 1, 8, `consumeOneTimeToken`.
- Produces:

  ```ts
  type Command = { name: string; arg: string | null };
  parseCommand(text: string, botUsername: string): Command | null; // '/start@Bot code' → { start, 'code' }; other bot or not a command → null
  telegramUpdateSchema; // loose Zod: message { chat { id, type, title?, first_name?, last_name?, username? }, from? { language_code? }, text? }, my_chat_member { chat, new_chat_member { status } }
  type BotReply = { chatId: bigint; text: string };
  type BotDeps = { db: Db; clock: Clock; i18n: i18n; botUsername: string };
  handleUpdate(deps: BotDeps, update: TelegramUpdate): Promise<BotReply | null>;
  telegramWebhookRouter(deps: AppDeps): Router; // not in OpenAPI
  webhookRequest(env: { botToken: string; secret: string; apiUrl: string }, action: 'set' | 'info' | 'delete'): { url: string; body?: object };
  ```
  - i18n `telegram.bot.*`: `welcome`, `linked`, `alreadyLinked`, `linkExpired`, `status.{ONLINE,OFFLINE,PENDING,UPDATING}` (`🟢/🔴/⚪/🔄 {{name}} — … since {{time}}`, and PENDING `waiting for the first check-in`), `statusEmpty`, `stopped`, `notLinked`, `help`.
  - `/start <code>`: one transaction. `consumeOneTimeToken(…, 'TELEGRAM_LINK')` → `null` gives `linkExpired`. Otherwise it inserts the channel (decision 6), `on conflict` on the partial unique key gives `alreadyLinked`, and a new channel is linked to all devices `owner_id = user` and answered with `linked`. The reply uses the linking user's language.
  - Router: `POST /telegram/webhook/:secret` with `express.json`. Decision 8 checks. It parses with `safeParse`, where an invalid body → `200` empty. It calls `handleUpdate` inside try / catch (`logger.error`, `200` empty). A reply → `200 { method: 'sendMessage', chat_id: String(chatId), text }`.

- [ ] **Step 1: `commands.test.ts`:** `'/start abc'`, `'/start@TestBot abc'`, `'/START@testbot abc'` → `start abc`. `'/status@OtherBot'` → `null`. `'hello'` → `null`. `'/stop'` → `stop` with arg `null`.
- [ ] **Step 2: `bot.test.ts`** (PGlite, user `language: 'en'`, two owned devices):
  - A valid code in a private chat → `linked`. A channel named `John Smith` exists with the chat ID and is linked to both devices. The token is used.
  - The same code again → `linkExpired`. A code that expired at 15 min → `linkExpired`.
  - The same user links the same chat with a new code → `alreadyLinked`, and there is still one channel.
  - A group (`type: 'supergroup'`, title `Dacha chat`) with `/start@TestBot <code>` → the channel is named `Dacha chat` (Review Focus 4).
  - `/status` lists only the devices linked to this chat's channels, ordered by name, with the right icon and time in the user's timezone. A chat with no channels → `notLinked`. A linked chat with no devices → `statusEmpty`.
  - `/stop` → the chat's channels and their links are gone, the reply is `stopped`. `my_chat_member` `kicked` → the same with `null` reply. `/status@OtherBot` → `null`.
  - An unlinked chat with `language_code: 'ru'` → ru `welcome`. With `'de'` → uk.
- [ ] **Step 3: `webhook.test.ts`:**
  - Wrong path secret → `404`. Right path with a missing or wrong header → `404`.
  - A valid `/status` → `200` with the `sendMessage` body. A sticker message with no text → `200` with an empty body. A malformed body → `200` with an empty body.
  - `handleUpdate` throws (stub the db) → `200`, error logged.
  - The OpenAPI document has no `/telegram` path.
- [ ] **Step 4: `telegram-webhook.test.ts`:** `set` → `https://api.telegram.org/bot<token>/setWebhook` with `{ url: '<api>/telegram/webhook/<secret>', secret_token: <secret>, allowed_updates: ['message', 'my_chat_member'] }`. `info` → `getWebhookInfo`. `delete` → `deleteWebhook`. The CLI prints the JSON result.
- [ ] **Step 5: Run** → FAIL, implement, register the router before `notFound`, → PASS.
- [ ] **Step 6: Docs** per the Files list.
- [ ] **Commit point:** `server/src/telegram/ server/src/http/ server/scripts/telegram-webhook* server/package.json shared/src/i18n/ docs/` — `Add Telegram webhook and bot commands`

### Task 10: Worker acceptance scenarios

**Files:**

- Create: `server/src/notifications/acceptance.test.ts`

**Interfaces:**

- Consumes: everything above. Check-ins go through HTTP (`testApp` with PGlite, `FakeClock` and `notifications: createNotificationQueue(clock)`). Worker steps are called directly: `checkOffline`, `queueDueOffAlerts` and `processDueDeliveries` with a `FakeTelegramClient`. A helper `tick()` runs all three.

- [ ] **Step 1: Scenarios.** Each starts with a claimed device that is `ONLINE`, last seen at T = `2026-11-21T16:42:00Z`, owned by an en / `Europe/Kyiv` user with one linked platform channel.
  1. **Sustained loss:** `tick()` every 10 s.
     - Nothing is sent before T + 120 s.
     - At T + 120 s there is one send: `🔴 Home — device stopped checking in\nLast signal: 21 Nov 18:42`.
     - Later ticks send nothing more.
  2. **Short alerts off** (threshold 180 s):
     - The outage opens at T + 120 s with no send.
     - The 🔴 message is sent at T + 180 s.
  3. **Recovery after the OFF alert:** after scenario 1, a same-boot `PING` at T + 300 s, then `tick()`.
     - One 🟢 recovery message: `Offline for 5 min (18:42 → 18:47) · suspected network outage`.
     - The same happens with `notify_network_outages` off.
  4. **Recovery before the worker runs:** a same-boot `PING` at T + 125 s with no tick before it, then `tick()`.
     - One 🟠 summary: `Offline for 2 min (18:42 → 18:44) · suspected network outage`. No 🔴 is sent.
     - With `notify_network_outages` off, nothing is sent.
     - With short alerts off, nothing is sent, but the `SHORT` outage is still stored.
     - With short alerts off (threshold 180 s), an outage opened at T + 120 s and a recovery at T + 150 s → no 🔴 and no 🟠 message.
  5. **Retried check-ins:** resend the recovery `PING` from scenario 3 and run `recovery` / `offAlert` twice for the same outage → still one delivery per event and one send each.
  6. **Power blip:** `BOOT` with new boot `POWER_ON` at T + 25 s.
     - One 🟡 message, `25 s between check-ins`.
     - With short alerts off, nothing is sent.
  7. **Mass outage:** 300 devices across 30 users, each with their own channel, all past their deadline.
     - One `tick()` opens 300 outages and queues 300 deliveries.
     - Calling `processDueDeliveries` until it returns 0 sends all 300, each exactly once.
     - No 1 000 ms window of `sent[].at` holds more than 30 sends, and the span is at least 9 s.
  8. **Quiet hours** `23:00–07:00`: last seen at 21:28Z, and the 🔴 is sent at 21:30Z (23:30 Kyiv) → `silent: true`.

  The "worker skips locked rows" check is the real-Postgres test in Task 4.

- [ ] **Step 2: Run** → PASS (fix the owning task's code if a scenario fails).
- [ ] **Commit point:** `server/src/notifications/acceptance.test.ts` — `Add worker and Telegram acceptance tests`

### Task 11: OpenAPI coverage, docs and roadmap

**Files:**

- Modify: `server/src/http/openapi.test.ts`, `docs/ROADMAP.md`, `docs/API.md` §7 (tag order adds `Notifications`), §9 Q1–2

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: OpenAPI test:**
  - The document has `post /api/v1/channels/telegram-link`, `get /api/v1/channels` and `get|put /api/v1/devices/{id}/channels`, with `bearerAuth` security.
  - The tag order ends with `Outages, Notifications`.
  - `components.schemas` has `Channel`.
  - There is no `/telegram` path.
- [ ] **Step 2: Full check:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` all exit 0.
- [ ] **Step 3: Roadmap:**
  - Tick the M3 deliverables that merged.
  - Mark Q6 and Q7 ✅, with the recommendation text matching decisions 1 and 4.
  - The Q14 row gains "✅ M3: `POST /channels/telegram-link`, `GET /devices/:id/channels`".
  - Status board: M3 🟡 until the manual checks pass, then ✅.
- [ ] **Commit point:** `server/src/http/openapi.test.ts docs/` — `Complete M3 docs and OpenAPI coverage`

**M3 done when (ROADMAP):** the Task 10 scenarios pass (OFF alert at 120 s and after the threshold, recovery, one summary, no duplicate deliveries, the mass outage within 30 msg/s), and the Task 4 real-Postgres test shows the worker skipping locked rows.

Staging setup, done by hand:

- The API env gets `TELEGRAM_PLATFORM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`).
- The worker env gets `TELEGRAM_PLATFORM_BOT_TOKEN`.
- Deploy, then run `npm run telegram:webhook -w server -- set` once from `server/`, with the staging token, secret and `API_URL`.
- `npm run telegram:webhook -w server -- info` should show the staging URL and no `last_error_message`.

Verify by hand on staging:

- Call `POST /api/v1/channels/telegram-link` from Swagger UI, open `url` and press **Start**. The bot replies that the chat is linked, and `GET /api/v1/channels` lists the chat.
- Run the fake device (`npm run fake-device -- run`), stop it, and wait about 2 min. The 🔴 message arrives with the right local time.
- Start the fake device again. The 🟢 message arrives with the duration and the cause.
- `/status` lists the device as online. `/stop` unlinks it, and `GET /api/v1/channels` is empty.
- Add the bot to a group through `group_url`. `/status@<bot>` works in the group.
