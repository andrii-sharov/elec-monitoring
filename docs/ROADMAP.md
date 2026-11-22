# Electricity Monitor — v2 Roadmap

The build plan and progress tracker for v2. What to build is defined in
[PROJECT_V2.md](PROJECT_V2.md), [API.md](API.md) and
[DATABASE.md](DATABASE.md). This file covers the order of work, what
"done" means for each milestone, and where the project stands.

References: **P** = PROJECT_V2, **A** = API, **D** = DATABASE, e.g. P §5.

## How to use this file

- Work milestone by milestone. The "Depends on" column shows what can
  run in parallel.
- Before starting a milestone, write its detailed task plan in
  `docs/plans/MNN-<name>.md` (files, interfaces, tests per task) and link
  it in the status board.
- Tick a deliverable when its change is merged with CI green.
- Mark a milestone ✅ only when every "Done when" check holds, including
  the manual checks (👤).
- When a question below is decided, record it in the spec and mark the
  row ✅.

Status: ⬜ not started · 🟡 in progress · ✅ done · ⛔ blocked

## Status board

| #   | Milestone                                                             | Status | Depends on | Plan                           |
| --- | --------------------------------------------------------------------- | ------ | ---------- | ------------------------------ |
| M0  | [Foundation](#m0--foundation)                                         | ✅     | —          | [M00](plans/M00-foundation.md) |
| M1  | [Auth](#m1--auth)                                                     | 🟡     | M0         | [M01](plans/M01-auth.md)       |
| M2  | [Devices and check-ins](#m2--devices-and-check-ins)                   | ⬜     | M1         | —                              |
| M3  | [Worker and platform bot](#m3--worker-and-platform-telegram-bot)      | ⬜     | M2         | —                              |
| M4  | [Client app](#m4--client-app)                                         | ⬜     | M3         | —                              |
| M5  | [Firmware core and device setup](#m5--firmware-core-and-device-setup) | ⬜     | M2         | —                              |
| M6  | [Sharing](#m6--sharing)                                               | ⬜     | M4         | —                              |
| M7  | [API tokens and public API](#m7--api-tokens-and-public-rest-api)      | ⬜     | M4         | —                              |
| M8  | [Own bot and webhooks](#m8--own-telegram-bot-and-webhooks)            | ⬜     | M4         | —                              |
| M9  | [Statistics](#m9--statistics)                                         | ⬜     | M4         | —                              |
| M10 | [Admin app](#m10--admin-app)                                          | ⬜     | M4         | —                              |
| M11 | [Remote management and OTA](#m11--remote-device-management-and-ota)   | ⬜     | M4, M5     | —                              |
| M12 | [Launch readiness](#m12--launch-readiness)                            | ⬜     | all        | —                              |

M5 (firmware) can run alongside M3–M4 once the check-in endpoints exist.

**Release constraint:** P §4 says the first firmware must support OTA.
The partition table and the signature-verifying key can't be changed
later over OTA, so M5 fixes both. No device goes to a user before M11
is done.

## Decisions

Open questions from the specs, matched to the milestone they block.
✅ marks a decided question. The decision itself lives in the spec.

| #   | Question                                                                                                | Blocks        | Source               | Recommendation                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- | ------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | ✅ UUIDv7: Postgres `uuidv7()` or generated in the server                                               | M0            | D §1                 | Generated in the server (Drizzle `$defaultFn`).                                                                                                                   |
| Q2  | ✅ Test database                                                                                        | M0            | CLAUDE.md            | PGlite in-process for most tests. Lock and `skip locked` tests run against real Postgres as a CI service.                                                         |
| Q3  | ✅ Where shared code lives (i18n dictionaries, shared enums)                                            | M0            | P §9, §13            | npm workspace `shared/`.                                                                                                                                          |
| Q4  | ✅ Rate limit counter store                                                                             | M1            | D §12 Q4             | Postgres table behind a small `RateLimiter` interface. Swap to Redis if several API instances make it a hotspot.                                                  |
| Q5  | ✅ Parent domain and staging host names                                                                 | M1            | P §3, §12            | Pick before Google sign-in work. It also sets OAuth redirect URIs and CORS origins.                                                                               |
| Q6  | Notification rules and quiet-hours timezone for viewers                                                 | M3            | A §9 Q1–2, D §12 Q1  | Per-recipient rules (`device_notification_rules`), quiet hours in the recipient's timezone. Decide before M3 so fan-out is built once.                            |
| Q7  | Retention for `delivery` and `device_diagnostic`                                                        | M3            | D §12 Q2             | 90 days.                                                                                                                                                          |
| Q8  | Firmware image storage                                                                                  | M5            | A §9 Q4, D §12 Q3    | Private Supabase Storage bucket. Browser flashing in M5 already needs it, not only OTA.                                                                           |
| Q9  | Who publishes releases, and what "compatible release" means                                             | M5            | A §9 Q3, D §12 Q3    | CI job on a firmware tag builds, signs, uploads and adds a draft release. A script publishes it. One board type means every newer `STABLE` release is compatible. |
| Q10 | OTA signature scheme and key custody                                                                    | M5            | P §4                 | ECDSA P-256 over the image SHA-256. Private key only in CI secrets. Public key compiled into the first firmware.                                                  |
| Q11 | Admin "API error rate" source                                                                           | M10           | A §5, D §8           | Each API instance upserts a per-minute 5xx counter row, written only on errors.                                                                                   |
| Q12 | OTA maintenance window length                                                                           | M11           | P §4 (not specified) | 10 min (matches the A §2 example).                                                                                                                                |
| Q13 | Spec fixes: webhook example outage `"id": 123` → UUID (P §7); add `CANCELLED` to `update.status` (A §4) | M8, M11       | A §9, D §12 Q5       | Accept both.                                                                                                                                                      |
| Q14 | Endpoints marked **(proposed)** in API.md                                                               | per milestone | A §9                 | Accept or drop each one in the milestone plan that uses it, then remove the marker. ✅ M1: `resend-verification`, `change-password`, `DELETE /api/auth/google`.   |
| Q15 | Email change                                                                                            | —             | A §9 Q5              | Out of scope for v2.                                                                                                                                              |

## Definition of done (every task)

- Vitest tests cover the behaviour. Time-based logic uses a controlled
  clock with no real HTTP, Telegram or Resend calls.
- Every endpoint that touches user data has access tests: stranger,
  viewer and owner (and admin where relevant).
- `npm run lint`, `npm run fmt:check`, type check, build and tests pass
  locally and in CI.
- API.md, DATABASE.md or DEVICE_STATUS.md is updated in the same change
  when an endpoint, table, LED state or log line changes.
- User-facing text uses i18n keys present in uk, en and ru.
- Migration SQL is reviewed and compatible with the running version
  (D §11).
- Manual checks (👤: real device, browser, staging) are listed and done
  by hand, not by Claude.

## Risks to watch

- **Supabase transaction pooler:** no prepared statements, session
  state, `listen` or session advisory locks (D §9).
- **Single worker instance:** if it stops, no alerts go out. The
  heartbeat (M0) and the admin health view (M10) make this visible.
- **Mass outage:** a district going dark floods the queue. Telegram
  allows ~30 msg/s per bot (P §11).
- **Cookies across subdomains:** test refresh, logout and CORS on
  staging early (M1), not at launch.
- **First firmware is permanent:** the partition layout and OTA key ship
  in M5 and can't be fixed over the air.

---

## M0 — Foundation

**Goal:** a deployable, empty API and worker with the schema, CI and the
shared building blocks every later milestone uses.
**Spec:** P §2 Architecture, §12, §13 · D §1, §10, §11 · A §1, §7.

- [x] Root oxlint and oxfmt config
- [x] npm workspaces `server/` and `shared/`; `server/` with TypeScript
      (`tsc` build), `tsx` dev, Vitest; root lint and format scripts
      cover both
- [x] Env config validated with Zod (P §12 Config); startup fails on a
      missing value
- [x] Express 5 app factory with injected dependencies (db, clock,
      senders); error handler emits the A §1 error shape, including
      `validation_error` details from Zod and `not_found`
- [x] `GET /health` (`200 {"status":"ok"}` when the DB is reachable)
- [x] Drizzle with postgres.js (`prepare: false`, `casing: "snake_case"`),
      the full D schema, first migration with RLS on and `anon` /
      `authenticated` privileges revoked
- [x] Test DB harness: PGlite with a fresh migrated DB per test file;
      Postgres service in CI for lock tests
- [x] `Clock` interface used by all time-based code
- [x] Helpers: server-generated UUIDv7 IDs, random 32-byte tokens,
      SHA-256 hashing, AES-256-GCM (`nonce || ciphertext || tag`)
- [x] i18n: uk / en / ru dictionaries in `shared/`, server i18next
      setup, key-parity test
- [x] OpenAPI registry with zod-openapi: `GET /api/v1/openapi.json`,
      Swagger UI at `/api/docs`
- [x] Worker entry point: loop runner, `worker_heartbeat` upsert,
      graceful shutdown; `start:api` and `start:worker` scripts
- [x] GitHub Actions: `npm ci`, lint, format check, type check, build,
      tests; required on pull requests

**Done when:** CI is green on a pull request. Tests migrate a fresh DB,
`/health` passes, and the i18n parity test passes. 👤 Review the first
migration SQL.

## M1 — Auth

**Goal:** accounts with email + password and Google, sessions, profile.
**Spec:** P §3, §10 · A §3, §4 Account · D §3.
**Needs:** Q4, Q5.

- [x] Email sender interface: Resend implementation and a test fake;
      verify and reset templates in uk / en / ru
- [x] Sign up (no email enumeration), verify email (24 h, single use),
      resend verification
- [x] Log in with argon2id; sessions; refresh token rotation with reuse
      detection; cookie `httpOnly`, `Secure`, `SameSite=Lax`, scoped to
      the API host
- [x] CORS with credentials for `CLIENT_URL` and `ADMIN_URL` only;
      `Origin` check on `refresh` and `logout`
- [x] Access JWT (jose, 15 min, session ID claim); `requireUser` and
      `requireVerifiedEmail` middleware
- [x] Log out, log out everywhere, forgot / reset password (1 h, single
      use, revokes all sessions), change password
- [x] Google sign-in with arctic: PKCE, signed state cookie, link to a
      verified email, `intent=LINK`, unlink (`409` if it's the only
      method), redirect allowlist
- [x] `GET`, `PATCH`, `DELETE /me`
- [x] Rate limiter per Q4 on sign up, log in, reset and claim (per IP
      and per email), `429` with `Retry-After`
- [ ] Staging: `render.yaml` (API + worker), Supabase staging project,
      domains, migrations run, deploy after CI

**Done when:** tests cover link expiry with a controlled clock, single
use, refresh reuse revoking the session, rate limiting and no
enumeration. 👤 Sign up, verify the email, sign in with Google and
refresh the session on the staging domains.

## M2 — Devices and check-ins

**Goal:** owners create devices, devices claim and check in, state lives
in the DB.
**Spec:** P §4 Monitoring signals, Wi-Fi diagnostics, Adding a device;
P §5 · A §2 claim and ping, §4 Devices, Outages · D §4, §6.

- [ ] Device CRUD (owned devices only until M6): create with pairing
      code (8 chars, 30 min, single use), list, get, patch (A §4
      validation, `settings_version` bump), delete, new pairing code,
      rotate token
- [ ] Device token auth; `POST /api/v1/device/claim`
- [ ] `POST /api/v1/device/ping` steps 1–8 (A §2) in one transaction
      with the device row locked: dedupe, `PENDING` → `ONLINE`,
      `OFFLINE` → `ONLINE`, power blip, late recovery before the worker
      runs, Wi-Fi diagnostics, live state and `offline_at`
- [ ] Classification as pure functions: cause (`POWER` / `NETWORK` /
      `UNKNOWN`, using overlapping Wi-Fi diagnostics) and kind (`SHORT` /
      `LONG`)
- [ ] Notification queueing as an interface with a no-op implementation
      (M3 implements it)
- [ ] Check-in rate limit, 6 / min per device
- [ ] `GET /devices/:id/outages` (cursor pagination, filters) and
      `GET /devices/:id/diagnostics`
- [ ] Fake-device script (`server/scripts/`) that claims and pings, for
      manual staging checks before firmware exists

**Done when:** controlled-clock tests cover the server side of the
P §5 acceptance list: first boot, regular pings, power reset before the
timeout (the 25 s example stays `ONLINE` with a `SHORT` `POWER` blip),
Wi-Fi-only interruption, software reset (no blip), duplicates (no
`last_seen_at` change, no duplicate diagnostics), recovery after the
timeout before the worker runs. 👤 Run the fake device on staging.

## M3 — Worker and platform Telegram bot

**Goal:** missed pings become outages and alerts reach Telegram.
**Spec:** P §5 worker and notification settings, §7 platform bot and
message texts, §11 · A §4 Channels, §6 · D §7, §9, §10 Cleanup.
**Needs:** Q6, Q7.

- [ ] Offline checker every 10 s: `skip locked`, re-check after the
      lock, open the outage, set `off_alert_due_at` per
      `notify_short_outages`
- [ ] Due OFF alerts queued; recovery, summary and power blip queueing
      (implements the M2 interface); at most one summary per completed
      interruption
- [ ] Fan-out to the device's linked channels with
      `on conflict do nothing`
- [ ] Delivery worker: lease-based claim, send outside the transaction,
      write the result; platform bot sender at ≤ 30 msg/s; quiet hours
      send with `disable_notification`
- [ ] Message rendering (P §7 texts) in the recipient's language and
      timezone
- [ ] `/telegram/webhook/:secret` with the secret header check;
      `/start <code>`, `/status`, `/stop`
- [ ] `POST /channels/telegram-link`, `GET /channels`,
      `GET` / `PUT /devices/:id/channels`
- [ ] Daily cleanup job (D §10, retention per Q7)

**Done when:** controlled-clock tests cover sustained loss → OFF alert at
120 s (and after the threshold when short alerts are off), recovery
after an OFF alert, recovery with no OFF alert → one summary, retried
check-ins not duplicating deliveries, the worker skipping locked rows,
and a mass outage staying within the send rate. 👤 Link Telegram on
staging, stop the fake device, and receive the OFF and ON messages.

## M4 — Client app

**Goal:** users sign in, add a device and watch it, in the browser.
**Spec:** P §9 Client app, Localization · P §12 Vercel.

- [ ] `client/`: Vite, React, TypeScript, React Router, TanStack Query,
      shadcn/ui on Tailwind, React Hook Form + Zod, i18next with the
      shared dictionaries; CI builds it
- [ ] API client: access token in memory, refresh through the cookie on
      load and on `401`
- [ ] Sign up, log in, Google, verify email, forgot and reset password
- [ ] Devices list; Device page (status, outage timeline, settings,
      re-pair, rotate token, delete); Add-device wizard (name → pairing
      code → wait for the first check-in)
- [ ] Connect platform Telegram and choose channels per device
- [ ] Account: name, timezone, language, Google link / unlink, change
      password, log out everywhere, delete account
- [ ] Vercel project with SPA fallback; staging API URL per environment

**Done when:** component tests cover form validation and token refresh.
👤 Walk every page on staging, including a deep link reload.

## M5 — Firmware core and device setup

**Goal:** a real ESP32-C3 is set up from a phone and checks in.
**Spec:** P §4 Two ways, Firmware, Monitoring signals, Wi-Fi diagnostics,
Flash storage · A §2 claim and ping, §4 Firmware manifest ·
DEVICE_STATUS.md.
**Needs:** Q8, Q9, Q10.

- [ ] PlatformIO project; server URL built in; firmware build and
      native unit tests in CI
- [ ] Partition table with two OTA slots and the embedded verifying key
      (fixed for the life of the device)
- [ ] Setup mode: `ElecMonitor-XXXX` captive portal on first boot or
      after holding BOOT for 5 s; Wi-Fi and pairing code form
- [ ] Claim; NVS for Wi-Fi, token and settings; no flash writes on pings
- [ ] Check-ins: `boot_id`, `seq`, uptime, reset reason mapping, RSSI,
      firmware version; `BOOT` retry with backoff and `Retry-After`,
      same `boot_id` and `seq`; one request at a time
- [ ] Wi-Fi diagnostics: coalesced interruptions, 16-record ring buffer
      within 512 bytes, eviction counter, `API` kind, remove only
      acknowledged records
- [ ] LED and serial log states in DEVICE_STATUS.md
- [ ] Release image stored per Q8; `GET /firmware/manifest.json`;
      client "Flash firmware" page with ESP Web Tools

**Done when:** native tests cover the ring buffer, reset reason mapping
and backoff. 👤 On the real board: setup portal, claim, `ONLINE` in
the app; brief and sustained power cuts; router restart; Wi-Fi-only
loss; more than 16 Wi-Fi interruptions; heap during reconnect; browser
flashing in Chrome (P §5 hardware checks).

## M6 — Sharing

**Goal:** owners share devices with family as viewers.
**Spec:** P §6 · A §4 Sharing · D §4 `device_viewer`, `device_invite`.
**Needs:** Q6.

- [ ] Invites: create (upsert), list, revoke; email in the recipient's
      language or `uk`; preview; accept (7 days, matching email)
- [ ] Members list; remove viewer or leave (also removes the viewer's
      `device_channel` rows)
- [ ] Viewer access on every device endpoint; `GET /devices` includes
      shared devices with their role
- [ ] Fan-out includes viewers' own channels, language, timezone and
      rules per Q6
- [ ] Client: members and invites on the Device page, invite page with
      sign-up-then-accept, shared marker in the list

**Done when:** a role matrix test (owner / viewer / stranger × every
device endpoint), invite expiry with a controlled clock and the
sign-up-then-accept flow pass. 👤 Invite a second account on staging.

## M7 — API tokens and public REST API

**Goal:** scripts use the same API with tokens; integrators get docs.
**Spec:** P §8, §10 · A §1 Auth headers and Rate limits, §4 API tokens,
§7.

- [ ] API tokens: create (`em_live_` prefix, shown once, hash stored),
      list, revoke; `last_used_at` at most once a minute
- [ ] Auth accepts a JWT or an API token; `insufficient_scope` and
      `jwt_required`
- [ ] Rate limits: 60 / min per token, 120 / min per user JWT
- [ ] OpenAPI complete: security schemes, errors and examples for every
      public endpoint; admin routes excluded
- [ ] Client: API tokens page and API docs page

**Done when:** a scope matrix test passes, the OpenAPI document
validates, and a test fails if a public route is missing from it.
👤 Call the API with a token from Swagger UI.

## M8 — Own Telegram bot and webhooks

**Goal:** advanced users get their own bot and signed webhooks.
**Spec:** P §7 · A §4 Channels, §8 · D §7.
**Needs:** Q13.

- [ ] Own bot channel: `getMe` and test message, token encrypted and
      never returned
- [ ] Webhook channel: SSRF guard (`https` only, no private, loopback or
      link-local IPs after DNS, checked again at send time), secret shown
      once, rotate secret
- [ ] Webhook delivery: HMAC signature headers, 10 s timeout, retries at
      1 min, 5 min, 30 min, 2 h, 6 h, then `FAILED`; disable after 20
      failures in a row and email the owner
- [ ] Channel CRUD, enable / disable, test, delivery log, redeliver with
      the same delivery ID
- [ ] Client: full Notifications page

**Done when:** tests cover SSRF ranges (IPv4 and IPv6) and redirects,
a signature test vector, the retry schedule with a controlled clock,
disabling on the 20th failure, and redeliver keeping its ID. 👤 Connect
an own bot and a webhook receiver on staging.

## M9 — Statistics

**Goal:** outage counts, downtime and availability per day, week, month.
**Spec:** P §2 Statistics, §5 Power blips · A §4 Outages and stats.

- [ ] Stats from `outage`: periods in the caller's timezone, buckets,
      availability, `by_cause`, power blips counted separately, outages
      clipped to the range, open outage counted up to now
- [ ] `GET /devices/:id/stats`; `/stats` bot command (last 7 days)
- [ ] Client: stats and charts on the Device page

**Done when:** tests cover a DST change (a zone with DST), an outage
spanning bucket edges, and an open outage. 👤 Check the charts.

## M10 — Admin app

**Goal:** platform staff see health, devices and the notification queue.
**Spec:** P §9 Admin app · A §5 · D §8.
**Needs:** Q11.

- [ ] Admin endpoints (A §5) behind `requireAdmin`, not in OpenAPI
- [ ] Script to grant `is_admin`
- [ ] `admin/` app (same stack, read-only) and its Vercel project

**Done when:** every admin route rejects non-admins (test). 👤 Browse
the admin app on staging.

## M11 — Remote device management and OTA

**Goal:** owners change device settings and install signed firmware over
Wi-Fi.
**Spec:** P §4 Remote configuration, Firmware distribution and OTA;
P §5 `UPDATING` · A §2, §4 Firmware · D §5.
**Needs:** Q9, Q12, Q13.

Server:

- [ ] `GET /device/settings`, `POST /device/settings/applied`,
      `X-Settings-Version`; old and new interval allowed until applied
- [ ] Releases: publish flow per Q9, `GET /firmware/releases`,
      `firmware.available` on the device
- [ ] Install queue (`POST` / `DELETE /devices/:id/firmware-update`),
      `X-Firmware-Update: pending`, `GET /device/updates/pending` for
      manual and automatic OTA, firmware download with `Range`
- [ ] `update_started` and `update_finished` per A §2; OTA boot becomes
      the new baseline; `last_seen_at` never advanced
- [ ] Worker deadline check: `UPDATING` → `OFFLINE`, outage with
      `ota_attempt_id` and cause `UNKNOWN`, update-specific notification

Firmware:

- [ ] Settings sync and report applied
- [ ] Update check after boot or reconnect and hourly with jitter;
      header trigger
- [ ] OTA: persisted attempt, `update_started`, pause pings, streamed
      download to the inactive slot, verify SHA-256 and signature,
      reboot, self-check then confirm or roll back, persisted result
      until acknowledged

Client:

- [ ] Firmware version, update available, Install, automatic updates,
      update status and result, pending and applied settings

**Done when:** controlled-clock tests cover the P §5 OTA list: success,
rollback, duplicate start and result, result after the deadline, no
`last_seen_at` change from OTA reports, no power blip from a planned
reboot. 👤 On the real board: successful OTA, forced rollback,
power cut during download, heap during OTA.

## M12 — Launch readiness

**Goal:** production is live and verified.
**Spec:** P §10, §12 CI/CD · A §1 Rate limits.

- [ ] Rate limit review across all endpoints, shared store confirmed for
      several instances
- [ ] Access audit: a test fails if any route lacks access tests
- [ ] Translation review uk / en / ru
- [ ] Security review and dependency audit
- [ ] Production: Supabase, Render API and worker, Vercel apps, domains,
      Telegram webhook, Resend domain
- [ ] CI/CD: staging smoke tests (health, auth refresh, device check-in,
      client deep link) gate production releases

**Done when:** production smoke tests pass. 👤 Run an end-to-end check
on production with a real device, and have a native speaker review each
translation.
