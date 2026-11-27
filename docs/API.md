# Electricity Monitor — API (v2)

The source of truth for every v2 API endpoint: paths, auth, request and
response shapes, status codes and behaviour. Product behaviour behind
the endpoints (state machine, OTA rules, notifications) is in
[PROJECT_V2.md](PROJECT_V2.md).

Endpoints marked **(proposed)** fill gaps found in review and are not
agreed yet. See [§9](#9-review-gaps-and-open-questions). Remove the
marker once a proposal is accepted.

## 1. Conventions

### Hosts and prefixes

| Prefix                        | Callers                   | Auth                               |
| ----------------------------- | ------------------------- | ---------------------------------- |
| `/api/v1/device/*`            | ESP devices (v2 firmware) | Device token (claim: pairing code) |
| `/api/auth/*`                 | Client and admin apps     | Credentials, refresh cookie        |
| `/api/v1/*` (other paths)     | Client app                | Access JWT                         |
| `/api/admin/*` **(proposed)** | Admin app                 | Access JWT + platform admin role   |
| `/telegram/webhook/:secret`   | Telegram                  | Secret in path                     |
| `/health`                     | Render, CI smoke tests    | None                               |

All hosted at `https://api.<domain>`. JSON bodies, UTF-8.

### Auth headers

| Caller     | Header                                        |
| ---------- | --------------------------------------------- |
| Device     | `Authorization: Bearer <device token>`        |
| Client app | `Authorization: Bearer <access JWT>` (15 min) |

### Errors

```json
{ "error": { "code": "not_found", "message": "Device not found" } }
```

`message` is English and for developers. Apps translate by `code`.
Validation errors add `details`:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request",
    "details": [{ "path": "settings.ping_interval_s", "code": "too_small", "min": 15 }]
  }
}
```

| HTTP | `code`                | When                                                                         |
| ---- | --------------------- | ---------------------------------------------------------------------------- |
| 400  | `validation_error`    | Body, query or path fails the schema                                         |
| 400  | `url_not_allowed`     | A webhook URL that is not public `https` (see Notification channels)         |
| 401  | `unauthorized`        | Missing, invalid or expired token                                            |
| 403  | `forbidden`           | Authenticated, but the role does not allow it (e.g. viewer edits settings)   |
| 401  | `invalid_credentials` | Log in with a wrong email or password (the same answer for both)             |
| 403  | `invalid_credentials` | A signed-in user's password re-check fails (change password, delete account) |
| 403  | `reauth_required`     | Google-only account deletes itself more than 5 min after sign-in             |
| 403  | `not_verified`        | Account without a verified email or phone creates a device                   |
| 404  | `not_found`           | Missing, or the caller has no access (do not leak existence)                 |
| 409  | `conflict`            | State does not allow the action (see each endpoint)                          |
| 410  | `expired`             | Pairing code, invite or email link expired or used                           |
| 429  | `rate_limited`        | Limit exceeded, with `Retry-After`                                           |
| 500  | `internal`            | Unexpected error                                                             |

### Formats

- Timestamps: ISO 8601 UTC, e.g. `2026-11-21T16:42:00Z`.
- Durations: integer seconds, fields end with `_s`.
- IDs: UUID strings for all resources.
- Enum values are `UPPER_CASE` in payloads and query parameters: `ONLINE`,
  `POWER`, `SHORT`. Standard values keep their own spelling: language
  codes (`uk`), webhook event names (`device.offline`), error codes
  (`not_found`) and HTTP header values.
- Lists use cursor pagination: `?limit=50&cursor=<opaque>` →
  `{ "items": [...], "next_cursor": "..." | null }`. Max `limit` 100.

### Rate limits

| Who                             | Limit                          |
| ------------------------------- | ------------------------------ |
| Device check-in                 | 20 / min per device            |
| Client app JWT                  | 120 / min per user             |
| Auth / claim                    | 10 / min per IP                |
| Firmware image download         | 20 / min per IP                |
| Log in                          | 10 / 15 min per email or phone |
| Sign up, forgot password        | 3 / h per email or phone       |
| Add phone                       | 3 / h per phone                |
| Add email                       | 3 / h per user and per email   |
| Resend verification             | 3 / h per user                 |
| Device invites                  | 10 / h per user                |
| Channel test message            | 5 / min per user               |
| Redeliver                       | 30 / min per user              |
| Webhook create or URL change    | 10 / min per user              |
| Change password, delete account | 10 / 15 min per user           |

Responses include `Retry-After` on `429`; CORS exposes it to the app origins.

## 2. Device API

| Method | Path                                              | Purpose                                                 |
| ------ | ------------------------------------------------- | ------------------------------------------------------- |
| POST   | `/api/v1/device/claim`                            | Pairing code → device token (once)                      |
| POST   | `/api/v1/device/ping`                             | `BOOT` or `PING` check-in                               |
| GET    | `/api/v1/device/settings` **(proposed)**          | Current device settings                                 |
| POST   | `/api/v1/device/settings/applied` **(proposed)**  | Report applied settings version                         |
| GET    | `/api/v1/device/updates/pending`                  | Pending OTA attempt and signed release info, if any     |
| GET    | `/api/v1/device/firmware/:version` **(proposed)** | Download the signed firmware image                      |
| POST   | `/api/v1/device/updates/:id/start`                | `update_started`, requests the maintenance window       |
| POST   | `/api/v1/device/updates/:id/result`               | `update_finished`, reports outcome and running firmware |

### `POST /api/v1/device/claim`

Exchanges a pairing code for the permanent device token. Auth: none
(the pairing code is the credential). Rate limit: auth / claim.

```json
{ "pairing_code": "K7Q2M9XD", "fw": "2.0.0" }
```

`200`:

```json
{
  "device_id": "4c0f…",
  "device_token": "<64 hex chars>",
  "settings": { "version": 1, "ping_interval_s": 30 }
}
```

- The code is single use and valid 30 min. Expired → `410 expired`.
  Unknown, used or replaced → `404 not_found` (claiming clears the stored
  code, so a used code can't be told from an unknown one).
- Case, spaces and hyphens are ignored: `k7q2-m9xd` claims `K7Q2M9XD`.
- Claiming replaces any previous device token. Only the SHA-256 hash is stored.
- The device receives its settings in the claim response, so claiming
  marks the current settings version as applied (`settings_sync.pending`
  becomes `false`).
- Claiming resets the boot baseline (`boot_id`, `seq`). The first boot
  after a claim is never a power blip, and recovery from `OFFLINE` on it
  has cause `UNKNOWN`.
- If the response is lost, the device cannot claim again with the same
  code. The owner generates a new code (`POST /devices/:id/pairing-code`).

### `POST /api/v1/device/ping`

One endpoint for `BOOT` and `PING` check-ins.

Body:

```json
{
  "type": "PING",
  "boot_id": "b738bb72-4172-4edd-8b30-8d5219d8f5f3",
  "seq": 42,
  "uptime_s": 1260,
  "reset_reason": "POWER_ON",
  "rssi": -61,
  "fw": "2.0.0",
  "settings_version": 3,
  "wifi": {
    "evicted": 0,
    "events": [
      {
        "id": 7,
        "kind": "WIFI",
        "start_uptime_s": 900,
        "end_uptime_s": 948,
        "reason": 201
      }
    ]
  }
}
```

- `type`: `BOOT` | `PING`. `reset_reason`: `POWER_ON` | `BROWNOUT` |
  `SOFTWARE` | `WATCHDOG` | `PANIC` | `UNKNOWN`.
- `wifi` is only sent with `PING`. `kind` is `WIFI` (Wi-Fi disconnected)
  or `API` (Wi-Fi up, HTTPS failed). `reason` is the driver reason code.
- `settings_version` is the settings version the device has applied.

Responses:

| Status | Meaning                               |
| ------ | ------------------------------------- |
| `204`  | Accepted, or a duplicate acknowledged |
| `400`  | Invalid body                          |
| `401`  | Unknown or rotated token              |
| `429`  | Rate limited, with `Retry-After`      |

Response headers on `204`:

| Header                                   | When                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `X-Firmware-Update: pending`             | An install command is queued. Device calls `GET /api/v1/device/updates/pending`                |
| `X-Settings-Version: <n>` **(proposed)** | Always. If it differs from the applied version, the device calls `GET /api/v1/device/settings` |

Processing (one transaction, device row locked):

1. Same `boot_id` and `seq` ≤ last seen → duplicate. `204`, no state
   change, `last_seen_at` not advanced.
2. Apply OTA deadline rules (PROJECT_V2 §4). While `UPDATING`, a check-in
   does not end the state.
3. `PENDING` → `ONLINE` silently.
4. `OFFLINE` → `ONLINE`. Close the open outage, classify cause and kind,
   queue the recovery notification.
5. `ONLINE` with a new `boot_id` and `POWER_ON`/`BROWNOUT` → record a
   power blip. Contact gap = previous check-in → now.
6. Gap past the offline timeout but the worker has not run yet → record
   the completed outage here and queue one summary.
7. Store Wi-Fi diagnostics, dedupe by device + `boot_id` + event `id`.
   Keep the highest `evicted` per boot.
8. Update `last_seen_at`, `boot_id`, `seq`, `uptime_s`, `rssi`, `fw`.

The `204` acknowledges the Wi-Fi events in that request. The device
removes only those events. A duplicate still stores its Wi-Fi events
(deduplicated), because its `204` acknowledges them too.

Validation is tolerant where a strict check would make a device look
offline:

- An unknown `reset_reason` is stored as `UNKNOWN`.
- A Wi-Fi event with `end_uptime_s < start_uptime_s` or
  `end_uptime_s > uptime_s` is skipped. The rest of the check-in is
  accepted.
- A malformed shape is still `400`. At most 32 Wi-Fi events per request.

Until OTA ships (M11): while `UPDATING`, a check-in updates the live
fields and keeps the state. `settings_version` is accepted and ignored.

### `GET /api/v1/device/settings` **(proposed)**

`200`:

```json
{ "version": 3, "ping_interval_s": 30 }
```

Only device-applied settings are returned. Server-side settings
(thresholds, notification rules) stay on the server.

### `POST /api/v1/device/settings/applied` **(proposed)**

```json
{ "version": 3 }
```

`204`. Marks the settings version applied. Until then the worker allows
both the old and the new ping interval. An older version than the
current applied one is ignored.

### `GET /api/v1/device/updates/pending`

`200` when an attempt is queued or automatic OTA offers a release:

```json
{
  "attempt_id": "a1b2…",
  "version": "2.1.0",
  "url": "https://api.<domain>/api/v1/device/firmware/2.1.0",
  "size": 1183744,
  "sha256": "…",
  "signature": "…"
}
```

`204` when there is nothing to install. The device checks after boot or
reconnect, then about once an hour with jitter.

### `GET /api/v1/device/firmware/:version` **(proposed)**

Streams the signed firmware image (`application/octet-stream`). Supports
`Range` so the device can resume. Device token required. The device
verifies `sha256` and the signature before switching slots.

### `POST /api/v1/device/updates/:id/start`

`update_started`. Requests the maintenance window.

```json
{ "version": "2.1.0", "boot_id": "…" }
```

`200`:

```json
{ "attempt_id": "a1b2…", "window_ends_at": "2026-11-21T16:52:00Z" }
```

- Device goes `UPDATING`. Does not advance `last_seen_at`.
- Retries with the same attempt return the original deadline.
- `409 conflict` if the attempt was cancelled, already finished, or the
  device is not `ONLINE`. `410 expired` if the window already passed.
- The device installs only after an unexpired `200`.

### `POST /api/v1/device/updates/:id/result`

`update_finished`.

```json
{
  "outcome": "SUCCEEDED",
  "running_version": "2.1.0",
  "boot_id": "…"
}
```

`outcome`: `SUCCEEDED` | `FAILED` | `ROLLED_BACK`. `204`.

- Before the deadline: close the window, device → `ONLINE`, fresh
  offline timeout. The reported `boot_id` becomes the new baseline, so
  the reboot is not a power blip.
- After the deadline: record the outcome and close the matching outage.
  The recorded downtime stays.
- Idempotent: repeats return `204` without a second state change or
  notification. A result for an old attempt does not change a newer one.

## 3. Auth API

The refresh token lives in an `httpOnly`, `Secure`, `SameSite=Lax` cookie
scoped to `api.<domain>`. Apps call auth endpoints with
`credentials: "include"`. CORS allows credentials only from `CLIENT_URL`
and `ADMIN_URL`. Cookie-authenticated endpoints (`refresh`, `logout`)
also check the `Origin` header, because `SameSite` does not block
requests from sibling subdomains.

The refresh cookie is named `em_refresh`, with `Path=/api/auth` and
`Max-Age` 30 days, and no `Domain` attribute (host-only).

Successful sign-in responses set the refresh cookie and return:

```json
{ "access_token": "<jwt>", "expires_in": 900, "user": { "...": "see GET /me" } }
```

| Method | Path                            | Body                                                           | Success                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/auth/signup`              | `email` or `phone`, `password`, `name`, `language`, `timezone` | Does not sign in. Email: `201` with no body and a verification email; an existing email gets the same `201` and an email to that account. Phone: always `201 { "telegram_url" }`; a new number creates the account (unverified) and the link confirms it, an existing number creates nothing, the link recovers the account and the bot warns its owner (no enumeration) |
| POST   | `/api/auth/verify-email`        | `token`                                                        | `204`. Unknown, used, expired or wrong-purpose token → `410 expired`                                                                                                                                                                                                                                                                                                     |
| POST   | `/api/auth/resend-verification` | — (signed in)                                                  | `204`. A verified email, or an account without one, gets `204` and no email                                                                                                                                                                                                                                                                                              |
| POST   | `/api/auth/login`               | `email` or `phone`, `password`                                 | `200` session. Wrong credentials → `401 invalid_credentials`                                                                                                                                                                                                                                                                                                             |
| GET    | `/api/auth/google`              | query `app=CLIENT\|ADMIN`, `intent=LOGIN\|LINK`                | `302` to Google with PKCE and `state`                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/api/auth/google/callback`     | from Google                                                    | `302` to `<app origin>/auth/google`, with the refresh cookie set on `LOGIN`. The app then calls `refresh`. On failure the redirect adds `?error=` (see below)                                                                                                                                                                                                            |
| POST   | `/api/auth/refresh`             | cookie                                                         | `200` session, rotates the cookie. Token reused within 10 s → `409 conflict` (the parallel request already set the new cookie; retry once). Reused after 10 s → revoke session, `401`                                                                                                                                                                                    |
| POST   | `/api/auth/logout`              | cookie                                                         | `204`, clears the cookie                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/api/auth/logout-all`          | signed in                                                      | `204`, revokes all refresh tokens                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/api/auth/forgot-password`     | `email` or `phone`                                             | Email: always `204`. Phone: always `200 { "telegram_url" }`; an account with a bound Telegram user also gets the reset link there at once                                                                                                                                                                                                                                |
| POST   | `/api/auth/reset-password`      | `token`, `password`                                            | `204`, verifies the email or phone the link was sent to, logs out all sessions. If the account had nothing verified before, Google is unlinked. Unknown, used, expired or superseded token → `410`                                                                                                                                                                       |
| POST   | `/api/auth/change-password`     | `current_password`, `new_password` (signed in)                 | `204`. Revokes other sessions. Wrong current password → `403 invalid_credentials`. Account without a password → `409 conflict`                                                                                                                                                                                                                                           |
| POST   | `/api/auth/phone`               | `phone` (signed in)                                            | `200 { "telegram_url" }` to confirm the number; also the resend for an unverified phone account. A number another account has confirmed → `409` with detail `phone` / `already_in_use` (an unconfirmed holder does not block it); the account already has a verified or different phone → `409`; a new number on an unverified account → `403 not_verified`              |
| POST   | `/api/auth/email`               | `email` (signed in, verified)                                  | `204`. A free email gets the verification email and is set on the account only when that link is used (`verify-email` answers `410` if the email was taken meanwhile); a taken one gets the "account exists" email. Account already has an email → `409`                                                                                                                 |
| DELETE | `/api/auth/google`              | signed in                                                      | `204`. `409` if it is the only sign-in method                                                                                                                                                                                                                                                                                                                            |

Bodies with `email` or `phone` take exactly one of them. A phone is
accepted in any common format (default country UA) and stored as E.164; an
invalid one is a `400` with detail `phone` / `invalid_phone`.
`telegram_url` is `https://t.me/<bot>?start=p_<code>` (§6).

Email links open the client app: `${CLIENT_URL}/verify-email?token=…` and
`${CLIENT_URL}/reset-password?token=…`. Every bad token (unknown, used,
expired, wrong purpose) answers `410 expired`.

Google callback `error` values: `google_failed` (missing or expired state
cookie, state mismatch, consent denied, token exchange failed, or `LINK`
without a signed-in session), `google_email_unverified`,
`google_account_in_use` (the Google account, or its email when linking to
an account without one, belongs to another user) and
`google_already_linked` (the user already has a different Google account).
`LINK` needs a verified account (otherwise `google_failed`). On an account
without an email it sets the Google email as verified.
The callback never answers with JSON or a `500` page for these cases. `LINK`
finds the user from the refresh cookie, which the browser sends on the
top-level `GET` because the cookie path is `/api/auth`.

Google callback redirect targets come from an allowlist
(`CLIENT_URL`, `ADMIN_URL`). Never redirect to a URL from the query.

## 4. Client REST API (`/api/v1`)

Auth column: `signed in` (access JWT) or `none`. Role: who may call
it for a given device. A viewer calling an owner-only endpoint gets
`403 forbidden`. A user who is neither owner nor viewer gets
`404 not_found`.

### Devices

| Method | Path                        | Auth      | Role          | Purpose                           |
| ------ | --------------------------- | --------- | ------------- | --------------------------------- |
| GET    | `/devices`                  | signed in | owner, viewer | Own and shared devices with state |
| POST   | `/devices`                  | signed in | verified user | Create device → pairing code      |
| GET    | `/devices/:id`              | signed in | owner, viewer | Device details                    |
| PATCH  | `/devices/:id`              | signed in | owner         | Name and settings                 |
| DELETE | `/devices/:id`              | signed in | owner         | Delete device                     |
| POST   | `/devices/:id/pairing-code` | signed in | owner         | New pairing code (re-pair)        |
| POST   | `/devices/:id/rotate-token` | signed in | owner         | Invalidate device token           |
| PUT    | `/devices/:id/network-pause` | signed in | owner        | Pause network alerts (router work) |
| DELETE | `/devices/:id/network-pause` | signed in | owner        | End the pause now                 |

`PUT /devices/:id/network-pause` `{ "minutes": 5–120 }` → `200 { "until": "…" }`.
Planned network work (P §5): until `until` no OFF alert is queued, and a
gap that starts in the pause and ends with the same boot is dropped. An
open outage's unqueued OFF alert waits for `until`. Devices show the
stored value as `network_pause_until` (`null` when cancelled; clients
treat a past value as no pause). `DELETE` → `204`.

`POST /devices` body `{ "name": "Home" }` (trimmed, 1–64 chars) → `201`.
The response `device` is the full device object below. The pairing code
uses `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no `0 O 1 I L`). An owner can
have at most 20 devices. The 21st returns `409 conflict`.

```json
{
  "device": { "id": "4c0f…", "name": "Home", "state": "PENDING" },
  "pairing_code": "K7Q2M9XD",
  "pairing_code_expires_at": "2026-11-21T17:12:00Z"
}
```

Device object (`GET /devices/:id`, items of `GET /devices`):

```json
{
  "id": "4c0f…",
  "name": "Home",
  "role": "OWNER",
  "state": "ONLINE",
  "state_since": "2026-11-21T14:02:00Z",
  "last_seen_at": "2026-11-21T16:41:30Z",
  "open_outage": null,
  "telemetry": { "rssi": -61, "uptime_s": 9420, "reset_reason": "POWER_ON" },
  "settings": {
    "ping_interval_s": 30,
    "offline_timeout_s": 120,
    "short_outage_threshold_s": 180,
    "notify_short_outages": true,
    "notify_network_outages": true,
    "quiet_hours": { "start": "23:00", "end": "07:00" },
    "auto_update": false
  },
  "settings_sync": { "desired_version": 3, "applied_version": 2, "pending": true },
  "firmware": {
    "version": "2.0.0",
    "available": "2.1.0",
    "update": {
      "attempt_id": "a1b2…",
      "version": "2.1.0",
      "status": "QUEUED",
      "window_ends_at": null,
      "outcome": null,
      "finished_at": null
    }
  }
}
```

- `state`: `PENDING` | `ONLINE` | `OFFLINE` | `UPDATING`.
- `update.status`: `QUEUED` | `INSTALLING` | `FINISHED` | `TIMED_OUT`.
- `firmware`, `settings_sync` and `telemetry` are hidden in `GET /devices`
  list items to keep it small. The client polls `GET /devices/:id` in
  the add-device wizard until `state` leaves `PENDING`.
- `GET /devices` returns `{ "items": [...] }`: owned and shared devices
  together, each with the caller's `role` (`OWNER` | `VIEWER`), oldest
  first by device creation. It is not paginated. The 20-device cap counts
  owned devices only.
- `open_outage` is an outage item (the shape of `GET /devices/:id/outages`
  items) or `null`.
- `telemetry.reset_reason` is the reset reason of the current boot.
- Until OTA ships (M11), `firmware.available` and `firmware.update` are
  `null`.

`PATCH /devices/:id` accepts any subset of `name` and `settings`.
Validation:

- `name`: trimmed, 1–64 chars.
- `ping_interval_s`: 5–600 (5 s is 12 check-ins/min, leaving room for
  retries under the 20 / min limit). Default 20. Under 15 needs firmware
  2.1.0 or newer (or a `-dev` build); otherwise detail
  `{ "path": "settings.ping_interval_s", "code": "firmware_too_old", "min": 15 }`.
- `offline_timeout_s`: 10–3600 and ≥ 2 × `ping_interval_s`, checked on
  the merged result. A violation returns detail
  `{ "path": "settings.offline_timeout_s", "code": "too_small", "min": <2 × interval> }`.
  Default 40.
- `short_outage_threshold_s`: 30–86400. Default 180.
- `quiet_hours`: `{ "start": "HH:MM", "end": "HH:MM" }` (24 h, start ≠ end)
  or `null`.
- Unknown keys return `400`.
- Changing `ping_interval_s` to a different value increments
  `desired_version`.
- Changing `offline_timeout_s` or `ping_interval_s` on an `ONLINE` device
  moves its offline deadline at once.

`POST /devices/:id/pairing-code` → `201` with a new code. Earlier unused
codes are invalidated. The current device token keeps working until the
code is claimed.

`POST /devices/:id/rotate-token` → `204`. The current token stops working
immediately. The device gets `401` at its next check-in, opens its setup
Wi-Fi and needs re-pairing with a new code.

`DELETE /devices/:id` → `204`. Removes outages, memberships, channel
links and queued notifications for the device.

### Firmware

| Method | Path                                          | Auth      | Role     | Purpose                                      |
| ------ | --------------------------------------------- | --------- | -------- | -------------------------------------------- |
| POST   | `/devices/:id/firmware-update`                | signed in | owner    | Queue or explicitly retry a firmware install |
| DELETE | `/devices/:id/firmware-update` **(proposed)** | signed in | owner    | Cancel a queued install                      |
| GET    | `/firmware/releases` **(proposed)**           | signed in | any user | Published releases                           |
| GET    | `/firmware/manifest.json`                     | none      | public   | ESP Web Tools manifest                       |
| GET    | `/firmware/images/:version/factory.bin`       | none      | public   | Factory image for browser flashing           |

`POST /devices/:id/firmware-update` body `{ "version": "2.1.0" }`
(optional, default latest compatible) → `202` with the `update` object.

- Queues a new attempt. Next ping returns `X-Firmware-Update: pending`.
- Also used to retry a failed or timed-out version explicitly.
- `409 conflict` if an attempt is already installing, or the version is
  not compatible.

`DELETE` cancels a queued attempt that has not started. `409` once
installing.

`GET /firmware/manifest.json` is the ESP Web Tools manifest for browser
flashing. It points at the newest published `STABLE` release by
`version_code`. `Cache-Control: no-store`. `404 not_found` when no release
is published.

```json
{
  "name": "Electricity Monitor",
  "version": "2.0.0",
  "new_install_prompt_erase": true,
  "builds": [
    {
      "chipFamily": "ESP32-C3",
      "parts": [
        { "path": "https://api.<domain>/api/v1/firmware/images/2.0.0/factory.bin", "offset": 0 }
      ]
    }
  ]
}
```

`GET /firmware/images/:version/factory.bin` streams the merged factory
image (bootloader, partition table, `boot_app0` and app at offset 0) of a
published release from the private bucket. `200 application/octet-stream`
with `Content-Length` and `Cache-Control: public, max-age=86400, immutable`.
An unknown, draft or malformed version is `404`. Rate limit: 20 / min per
IP. CORS allows the client origin, because ESP Web Tools fetches it from
the browser.

### Outages and stats

| Method | Path                       | Auth      | Role          | Purpose                                              |
| ------ | -------------------------- | --------- | ------------- | ---------------------------------------------------- |
| GET    | `/devices/:id/outages`     | signed in | owner, viewer | Outages and power blips, filtered, cursor pagination |
| GET    | `/devices/:id/stats`       | signed in | owner, viewer | Stats for a History range                            |
| GET    | `/devices/:id/diagnostics` | signed in | owner         | Wi-Fi and API reachability diagnostics               |

`GET /devices/:id/outages?from&to&kind&cause&type&limit&cursor`, newest
first:

```json
{
  "items": [
    {
      "id": "9e1d…",
      "type": "OUTAGE",
      "started_at": "2026-11-21T16:42:00Z",
      "ended_at": "2026-11-21T18:57:00Z",
      "duration_s": 8100,
      "cause": "POWER",
      "kind": "LONG",
      "ota_attempt_id": null
    }
  ],
  "next_cursor": null
}
```

- `type`: `OUTAGE` | `POWER_BLIP`. `cause`: `POWER` | `NETWORK` |
  `UNKNOWN` (null while open). `kind`: `SHORT` | `LONG` (null while open).
- An open outage has `ended_at: null`.
- `from` and `to` (ISO 8601) keep outages that overlap the range:
  `started_at < to` and (`ended_at` is null or `ended_at > from`). `from`
  is inclusive, `to` exclusive. `from` after `to` → `400`.
- `type`, `cause` and `kind` filter by exact value. Filtering by `cause`
  or `kind` leaves out the open outage.
- `limit` defaults to 50, max 100. An invalid `cursor` → `400`.

`GET /devices/:id/diagnostics?from&to&kind&limit&cursor` (owner only),
newest first:

```json
{
  "items": [
    {
      "boot_id": "b738bb72-4172-4edd-8b30-8d5219d8f5f3",
      "id": 7,
      "kind": "WIFI",
      "reason": 201,
      "started_at": "2026-11-21T16:36:00Z",
      "ended_at": "2026-11-21T16:36:48Z",
      "duration_s": 48,
      "boot_wifi_evicted": 0
    }
  ],
  "next_cursor": null
}
```

- `id` is the device's local event ID within the boot. `reason` is the
  Wi-Fi driver reason code, `null` for `API`.
- Times are estimates from the device uptime. `duration_s` is exact.
- `boot_wifi_evicted` is the highest count of records the device dropped
  in that boot because its buffer was full.

`GET /devices/:id/stats?period&from&to`:

- `period`: `DAY` | `WEEK` | `MONTH` | `YEAR` | `CUSTOM`, the same choices
  as the History tab. `from` and `to` are local dates (`YYYY-MM-DD`)
  between 2000-01-01 and 2100-12-31 in the caller's timezone from `/me`.
- `DAY`, `WEEK`, `MONTH`, `YEAR`: `from` is any date in the period and
  defaults to today. The server snaps it to the period start (weeks start
  on Monday). `to` → `400`.
- `CUSTOM`: `from` and `to` are required and inclusive, `to >= from`, at
  most 366 days. Otherwise `400`.

```json
{
  "period": "WEEK",
  "timezone": "Europe/Kyiv",
  "from": "2026-11-15T22:00:00Z",
  "to": "2026-11-22T22:00:00Z",
  "bucket": "DAY",
  "monitoring_since": "2026-10-02T09:14:05Z",
  "outages": 6,
  "long_outages": 3,
  "open_outage": false,
  "power_blips": 2,
  "by_cause": { "power": 5, "network": 1, "unknown": 1 },
  "total_downtime_s": 28800,
  "network_downtime_s": 720,
  "avg_outage_s": 4800,
  "longest_outage_s": 14400,
  "availability_pct": 95.24,
  "buckets": [
    {
      "from": "2026-11-15T22:00:00Z",
      "to": "2026-11-16T22:00:00Z",
      "outages": 1,
      "power_blips": 0,
      "total_downtime_s": 3600,
      "network_downtime_s": 0,
      "availability_pct": 95.83
    }
  ]
}
```

- `from` and `to` in the response are the range as instants (`to`
  exclusive).
- `bucket`: `HOUR` for `DAY` (23 or 25 buckets on a DST day), `DAY` for
  `WEEK`, `MONTH` and `CUSTOM` up to 31 days, `MONTH` for `YEAR` and
  longer `CUSTOM` ranges (clipped to the range). Used for charts.
- An outage or power blip counts in every bucket it overlaps, and in the
  totals when it overlaps the range (the `GET /outages` rule). Bucket
  counts can add up to more than the total.
- `monitoring_since` is the device's first check-in (`null` before it).
  Availability counts only monitored time: from `monitoring_since` or
  the range start, whichever is later, up to now or the range end.
  `availability_pct` is `null` when there is no monitored time (a future
  bucket, before the first check-in).
- `total_downtime_s` adds the outages clipped to the range; an open
  outage runs until now. Power blips count in `power_blips`, never in
  `outages` or downtime. Planned OTA windows create no outages.
- A closed `NETWORK` outage proves the device kept power (same boot), so
  it is not time without power: it counts in `by_cause.network` and
  `network_downtime_s` (clipped like downtime), never in `outages`,
  `long_outages`, `total_downtime_s`, availability, `avg_outage_s` or
  `longest_outage_s`. An open outage has no cause yet and counts as
  downtime until it closes.
- `long_outages`: closed with kind `LONG`, plus the open outage once it
  reaches the short-outage threshold. `by_cause` counts closed outages;
  `open_outage` marks an open one in the range.
- `avg_outage_s` and `longest_outage_s` use each outage's full duration,
  not the clipped part; `null` without outages.

### Sharing

| Method | Path                             | Auth      | Role                 | Purpose                |
| ------ | -------------------------------- | --------- | -------------------- | ---------------------- |
| GET    | `/devices/:id/members`           | signed in | owner, viewer        | Owner and viewers      |
| POST   | `/devices/:id/invites`           | signed in | owner                | Invite by email, phone |
| GET    | `/devices/:id/invites`           | signed in | owner                | Pending invites        |
| DELETE | `/devices/:id/invites/:inviteId` | signed in | owner                | Revoke an invite       |
| DELETE | `/devices/:id/members/:userId`   | signed in | owner, viewer (self) | Remove viewer or leave |
| GET    | `/invites/:token`                | none      | public               | Invite preview         |
| POST   | `/invites/:token/accept`         | signed in | invitee              | Accept invite          |

- `POST /devices/:id/invites` `{ "email": "…" }` or `{ "phone": "…" }`
  (exactly one) → `201` with the invite object. The account needs a
  verified email or phone. Limit: 10 per hour per user. The link is
  `https://app.<domain>/invite?token=<token>`, valid 7 days.
  - An email invite sends the link by email in the recipient's language,
    or `uk` if they have no account.
  - A phone invite adds `url` (the link) to the response, so the owner can
    copy it. When the number belongs to an account with a bound Telegram
    user, the bot also sends it there. The response never says whether it
    did.
  - Inviting an email or phone that already has a pending invite replaces
    it: a new link and expiry, and the earlier link stops working.
  - The owner's or a current viewer's email or phone → `409 conflict` with
    detail `{ "path": "email" | "phone", "code": "already_member" }`.
  - At most 10 viewers and unexpired pending invites per device (a
    re-invite doesn't count twice). Over the limit → `409 conflict`
    without details.
- Invite object: `{ "id", "email", "phone", "expires_at", "created_at" }`;
  one of `email` / `phone` is `null`. `GET /devices/:id/invites` →
  `200 { "items": [...] }`: pending invites, expired ones included, oldest
  first, without `url`. `DELETE` → `204`, and the link stops working. An
  unknown invite or one from another device → `404`.
- `GET /invites/:token` → `200`
  `{ "device_name", "inviter_name", "email", "phone", "expires_at", "accepted" }`,
  so the page can show "Johnny invited you to Home" before sign-up. An
  unknown, revoked or expired token → `410 expired`. An accepted invite
  still previews (with `accepted: true`) until it expires. Limit: 10 per
  minute per IP.
- `POST /invites/:token/accept` → `200` with the device (`role: VIEWER`).
  Joining attaches all of the caller's channels to the device.
  - Unknown, revoked or expired (7 days) → `410 expired`.
  - Email invite: the account email must match, else `403 forbidden`. It
    need not be verified: accepting marks it verified.
  - Phone invite: the account phone must match, else `403 forbidden`, and
    must already be verified, else `403 not_verified`. Accepting never
    verifies a phone.
  - Already accepted: `200` with the device if the caller is still a
    viewer (so a second tab or a return after sign-up works), else `410`.
  - When an account's email becomes verified (verification link, reset
    of an unverified account, Google sign-in) or its phone does (bot
    confirmation, reset), its pending, unexpired invites for it are accepted
    the same way, without calling this endpoint.
- `GET /devices/:id/members` → `200 { "items": [...] }`, the owner first,
  then viewers by join time:

  ```json
  {
    "user_id": "…",
    "name": "Johnny",
    "email": "johnny@example.com",
    "phone": null,
    "role": "OWNER",
    "joined_at": "2026-11-21T14:02:00Z"
  }
  ```

  `joined_at` of the owner is the device's creation time. `email` and
  `phone` are shown to the owner, and to each member for their own row;
  otherwise `null`.

- `DELETE /devices/:id/members/:userId` → `204`. The owner removes any
  viewer; a viewer removes only themselves (leave), else `403 forbidden`.
  The owner cannot be removed (`409 conflict`). A user who isn't a viewer
  → `404`. Removal also detaches the member's channels from the device.

### Notification channels

| Method | Path                          | Auth      | Purpose                                   |
| ------ | ----------------------------- | --------- | ----------------------------------------- |
| GET    | `/channels`                   | signed in | List my channels                          |
| POST   | `/channels`                   | signed in | Add a webhook                             |
| POST   | `/channels/telegram-link`     | signed in | Link to connect the platform Telegram bot |
| PATCH  | `/channels/:id`               | signed in | Edit, turn on or off                      |
| PUT    | `/channels/:id/devices`       | signed in | Set which devices send to this channel    |
| DELETE | `/channels/:id`               | signed in | Delete channel                            |
| POST   | `/channels/:id/test`          | signed in | Send test message                         |
| POST   | `/channels/:id/rotate-secret` | signed in | New webhook secret                        |
| GET    | `/devices/:id/channels`       | signed in | My channels used by this device           |
| PUT    | `/devices/:id/channels`       | signed in | Set which of my channels this device uses |
| GET    | `/channels/:id/deliveries`    | signed in | Delivery log                              |
| POST   | `/deliveries/:id/redeliver`   | signed in | Retry a delivery                          |

Channels belong to the caller. Viewers attach their own channels to
shared devices.

`GET /channels` items include `device_ids`: the devices linked to that
channel, oldest link first.

`PATCH /channels/:id` `{ "name"?, "enabled"?, "url"?, "events"?, "language"? }` (at
least one; name 1–64 chars, trimmed) → `200` with the channel.
`enabled: false` sets `disabled_reason: "USER"`, `enabled: true` clears
it. Turning a disabled channel on resets its failure count. A channel
disabled with `TOO_MANY_FAILURES` keeps that reason on `enabled: false`
(also when the worker disables it while the request runs) and returns
`409 conflict` on `enabled: true`; a successful test message turns it back
on.

`url` and `events` follow the rules of `POST /channels` and apply to
webhooks only. On a Telegram channel they are `400 validation_error` with
detail `{ "path": "url" | "events", "code": "not_allowed" }`. A changed URL
is checked like a new one (`400 url_not_allowed`) and counts against the
webhook URL rate limit (below, `429`); other edits don't. Editing does not
re-enable the channel or reset its failure count.

`language` (`uk` | `en` | `ru` | `null`) applies to Telegram channels
only; `null` follows the account language. On a webhook it is
`400 validation_error` with detail `{ "path": "language", "code": "not_allowed" }`.

`PUT /channels/:id/devices` `{ "device_ids": [...] }` (at most 100) →
`200 { "device_ids": [...] }`. Replaces the channel's links. Every ID must
be a device the caller owns or views, otherwise `400` with detail
`{ "path": "device_ids.<i>", "code": "not_found" }`.

`POST /channels/:id/test` → `200` with the channel after the test. On
success a channel disabled after failures is turned back on and its
failure count reset. Rate limit: 5 / min per user.

- Telegram: sends a short message in the caller's language. If the
  messenger refuses it, `409 conflict`.
- Webhook: the API sends a signed `ping` request right away (see §8). It
  is not stored in the delivery log. If the receiver does not accept it,
  `409 conflict` with message
  `The receiver did not accept the request (<error>)` and the detail
  `{ "path": "url", "code": "delivery_failed", "reason": "<error>" }`. The
  client shows `reason` as it is, like `last_error` in the delivery log.

`POST /channels/:id/rotate-secret` (webhook only, otherwise
`409 conflict`) → `200` with the channel and a new `secret`, shown once.
The old secret stops working at once, with no grace period. Retries that
are already queued are signed with the new secret.

`DELETE /channels/:id` → `204`. Only the channel's owner can delete it;
a missing channel or another user's channel is `404 not_found`. The
device links and the delivery log of the channel are deleted with it.
Nothing is sent to Telegram.

`POST /channels/telegram-link` → `201`:

```json
{
  "url": "https://t.me/<PlatformBot>?start=<link_code>",
  "group_url": "https://t.me/<PlatformBot>?startgroup=<link_code>",
  "expires_at": "…"
}
```

The code is valid for 15 minutes, and a new request expires the previous
unused code. Limit: 10 per 15 minutes per user. The bot receives
`/start <link_code>` and creates a `TELEGRAM_PLATFORM` channel, named after
the group title or the user's Telegram name. The channel is attached to
every device the caller owns or views at that moment; devices created or shared later are not attached automatically. The client polls `GET /channels` until the channel
appears. `url` opens a private chat, `group_url` lets the user pick a
group.

`POST /channels`, webhook:

```json
{
  "type": "WEBHOOK",
  "name": "Home Assistant",
  "url": "https://…",
  "events": ["device.offline", "device.online"]
}
```

`name` is 1–64 chars, trimmed. `events` holds 1–3 unique values of
`device.offline`, `device.online` and `device.power_blip`. `url` is at
most 2048 chars and is stored as sent.

`201` returns the channel plus `secret` (`whsec_…`) **once**; only rotate
returns a secret again. The new channel is attached to no devices. A user
can have at most 10 webhooks; the 11th is `409 conflict`
"Webhook limit reached", answered before the URL is checked.

Creating a webhook and changing a webhook URL share one limit of 10 / min
per user (`429` with `Retry-After`).

A URL that is not `https`, carries credentials, does not resolve, or
resolves to any non-public address is `400 url_not_allowed` (rules in
[PROJECT_V2.md §7](PROJECT_V2.md#webhooks)). The DNS check gives up after
5 s. A process runs at most 2 webhook DNS lookups at once; waiting for a
free slot counts toward the 5 s of a check and the 10 s of a send.

Channel object:

```json
{
  "id": "…",
  "type": "WEBHOOK",
  "name": "Home Assistant",
  "enabled": true,
  "disabled_reason": null,
  "config": { "url": "https://…", "events": ["device.offline"] },
  "created_at": "…",
  "device_ids": [],
  "failures": 0,
  "language": null
}
```

`disabled_reason`: `null` | `USER` | `TOO_MANY_FAILURES`. `failures` is
the number of failed attempts in a row. `PATCH` with `enabled: true` on a
disabled channel re-enables it and resets the failure counter, except for
`TOO_MANY_FAILURES` (see above).

`GET /devices/:id/channels` → `200 { "channel_ids": ["…"] }`, the caller's
channels used by the device.

`PUT /devices/:id/channels` `{ "channel_ids": ["…"] }` replaces the
caller's channel set for that device and returns `200 { "channel_ids" }`.
Other users' links are untouched. At most 50 IDs, duplicates are
collapsed. An ID that isn't one of the caller's channels is
`400 validation_error` with a detail `{ "path": "channel_ids.<i>",
"code": "not_found" }`.

A platform channel's `config` is `{ "chat_id": "-1001234567890" }`.

`GET /channels/:id/deliveries?limit&cursor`:

```json
{
  "items": [
    {
      "id": "…",
      "event": "device.offline",
      "device_id": "…",
      "status": "FAILED",
      "attempts": 6,
      "last_attempt_at": "…",
      "last_error": "HTTP 502",
      "created_at": "…"
    }
  ],
  "next_cursor": null
}
```

Works for any channel type. Newest first (`created_at`, then `id`, both
descending). `limit` defaults to 20, max 100. `device_id` is the device of
the outage. `status`: `QUEUED` | `SENT` | `RETRYING` | `FAILED`. An invalid
`cursor` is `400 validation_error` with detail
`{ "path": "cursor", "code": "invalid_cursor" }`. A missing channel or
another user's channel is `404 not_found`.

`POST /deliveries/:id/redeliver` → `202` with the delivery item. It queues
the same delivery ID again: `status: "QUEUED"`, `attempts: 0`,
`last_error: null`, sent as soon as possible with a fresh retry schedule.

- The caller must own the delivery's channel, otherwise `404 not_found`.
- The channel must be a webhook, otherwise `409 conflict`.
- The channel must be enabled, otherwise `409 conflict`
  "Turn the channel on first".
- The delivery must be `SENT` or `FAILED`. `QUEUED` or `RETRYING` is
  `409 conflict`.

Rate limit: 30 / min per user.

### Account

| Method | Path  | Auth      | Purpose                  |
| ------ | ----- | --------- | ------------------------ |
| GET    | `/me` | signed in | Profile                  |
| PATCH  | `/me` | signed in | Name, timezone, language |
| DELETE | `/me` | signed in | Delete account           |

`GET /me`:

```json
{
  "id": "…",
  "email": "user@example.com",
  "email_verified": true,
  "phone": null,
  "phone_verified": false,
  "name": "Johnny",
  "language": "uk",
  "timezone": "Europe/Kyiv",
  "has_password": true,
  "google_linked": false,
  "is_admin": false
}
```

`PATCH /me` accepts `name`, `language` (`uk` | `en` | `ru`), `timezone`
(IANA name). `DELETE /me` needs `{ "password": "…" }`, or a sign-in
within the last 5 min for Google-only accounts. A wrong or missing
password answers `403 invalid_credentials`; a Google-only account whose
session is older than 5 min answers `403 reauth_required`. Deletes owned devices,
outages, channels, tokens and memberships.

## 5. Admin API (proposed)

JWT with the platform admin role. Not in the public OpenAPI document.
Read-only.

| Method | Path                         | Purpose                                                                       |
| ------ | ---------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/admin/health`          | API instances, DB, worker heartbeat, recent API error rate                    |
| GET    | `/api/admin/devices/summary` | Device counts by state and firmware version                                   |
| GET    | `/api/admin/devices`         | Search by name, ID, owner email; filter by state, firmware; cursor pagination |
| GET    | `/api/admin/devices/:id`     | Last check-in, firmware, last update result, recent outages                   |
| GET    | `/api/admin/notifications`   | Queue depth by channel type, recent delivery failures                         |

## 6. Telegram webhook

`POST /telegram/webhook/:secret`. `:secret` and the
`X-Telegram-Bot-Api-Secret-Token` header must both equal
`TELEGRAM_WEBHOOK_SECRET` (compared in constant time), else `404`. Any
other request gets `200`, also when the update is malformed or handling it
fails (the error is logged), so Telegram doesn't retry.

A reply is the webhook response body
`{ "method": "sendMessage", "chat_id": "…", "text": "…" }`. Webhook
replies never call Telegram. The API calls `sendMessage` only for auth
pushes, sent after the transaction commits: password reset link, "someone
tried to sign up" notice and phone invite. A failed push is only logged.
Handles `/start <code>`, `/status`, `/stats`, `/stop` and a
`my_chat_member` update with status `kicked` or `left` (deletes the chat's
channels, no reply). `/stats` lists the last 7 local days (today
included) for each device that notifies the chat. Other commands get the
help text. `/cmd@OtherBot` is ignored. Replies use the language of the
user who linked the chat (the oldest link for a shared group), or the
sender's Telegram language when it is `uk`, `en` or `ru`, else `uk`.
Allowed updates: `message`, `my_chat_member`.

Phone confirmation:

- `/start p_<code>` in a private chat records the sender on a live phone
  code and asks for the contact. The reply adds
  `"reply_markup": { "keyboard": [[{ "text": "…", "request_contact": true }]], … }`
  and is the same for valid, unknown, used and expired codes. It warns
  the user to share the number only if they opened the link themselves. In a group
  the bot asks to open the link in a private chat.
- A `contact` message is accepted only in a private chat, when
  `contact.user_id` equals `message.from.id` and the number matches a code
  that sender opened. A verification code verifies the phone, binds the
  Telegram user to the account, accepts pending phone invites and connects
  the chat to every device the user owns or views. A recovery code binds the
  Telegram user and replies with a password reset link. A number that
  another account has confirmed is refused; an unconfirmed holder loses the
  number (and is deleted if it has no email). Any other contact gets a "doesn't
  match" reply. These replies remove the keyboard
  (`"reply_markup": { "remove_keyboard": true }`).

## 7. Health and docs

| Method | Path                   | Purpose                                                                                                                                                   |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`              | `200 {"status":"ok"}` when the DB is reachable, `503 {"status":"unavailable"}` when it fails or doesn't answer within 3 s. Used by Render and smoke tests |
| GET    | `/api/v1/openapi.json` | Generated OpenAPI 3.1 document for `/api/v1`, `/api/auth` and device endpoints                                                                            |
| GET    | `/api/docs`            | Swagger UI                                                                                                                                                |

The server generates the OpenAPI document from route and request and
response schemas, including authentication, errors and examples. Swagger
UI loads it so developers can read the reference and try requests with
an access token. Admin endpoints are not included.

Each operation belongs to exactly one tag, so Swagger UI shows grouped
sections, in this order: `Health`, `Auth`, `Account`, `Devices`,
`Device` (firmware endpoints, `deviceToken` security), `Outages`,
`Notifications`, `Sharing`, `Firmware`. A tag is declared only once it
has operations.

## 8. Outgoing webhooks

See [PROJECT_V2.md §7](PROJECT_V2.md#webhooks). Payload `device`,
`outage` and enum values use the same shapes and `UPPER_CASE` values as
the REST API above. `device.power_blip` sends the outage object with
`type: "POWER_BLIP"`.

Every request is a `POST` with these headers:

| Header             | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| `Content-Type`     | `application/json`                                     |
| `User-Agent`       | `ElecMonitor-Webhook/1`                                |
| `X-Elec-Event`     | The event name, or `ping`                              |
| `X-Elec-Delivery`  | Delivery ID. Retries keep it, so deduplicate by it     |
| `X-Elec-Signature` | `sha256=<lowercase hex HMAC-SHA256(secret, raw body)>` |

`sent_at` is the time of the attempt: each attempt serializes and signs the
body again, while the event data stays the same. Receivers can reject a
stale `sent_at`.

The test request uses `X-Elec-Event: ping` and a new `X-Elec-Delivery`:

```json
{
  "event": "ping",
  "channel": { "id": "…", "name": "Home Assistant" },
  "sent_at": "2026-11-21T16:42:00.000Z"
}
```

## 9. Review: gaps and open questions

Reviewed the endpoints from the original spec §8 against the features
in PROJECT_V2.md §3–§12. Section numbers below refer to PROJECT_V2.md.

### Missing endpoints (needed for spec features)

| Feature in spec                                                      | Gap                                                                             | Proposal                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| §4 Remote configuration: device fetches settings and reports applied | No endpoints, only a sentence                                                   | `GET /api/v1/device/settings`, `POST /api/v1/device/settings/applied`, `X-Settings-Version` ping header |
| §4 OTA: device downloads the signed image                            | No download location                                                            | `GET /api/v1/device/firmware/:version` (or signed storage URL in `pending`)                             |
| §4 Browser flashing with ESP Web Tools                               | No manifest or image source                                                     | ✅ `GET /api/v1/firmware/manifest.json`, `GET /api/v1/firmware/images/:version/factory.bin` (M5)        |
| §9 "Update available" in the client                                  | Nothing lists releases                                                          | `GET /api/v1/firmware/releases`, `firmware.available` in device details                                 |
| §7 Connect platform Telegram                                         | `POST /channels` covers only webhooks                                           | `POST /channels/telegram-link`                                                                          |
| §7 Telegram bot webhook                                              | Only in §12                                                                     | Listed in §6 here                                                                                       |
| §9 Admin app                                                         | No admin endpoints at all                                                       | §5 here                                                                                                 |
| §12 CI checks "API health endpoint"                                  | `/health` not listed in v2                                                      | §7 here                                                                                                 |
| Swagger UI                                                           | No paths                                                                        | `/api/v1/openapi.json`, `/api/docs`                                                                     |
| §6 Invites                                                           | Owner can't see or revoke pending invites. Invitee can't see what the invite is | ✅ `GET` / `DELETE /devices/:id/invites`, `GET /invites/:token` (M6)                                    |
| §7 Webhook secret                                                    | No rotation if leaked                                                           | ✅ `POST /channels/:id/rotate-secret` (M8)                                                              |
| `PUT /devices/:id/channels`                                          | No matching `GET`                                                               | `GET /devices/:id/channels`                                                                             |
| §5 Wi-Fi diagnostics stored                                          | No way to read them                                                             | ✅ `GET /devices/:id/diagnostics` (owner, M2)                                                           |
| OTA queued by mistake                                                | No cancel                                                                       | `DELETE /devices/:id/firmware-update`                                                                   |

### Inconsistencies

- ~~**ID types.**~~ ✅ Resolved (M8): every ID in a webhook body is a UUID
  string.
- **Enum case.** Resolved: enum values are `UPPER_CASE` in the spec, the
  API and the database (see [Formats](#formats)).
- ~~**Stats response.**~~ ✅ Resolved (M9): power blips, cause breakdown
  and buckets for charts.
- ~~**Invites.**~~ ✅ Resolved (M6): invites and member removal need a
  signed-in user.
- **Ping interval vs rate limit.** 20 check-ins/min allows 3 s, but boot
  retries share the limit. A 5 s minimum leaves room.

### Open questions (need a decision)

1. **Notification rules for viewers.** Quiet hours, "notify on short
   outages" and "notify on network outages" are device settings (owner
   only). Should a viewer have their own copy of these rules per device,
   or follow the owner's?
2. **Quiet hours timezone.** Owner's, or each recipient's? Spec §7 says
   messages use the recipient's timezone, so per-recipient seems natural.
3. ~~**Who publishes firmware releases?**~~ ✅ Resolved: a `fw-v*` tag
   builds and signs a draft GitHub Release, and the `firmware:release`
   server script uploads and publishes it per environment (PROJECT_V2.md
   §4 Firmware distribution).
4. ~~**Where are firmware images stored?**~~ ✅ Resolved: a private Supabase
   Storage bucket per environment, streamed by the API.
5. **Email change.** Not in the spec. Out of scope for v2?
