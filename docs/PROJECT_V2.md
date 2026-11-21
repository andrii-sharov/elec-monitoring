# Electricity Monitor — Project Spec (v2: multi-user platform)

## 1. Goal

Turn [v1](archived/PROJECT_V1.md) into a platform for many users.

Anyone can buy a pre-flashed device from us, or buy their own ESP32-C3
and flash our firmware. They connect it to their home Wi-Fi and get
alerts when their device loses and restores contact. Advanced users get a REST
API, their own Telegram bots, webhooks and more control.

The device pings every 30 s by default. Missing pings indicate a loss of
contact. The server estimates the cause after the device reconnects.

The platform is **free** for all users for now.

## 2. Scope

### In v2

- Own auth: email + password and Google sign-in. Emails sent via
  Resend.
- Many devices per user, each with its own token and settings.
- Sharing a device with family members.
- Easy device setup: pre-flashed device or browser flashing, then Wi-Fi
  and pairing code on the device's own setup page.
- Notifications:
  - Telegram via the **platform bot** (simple, default),
  - Telegram via the **user's own bot** (advanced),
  - **Webhooks** (signed, with retries).
- Public **REST API** with user-generated API tokens and Swagger UI
  backed by a generated OpenAPI document.
- Outage classification:
  - **short** (blip) vs **long** outage, threshold adjustable per device,
  - estimated **power** vs **network** outage (using `uptime_s`).
- Statistics: number of outages, total / average downtime, availability
  % per day / week / month.
- Separate React apps for users and platform administrators.
- Remote device settings and signed firmware updates over Wi-Fi (OTA).
- Ukrainian, English and Russian translations stored by key in the repo.

### Architecture

- The React client, React admin app, ESP devices and external integrations
  connect to one Node.js/Express API. The API enforces access for each caller.
- PostgreSQL stores accounts, device ownership and sharing, device state and
  settings, outage history, update status and the notification queue.
- A separate worker uses the same database to detect missed pings, check
  update deadlines and deliver notifications. React apps and devices access
  platform data through the API.

## 3. Auth (custom)

Implemented in our Express server. No third-party auth service; Resend
only sends emails.

### Email + password

- Sign up → verification email (Resend) with a one-time link (valid
  24 h). Account can't add devices until the email is verified.
- Passwords hashed with **argon2id**.
- Forgot password → reset link by email (valid 1 h, single use). Reset
  logs out all sessions.
- Rate limits on sign up, log in, reset (per IP and per email).

### Google sign-in

- OAuth 2.0 / OpenID Connect, authorization code flow with PKCE.
- If a user with the same **verified** email exists, Google is linked
  to that account.
- A user can have both a password and Google linked.

### Sessions

- **Access token:** short-lived JWT (15 min), sent as
  `Authorization: Bearer`.
- **Refresh token:** random, 30 days, stored hashed, sent in an
  `httpOnly`, `Secure`, `SameSite=Lax` cookie. Rotated on every use;
  reuse of an old refresh token revokes the whole session.
- "Log out everywhere" in account settings.
- Needs a **custom domain** (e.g. `app.<domain>` for the client,
  `api.<domain>` for the server) so the cookie is first-party.
  `*.onrender.com` subdomains count as different sites, so cookies
  between them won't work reliably.

### Emails (Resend)

- Verify email, reset password, device-sharing invite, "webhook
  disabled" notice.
- Templates in all 3 languages.

## 4. Device

### Two ways to get a device

1. **Pre-flashed device (we sell it).** Firmware already on it. The user
   only does the setup page step below.
2. **Own ESP32-C3.** The client app has a "Flash firmware" page using
   **ESP Web Tools** (Web Serial, works in Chrome / Edge). The user
   plugs the ESP in via USB and clicks one button — no PlatformIO
   needed.

### Firmware

Same ping logic as v1, plus:

- **Setup mode (captive portal).** On first boot (or after holding the
  BOOT button for 5 s) the ESP starts its own Wi-Fi network
  `ElecMonitor-XXXX`. The user connects with a phone, a setup page opens,
  and they enter:
  - home Wi-Fi name and password,
  - **pairing code** from the client app.
- On first connect the ESP exchanges the pairing code for its permanent
  **device token** (`POST /api/device/claim`) and stores it in flash.
- Ping payload:
  ```json
  { "uptime_s": 12345, "rssi": -61, "fw": "2.0.0" }
  ```
- The server URL is built into the firmware.

### Remote configuration

The owner saves changes in the client app. The API stores the desired
settings in PostgreSQL. On its next check-in, the ESP fetches the current
settings and reports what it applied. The client app shows pending and
applied changes. Changes for an offline device wait for reconnection.

The ping interval defaults to 30 s and can be changed by the owner. The
server validates it against both the ping rate limit and the offline
timeout. Until the device confirms the change, the server allows for both
the previous and the new interval when checking for missed pings. Server
settings such as notification rules apply as soon as they are saved.

### Firmware distribution and OTA updates

Keep the firmware source private. A pre-flashed board ships with the
firmware installed. A user flashing their own board downloads the compiled
image in the browser. The initial firmware supports OTA so later releases
can be installed over Wi-Fi. Remote settings take effect independently of
firmware releases.

1. The device downloads a compatible signed release over HTTPS and verifies
   it before installation. It continues its normal check-ins while preparing
   the update.
2. Before rebooting, the device sends an authenticated update-start request
   with the target version. The server records the attempt and confirms a
   bounded update window. The device waits for that confirmation before
   rebooting. Retries reuse the same attempt and deadline.
3. During the window, the client and admin apps show `UPDATING`. The worker
   treats the planned interruption as maintenance and excludes it from
   outage notifications and statistics.
4. A check-in after reboot reporting the confirmed target version marks the
   update successful. If the new firmware fails its startup checks, the ESP
   rolls back. A return with the previous version marks the update as failed
   and the device as online.
5. If the device does not return before the deadline, it goes offline and
   the user receives an update-specific notification. Unplanned downtime
   starts at the deadline. Recovery follows the normal offline flow.

### Adding a device (user flow)

1. Client app → "Add device" → enter a name ("Home", "Dacha").
2. Server creates the device and shows a **pairing code** (8 chars,
   valid 30 min, single use).
3. Own ESP only: flash the firmware.
4. User enters Wi-Fi + pairing code on the ESP's setup page.
5. ESP claims the code → gets a device token → starts pinging.
6. Client app shows the device as 🟢 ONLINE.

## 5. Device state machine

```
          ping                         no ping for offline_timeout
 PENDING ──────► ONLINE ───────────────────────────────────────► OFFLINE
                   ▲                                                │
                   └──────────────────── ping ──────────────────────┘
```

- `PENDING`: created, never pinged.
- On ping: update last seen, uptime, RSSI, firmware version. If
  `OFFLINE` → `ONLINE`, close the open outage, queue notifications.
- `UPDATING` is shown while a confirmed OTA window is active. The worker
  also checks expired windows as described in §4.
- Worker checker (every 10 s): finds `ONLINE` devices whose last ping is
  older than their `offline_timeout` → `OFFLINE`, opens an outage,
  queues notifications. Rows are locked (`for update skip locked`) so a
  device is never processed twice.

**State lives in the DB**, not in memory (unlike v1). Any server
instance can handle any ping; restarts lose nothing.

### Outage classification

When the device reconnects, estimate the cause from its reported uptime:

- **cause**:
  - `POWER` — suspected power loss if `uptime_s` indicates a reboot.
    Other kinds of reboot can produce the same signal.
  - `NETWORK` — suspected network loss if `uptime_s` indicates the ESP
    stayed on throughout the gap.
  - `UNKNOWN` — insufficient uptime data or a missed update deadline.
- **kind**:
  - `SHORT` — duration < short-outage threshold
    (default **3 min**, adjustable per device),
  - `LONG` — otherwise.

### Device settings

- Name.
- Ping interval (30 s by default), applied by the device.
- Offline timeout (default 120 s).
- Short-outage threshold (default 3 min).
- Notify on short outages:
  - if off, the OFF alert is delayed until the threshold has passed,
  - if power returns before that → no messages, the outage is only
    stored.
- Notify on suspected network outages. The cause is estimated once the
  device reconnects, so this setting affects the recovery message.
- Quiet hours (optional): messages are sent silently
  (Telegram `disable_notification`).

## 6. Sharing a device

- The owner invites a person by email (Resend sends the invite link).
- Roles:
  - **Owner** — full control, one per device.
  - **Viewer** — sees status, outages and stats; connects **their own**
    notification channels to the device; can't change settings, re-pair
    or delete.
- The owner can remove a viewer at any time. A viewer can leave.
- Invite valid 7 days. If the person has no account, they sign up
  first, then the invite is applied.

## 7. Notifications

Each user has **channels** (platform Telegram, own bot, webhook) and
chooses which devices notify which channels. All sends go through a
queue (a Postgres table) processed by the worker, with a delivery log.

### Telegram — platform bot (default)

1. Client app → "Connect Telegram" → link
   `https://t.me/<PlatformBot>?start=<link_code>`.
2. User presses **Start** in Telegram.
3. Bot receives `/start <link_code>` (via Telegram webhook to our API)
   and saves the `chat_id` as a new channel.
4. Works for private chats and groups.

Bot commands: `/status` (all devices), `/stats` (last 7 days),
`/stop` (unlink).

### Telegram — user's own bot (advanced)

- User creates a bot with `@BotFather`, pastes the bot token and
  `chat_id` in the client app.
- Server checks the token (`getMe`) and sends a test message.
- Bot token is stored **encrypted** (AES-256-GCM, key in env).

### Webhooks

- User adds a URL and selects events (`device.offline`,
  `device.online`).
- Request:
  ```
  POST <user url>
  Content-Type: application/json
  X-Elec-Event: device.offline
  X-Elec-Delivery: <delivery id>
  X-Elec-Signature: sha256=<HMAC of body with webhook secret>

  {
    "event": "device.offline",
    "device": {"id": "...", "name": "Home"},
    "outage": {"id": 123, "started_at": "...", "ended_at": null,
               "duration_s": null, "cause": null, "kind": null},
    "sent_at": "..."
  }
  ```
- Success = any `2xx` within 10 s.
- Retries with backoff: 1 min, 5 min, 30 min, 2 h, 6 h → then `FAILED`.
- After 20 failures in a row the webhook is disabled and the user gets
  an email.
- "Send test" and "Redeliver" buttons in the client app.
- **SSRF protection:** only `https`, no private / localhost / link-local
  IPs (checked after DNS resolve).

### Message texts

Same as v1, plus device name and classification:

```
🔴 Home — device stopped checking in
Last signal: 21 Nov 18:42

🟢 Home — device is back online
Offline for 2 h 15 min (18:42 → 20:57) · suspected power outage
```

Texts in the user's language (uk / en / ru), times in the user's
timezone.

## 8. API

### Device endpoints (device token)

| Method | Path                | Purpose                                  |
| ------ | ------------------- | ---------------------------------------- |
| POST   | `/api/device/claim` | Pairing code → device token (once)       |
| POST   | `/ping`             | Ping (same as v1, so old firmware works) |

Updated firmware also uses the device token to fetch remote settings and
release information, report applied settings and announce an OTA update
before reboot. The v1 ping remains supported for migrated devices.

### Auth endpoints

| Method | Path                        | Purpose                     |
| ------ | --------------------------- | --------------------------- |
| POST   | `/api/auth/signup`          | Email + password sign up    |
| POST   | `/api/auth/verify-email`    | Confirm email with token    |
| POST   | `/api/auth/login`           | Email + password log in     |
| GET    | `/api/auth/google`          | Start Google sign-in        |
| GET    | `/api/auth/google/callback` | Google redirect target      |
| POST   | `/api/auth/refresh`         | New access token (cookie)   |
| POST   | `/api/auth/logout`          | End this session            |
| POST   | `/api/auth/logout-all`      | End all sessions            |
| POST   | `/api/auth/forgot-password` | Send reset email            |
| POST   | `/api/auth/reset-password`  | Set new password with token |

### Client app + public REST API

Same endpoints for both. Auth:

- client app → access JWT (`Authorization: Bearer <jwt>`),
- scripts → API token (`Authorization: Bearer em_live_...`).

Base path `/api/v1`. JSON. Errors:
`{"error": {"code": "not_found", "message": "..."}}`.

| Method | Path                           | Scope | Purpose                                                            |
| ------ | ------------------------------ | ----- | ------------------------------------------------------------------ |
| GET    | `/devices`                     | read  | Own + shared devices with state                                    |
| POST   | `/devices`                     | write | Create device → pairing code                                       |
| GET    | `/devices/:id`                 | read  | Device details                                                     |
| PATCH  | `/devices/:id`                 | write | Settings (owner only)                                              |
| DELETE | `/devices/:id`                 | write | Delete device (owner only)                                         |
| POST   | `/devices/:id/pairing-code`    | write | New pairing code (owner only)                                      |
| POST   | `/devices/:id/rotate-token`    | write | Invalidate device token (owner)                                    |
| GET    | `/devices/:id/outages`         | read  | Outages, filters: `from`, `to`, `kind`, `cause`; cursor pagination |
| GET    | `/devices/:id/stats`           | read  | Period (`day`, `week`, `month`), `from`, `to`                        |
| GET    | `/devices/:id/members`         | read  | Owner + viewers                                                    |
| POST   | `/devices/:id/invites`         | write | Invite by email (owner only)                                       |
| DELETE | `/devices/:id/members/:userId` | write | Remove viewer / leave                                              |
| POST   | `/invites/:token/accept`       | —     | Accept invite (JWT only)                                           |
| GET    | `/channels`                    | read  | List channels                                                      |
| POST   | `/channels`                    | write | Add channel (own bot, webhook)                                     |
| PATCH  | `/channels/:id`                | write | Update / enable / disable                                          |
| DELETE | `/channels/:id`                | write | Delete channel                                                     |
| POST   | `/channels/:id/test`           | write | Send test message                                                  |
| PUT    | `/devices/:id/channels`        | write | Set which of my channels this device uses                          |
| GET    | `/channels/:id/deliveries`     | read  | Delivery log                                                       |
| POST   | `/deliveries/:id/redeliver`    | write | Retry a delivery                                                   |
| GET    | `/tokens`                      | —     | List API tokens (JWT only)                                         |
| POST   | `/tokens`                      | —     | Create token, shown **once** (JWT only)                            |
| DELETE | `/tokens/:id`                  | —     | Revoke token (JWT only)                                            |
| GET    | `/me`                          | read  | Profile                                                            |
| PATCH  | `/me`                          | —     | Name, timezone, language (JWT only)                                |
| DELETE | `/me`                          | —     | Delete account (JWT only)                                          |

API tokens can't manage other API tokens, invites or the account — only
a logged-in user (JWT) can.

Stats response example:

```json
{
  "period": "week",
  "from": "2026-11-16T00:00:00Z",
  "to": "2026-11-23T00:00:00Z",
  "outages": 7,
  "long_outages": 3,
  "total_downtime_s": 28800,
  "avg_outage_s": 4114,
  "longest_outage_s": 14400,
  "availability_pct": 95.24
}
```

The Express server generates the public OpenAPI document from route and
request/response schemas, including authentication, errors and examples.
Swagger UI loads the generated document so integrators can read the API
reference and try requests with their own API token.

### Rate limits

| Who            | Limit              |
| -------------- | ------------------ |
| `/ping`        | 6 / min per device |
| API token      | 60 / min per token |
| Client app JWT | 120 / min per user |
| Auth / claim   | 10 / min per IP    |

`429` with `Retry-After` when exceeded.

## 9. Client app (React)

Vite + React + TypeScript, React Router, TanStack Query. All data goes
through our API.

Pages:

- **Sign up / Log in / Google sign-in / Verify email / Reset password**
- **Devices** — cards with 🟢 / 🔴 / ⚪, "since", last seen; shared
  devices marked.
- **Device** — status, timeline of outages, stats (day / week / month),
  settings and their applied status, firmware version and update result,
  members & invites, channels, "re-pair", "rotate token", "delete".
- **Add device** — wizard: name → pairing code → (flash) → wait for
  first ping.
- **Flash firmware** — ESP Web Tools.
- **Notifications** — connect platform Telegram bot, add own bot, add
  webhook, delivery log.
- **API tokens** — create (shown once), list, revoke.
- **API docs** — Swagger UI backed by the generated OpenAPI document.
- **Account** — name, timezone, language, linked Google, log out
  everywhere, delete account.

### Admin app (React)

A separate app for platform staff uses the same Express API. Admin routes
require a signed-in account with a platform administrator role checked by
the server. The initial app is read-only and shows:

- Platform health, API errors and background worker status.
- Device counts by state and a searchable device list with last check-in,
  firmware version and update result.
- Notification queue depth and recent delivery failures.

### Localization

Keep keyed dictionaries for Ukrainian (`uk`), English (`en`) and Russian
(`ru`) in the repository. Use them for both React apps and server-generated
messages, including emails and Telegram notifications. Translations ship
with the app and server releases.

## 10. Security

- HTTPS everywhere (Render).
- Passwords: argon2id. Email verification required.
- Refresh tokens rotated with reuse detection; access JWT 15 min.
- Device tokens, API tokens, refresh tokens: random 32 bytes, only
  SHA-256 hash stored. API tokens have a prefix (`em_live_`) so leaked
  tokens are easy to find.
- Bot tokens and webhook secrets encrypted at rest (AES-256-GCM).
- Every query checks the user's access (owner / viewer); tests check
  that user A can't read user B's data.
- Supabase Row Level Security turned **on** for all tables with no
  public policies, so the anon key can't read anything. Only our server
  talks to the DB.
- Webhook SSRF protection (see §7).
- Account deletion removes all owned devices, outages, channels, tokens,
  and memberships.

## 11. Scale

Rough numbers to plan for:

- 1 000 devices × 1 ping / 30 s ≈ **33 pings/s** → one small `UPDATE`
  each. Fine for one server instance and Supabase.
- 10 000 devices ≈ 330 pings/s → need several server instances and to
  check DB load. If needed, last-seen times can move to Redis later.
- A **mass outage** (a whole district goes dark) creates many
  notifications at once. They go through the queue, and the worker
  respects Telegram limits (~30 msg/s per bot).

## 12. Deployment

| What       | Where                     |
| ---------- | ------------------------- |
| API        | Render Web Service (paid) |
| Worker     | Render Background Worker  |
| Client app | Render Static Site        |
| Admin app  | Render Static Site        |
| Database   | Supabase (Postgres)       |
| Emails     | Resend                    |

- The worker runs the checker and sends Telegram messages and webhooks.
  It runs as one instance, so nothing is sent twice; the API can scale
  to several instances.
- API and worker share one codebase, started with different commands
  (`npm run start:api`, `npm run start:worker`).
- `render.yaml` blueprint for all Render services.
- Custom domains for the React apps and API: `app.<domain>`, `admin.<domain>`,
  and `api.<domain>`.
- Supabase: use the pooler connection string.
- Two environments: `staging` and `production`.
- Migrations: SQL files in the server, run on deploy.
- Telegram platform bot webhook points to
  `https://api.<domain>/telegram/webhook/<secret>`.

### Config (environment variables)

```
DATABASE_URL=...
JWT_SECRET=...
ENCRYPTION_KEY=...                 # 32 bytes, base64
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
RESEND_API_KEY=...
EMAIL_FROM=...
TELEGRAM_PLATFORM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
CLIENT_URL=https://app.<domain>
API_URL=https://api.<domain>
```

## 13. Migration from v1

- The v1 device becomes the first device of the owner's account.
- Its existing `DEVICE_TOKEN` is hashed and stored, so the ESP keeps
  working without reflashing. Remote configuration and OTA require a one-time
  upgrade to firmware that supports those features.
- v1 has no database or saved event history. Outage history starts in v2.

## 14. Repo layout

```
elec-monitoring/
  docs/
    archived/
  firmware/
  server/
  client/
  admin/
```

## 15. Milestones

1. **Auth:** email + password, email verification and reset (Resend),
   Google sign-in, sessions.
2. **Devices:** CRUD, device token pings, state in DB.
3. **Worker:** checker, outages, classification, platform Telegram bot.
4. **Client app:** log in, devices list, device page, add-device flow.
5. **Device setup:** captive portal + pairing code + browser flashing.
6. **Sharing:** invites, viewer role.
7. **API integrations:** API tokens, public REST API, generated OpenAPI and
   Swagger UI.
8. **Own Telegram bot + webhooks** with delivery log and retries.
9. **Statistics** in API, client app and `/stats` bot command.
10. **Admin app:** read-only monitoring of the API, worker, devices and
    notification queue.
11. **Remote device management:** settings sync, signed OTA, update-start
    confirmation, rollback and monitoring through the update window.
12. **Launch readiness:** rate limits, access tests, staging, v1 migration,
    keyed translations (uk / en / ru).
