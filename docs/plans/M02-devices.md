# M2 — Devices and check-ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** owners create and manage devices, devices claim a pairing code and
check in, and the check-in handler keeps live state, outages, power blips and
Wi-Fi diagnostics in the DB.

**Architecture:** The check-in decision is a pure function
(`planCheckIn`) over the locked device row, the open outage and the request.
`recordCheckIn` runs it inside one transaction and persists the result.
Device CRUD lives in `server/src/http/devices/`, the device-facing API in
`server/src/http/device/`. Notification queueing is a `NotificationQueue`
interface injected through `AppDeps`. M2 ships a no-op, and tests record calls.
Tests use PGlite with a `FakeClock`. The concurrency test runs on real Postgres.

**Tech Stack:** Node.js 26, Express 5, Drizzle 0.45 (PGlite in tests,
postgres.js in prod), Zod 4, zod-openapi 6, Vitest 5, supertest, tsx (fake
device script).

**Spec:** [ROADMAP.md § M2](../ROADMAP.md#m2--devices-and-check-ins) ·
[PROJECT_V2.md](../PROJECT_V2.md) §4 Monitoring signals, Wi-Fi diagnostics,
Adding a device, §5 · [API.md](../API.md) §1, §2 claim and ping, §4 Devices,
Outages · [DATABASE.md](../DATABASE.md) §4, §6, §9.

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints) and [M1](M01-auth.md#global-constraints) constraints still applies (ESM, strict, UUIDv7, `timestamptz`, error shape, no comments, no real names, `clock.now()` only).
- **No migration in M2.** The M0 schema already has every column. If a task seems to need one, stop and ask.
- Lock order in every transaction: the `device` row (`for update`) first, then its open outage, then boots and diagnostics (D §9). No HTTP call inside a transaction.
- Every timestamp written by M2 code comes from `clock.now()`. Never rely on `defaultNow()` for `state_since`, `last_seen_at`, `claimed_at` or outage times.
- A device the caller can't access returns `404 not_found`, never `403` (A §1). In M2 only the owner has access ("owned devices only until M6").
- Pairing code: 8 chars, 30 min, single use. Device token: 32 random bytes, 64 lowercase hex chars. Only SHA-256 hashes are stored (A §2, D §4).
- Check-in rate limit 6 / min per device. Claim 10 / min per IP (A §1).
- Defaults: `ping_interval_s` 30, `offline_timeout_s` 120, `short_outage_threshold_s` 180. `offline_timeout_s ≥ 2 × ping_interval_s`, `ping_interval_s ≥ 15` (A §4, D §4).
- Every new endpoint is in the OpenAPI document under its tag, and API.md is updated in the same task.

## Decisions made in this plan

Each task records its decisions in the spec. The final task marks the Q14 row for M2 ✅.

1. **Used pairing code → `404`.** Claim clears the hash (D §4), so a used or replaced code can't be told from an unknown one. Expired → `410 expired`, unknown, used or replaced → `404 not_found`. A §2 is updated.
2. **Pairing code alphabet** `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 chars, no `0 O 1 I L`), drawn with `crypto.randomInt`. Claim normalizes input: trim, uppercase, drop spaces and hyphens. The hash is the SHA-256 of the normalized code.
3. **Claim resets the boot baseline.** It sets `token_hash`, `claimed_at`, `fw_version`, clears the pairing code and sets `boot_id` and `seq` to `null`. A re-paired board's first boot is then "missing boot evidence", which gives no power blip, and cause `UNKNOWN` if the device was `OFFLINE`.
4. **At most 20 devices per owner.** The 21st `POST /devices` → `409 conflict`. The owner's `app_user` row is locked while counting, so parallel creates can't pass the cap.
5. **Settings ranges:** `name` trimmed 1–64; `ping_interval_s` 15–600; `offline_timeout_s` 30–3600 and `≥ 2 × ping_interval_s` of the merged result (detail `{ path: 'settings.offline_timeout_s', code: 'too_small', min }`); `short_outage_threshold_s` 30–86400; `quiet_hours` `{ start, end }` as `HH:MM` 24 h with `start ≠ end`, or `null`.
6. **Offline deadline** = `last_seen_at + max(offline_timeout_s, 2 × previous_ping_interval_s)` (the previous term only while it is set). Changing `ping_interval_s` to a different value increments `settings_version` and sets `previous_ping_interval_s = max(previous ?? 0, old interval)`. A `PATCH` on an `ONLINE` device recomputes `offline_at` at once (server settings apply when saved, P §4).
7. **Wi-Fi overlap doesn't change the cause.** The same `boot_id` across a gap is `NETWORK` with or without an overlapping record (P §5). Overlap isn't stored. The owner sees it through `GET /devices/:id/diagnostics`.
8. **`state_since`** becomes `now` on `PENDING → ONLINE`, `OFFLINE → ONLINE` and a late recovery (contact was lost even though the worker hadn't flipped the state). A power blip leaves it unchanged.
9. **Duplicates** change nothing except storing their Wi-Fi events idempotently, because the `204` acknowledges them (A §2).
10. **Tolerant check-in body.** An unknown `reset_reason` becomes `UNKNOWN`. A Wi-Fi event with `end_uptime_s < start_uptime_s` or `end_uptime_s > uptime_s` is skipped and logged, and the rest of the check-in is accepted. A malformed shape is still `400`. At most 32 events per request.
11. **`UPDATING` in M2:** a check-in updates live fields and `last_seen_at`, and the state stays `UPDATING`. M11 adds the deadline rules (A §2 step 2).
12. **`settings_version` in the ping body** is accepted and ignored until M11. No `X-Settings-Version` or `X-Firmware-Update` header yet.
13. **`GET /devices` is not paginated:** `{ "items": [...] }`, ordered by `created_at`. The cap keeps it small. M6 revisits it when shared devices join.
14. **Outage range filter** means overlap: `started_at < to and (ended_at is null or ended_at > from)`, `from` inclusive, `to` exclusive. `from > to` → `400`.
15. **`open_outage`** in the device object is an outage item (same shape as `GET /outages` items) or `null`.
16. **`GET /devices/:id/diagnostics` accepted (Q14).** Owner only, newest first, cursor pagination, filters `from`, `to`, `kind`. Item: `{ boot_id, id, kind, reason, started_at, ended_at, duration_s, boot_wifi_evicted }`.
17. **Notification queue interface** has `recovery`, `summary` and `powerBlip`. M2 picks recovery vs summary from `off_alert_queued_at`. M3 applies the notify rules inside the implementation.

## Review Focus

1. **Pairing code typed by hand** (`k7q2 m9xd`, `K7Q2-M9XD`, trailing space) → claims the same device. Tests in Tasks 3 and 6.
2. **A newer firmware sends an unknown `reset_reason`** (`"DEEP_SLEEP"`) → the check-in is accepted as `UNKNOWN`, never `400`. A `400` would make the device look offline forever. Test in Task 7.
3. **A buggy Wi-Fi record** (`end_uptime_s` below `start_uptime_s`, or above the current `uptime_s`) → that record is skipped, the check-in and the other records are stored. Test in Task 7.
4. **Owner lowers the offline timeout on an `ONLINE` device** (600 → 60 s, last seen 100 s ago) → `offline_at` is already in the past after the `PATCH`, so the M3 worker flips it on its next run. Lowering `ping_interval_s` keeps the old interval's allowance. Test in Task 5.
5. **The firmware retries a check-in while the first is still in flight** → one is accepted, the other is a duplicate. One power blip, one `powerBlip` call. Real-Postgres test in Task 7.

---

## File structure

```
shared/src/enums.ts                      + checkInTypes, deviceRoles
server/src/monitoring/rules.ts           isPowerReset, classifyCause, classifyKind, offlineDeadline, isDuplicate
server/src/monitoring/plan.ts            planCheckIn (pure)
server/src/monitoring/checkIn.ts         recordCheckIn (transaction)
server/src/monitoring/diagnostics.ts     storeWifiReport
server/src/notifications/queue.ts        NotificationQueue, noopNotificationQueue
server/src/devices/credentials.ts        pairing codes, device tokens
server/src/devices/settings.ts           settingsPatchSchema, applySettingsPatch
server/src/devices/access.ts             getAccessibleDevice
server/src/devices/queries.ts            findDeviceView, findDeviceViews
server/src/http/pagination.ts            limitSchema, encodeCursor, decodeCursor
server/src/http/devices/views.ts         deviceSchema, toDevice, toDeviceListItem, outageItemSchema, toOutageItem
server/src/http/devices/devices.ts       CRUD, pairing-code, rotate-token
server/src/http/devices/history.ts       outages, diagnostics
server/src/http/device/auth.ts           requireDevice, getDeviceAuth
server/src/http/device/claim.ts          POST /api/v1/device/claim
server/src/http/device/ping.ts           POST /api/v1/device/ping
server/scripts/fake-device.ts            fake device CLI
server/test/devices.ts                   createDevice, pairDevice, markOffline, pingBody
server/test/fakes.ts                     + RecordingNotificationQueue
```

Tests sit next to the code (`*.test.ts`). Real-Postgres tests are `*.pg.test.ts` and skip without `TEST_DATABASE_URL`.

---

### Task 1: Classification rules

**Files:**

- Create: `server/src/monitoring/rules.ts`, `server/src/monitoring/rules.test.ts`
- Modify: `shared/src/enums.ts`

**Interfaces:**

- Produces (shared): `checkInTypes = ['BOOT', 'PING'] as const`, `type CheckInType`; `deviceRoles = ['OWNER', 'VIEWER'] as const`, `type DeviceRole`.
- Produces:

  ```ts
  isPowerReset(reason: ResetReason): boolean; // POWER_ON | BROWNOUT
  classifyCause(e: { previousBootId: string | null; bootId: string; resetReason: ResetReason }): OutageCause;
  classifyKind(start: Date, end: Date, shortOutageThresholdS: number): OutageKind; // gap ms < threshold × 1000 → SHORT
  offlineDeadline(lastSeenAt: Date, s: { offlineTimeoutS: number; previousPingIntervalS: number | null }): Date;
  isDuplicate(current: { bootId: string | null; seq: number | null }, incoming: { bootId: string; seq: number }): boolean;
  ```

- [ ] **Step 1: Tests:**
  - `classifyCause`: previous `null` → `UNKNOWN` for every reason; changed boot with `POWER_ON` or `BROWNOUT` → `POWER`; changed boot with `SOFTWARE`, `WATCHDOG`, `PANIC`, `UNKNOWN` → `UNKNOWN`; same boot with any reason (including `POWER_ON`) → `NETWORK`.
  - `classifyKind`: threshold 180, gaps 179.999 s → `SHORT`, 180 s → `LONG`; 25 s → `SHORT`.
  - `offlineDeadline(T, { 120, null })` = T + 120 s; `{ 120, 90 }` → T + 180 s; `{ 300, 60 }` → T + 300 s.
  - `isDuplicate`: same boot and `seq` lower or equal → `true`; same boot, higher `seq` → `false`; different boot with lower `seq` → `false`; current boot `null` → `false`.
- [ ] **Step 2: Run** `npm test -w server -- rules` → FAIL, implement, → PASS.
- [ ] **Commit point:** `shared/src/enums.ts server/src/monitoring/rules*` — `Add outage classification rules`

### Task 2: Check-in planner

**Files:**

- Create: `server/src/monitoring/plan.ts`, `server/src/monitoring/plan.test.ts`

**Interfaces:**

- Consumes: Task 1.
- Produces:

  ```ts
  type DeviceSnapshot = {
    state: DeviceState; stateSince: Date; lastSeenAt: Date | null; offlineAt: Date | null;
    bootId: string | null; seq: number | null; shortOutageThresholdS: number;
  };
  type OpenOutage = { id: string; startedAt: Date; offAlertQueuedAt: Date | null };
  type CheckInFacts = { bootId: string; seq: number; resetReason: ResetReason };
  type CheckInEvent =
    | { type: 'CLOSE_OUTAGE'; outageId: string; cause: OutageCause; kind: OutageKind; notify: 'RECOVERY' | 'SUMMARY' }
    | { type: 'LATE_OUTAGE'; startedAt: Date; cause: OutageCause; kind: OutageKind }
    | { type: 'POWER_BLIP'; startedAt: Date; kind: OutageKind };
  type CheckInPlan =
    | { action: 'DUPLICATE' }
    | { action: 'ACCEPT'; state: DeviceState; stateSince: Date; event: CheckInEvent | null };
  planCheckIn(device: DeviceSnapshot, open: OpenOutage | null, checkIn: CheckInFacts, now: Date): CheckInPlan;
  ```

- [ ] **Step 1: Tests** (table-driven, `T = 2026-11-21T16:42:00Z`, device last seen at `T`, `offlineAt = T + 120 s`, boot `A`, `seq` 5):
  - same boot, `seq` 5 → `DUPLICATE`; `seq` 4 → `DUPLICATE`.
  - `PENDING`, any boot → `ACCEPT`, `ONLINE`, `stateSince = now`, no event.
  - `ONLINE`, same boot `seq` 6 at T + 30 s → `ONLINE`, `stateSince` unchanged, no event.
  - `ONLINE`, new boot `B` `POWER_ON` at T + 25 s → `POWER_BLIP { startedAt: T, kind: 'SHORT' }`, `stateSince` unchanged. With `BROWNOUT` → same.
  - `ONLINE`, new boot `SOFTWARE` (and `WATCHDOG`, `PANIC`, `UNKNOWN`) at T + 25 s → no event.
  - `ONLINE`, `bootId: null` (after claim), new boot `POWER_ON` → no event.
  - `ONLINE`, same boot at T + 150 s (≥ `offlineAt`) → `LATE_OUTAGE { startedAt: T, cause: 'NETWORK', kind: 'SHORT' }`, `stateSince = now`. New boot `POWER_ON` at T + 200 s → `LATE_OUTAGE` cause `POWER`, kind `LONG`, not a blip. At exactly T + 120 s → `LATE_OUTAGE`.
  - `OFFLINE` with open outage started at T, `offAlertQueuedAt` set, same boot at T + 300 s → `CLOSE_OUTAGE { cause: 'NETWORK', kind: 'LONG', notify: 'RECOVERY' }`, `ONLINE`, `stateSince = now`. With `offAlertQueuedAt: null` → `notify: 'SUMMARY'`. New boot `POWER_ON` → cause `POWER`; new boot `SOFTWARE` → `UNKNOWN`.
  - `OFFLINE` with no open outage → `ONLINE`, no event.
  - `UPDATING` → `ACCEPT`, state `UPDATING`, `stateSince` unchanged, no event, even with a new `POWER_ON` boot.
  - `now` before `lastSeenAt` (clock skew between instances) → gap treated as 0, kind `SHORT`, no throw.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `server/src/monitoring/plan*` — `Add check-in planner`

### Task 3: Device credentials

**Files:**

- Create: `server/src/devices/credentials.ts`, `server/src/devices/credentials.test.ts`

**Interfaces:**

- Produces:

  ```ts
  PAIRING_CODE_TTL_MS = 1_800_000;
  newPairingCode(): string;                    // 8 chars from the decision 2 alphabet
  normalizePairingCode(input: string): string; // trim, uppercase, drop spaces and hyphens
  hashPairingCode(code: string): Buffer;       // sha256(normalizePairingCode(code))
  newDeviceToken(): string;                    // randomBytes(32).toString('hex')
  isDeviceTokenFormat(token: string): boolean; // /^[0-9a-f]{64}$/
  hashDeviceToken(token: string): Buffer;
  ```

- [ ] **Step 1: Tests:** 1 000 codes all match `/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/`, and at least 990 are distinct; `normalizePairingCode(' k7q2-m9 xd ')` → `'K7Q2M9XD'`; `hashPairingCode('k7q2 m9xd')` equals `hashPairingCode('K7Q2M9XD')` (Review Focus 1); tokens match `/^[0-9a-f]{64}$/` and differ; `isDeviceTokenFormat` rejects uppercase hex, 63 chars and `em_live_…`.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `server/src/devices/credentials*` — `Add pairing codes and device tokens`

### Task 4: Create, list, get and delete devices

**Files:**

- Create: `server/src/devices/access.ts`, `server/src/devices/queries.ts`, `server/src/http/devices/views.ts`, `server/src/http/devices/devices.ts`, `server/src/http/devices/devices.test.ts`, `server/test/devices.ts`
- Modify: `server/src/http/app.ts`
- Docs: `docs/API.md` §4 Devices (list shape, `open_outage`, 409 cap), `docs/PROJECT_V2.md` §4 Adding a device (cap of 20)

**Interfaces:**

- Consumes: Task 3, `requireUser`, `requireVerifiedEmail`, `getAuth`.
- Produces:
  - `type DeviceAccess = 'read' | 'manage'`; `getAccessibleDevice(db: Executor, userId: string, deviceId: string, need: DeviceAccess): Promise<{ device: DeviceRow; role: DeviceRole }>`. Throws `HttpError(404, 'not_found', 'Device not found')`. M2: owner only for both needs. M6 adds viewers for `read`.
  - `type DeviceView = { device: DeviceRow; role: DeviceRole; resetReason: ResetReason | null; openOutage: OutageRow | null }`; `findDeviceView(db, deviceId, role): Promise<DeviceView | null>`; `findDeviceViews(db, ownerId): Promise<DeviceView[]>`. One query each: left join `device_boot` on `(device.id, device.boot_id)` and the open outage.
  - `deviceSchema`, `deviceListItemSchema`, `outageItemSchema` (Zod with `.meta({ id })`); `toDevice(view): Device`; `toDeviceListItem(view)` (no `telemetry`, `settings_sync`, `firmware`); `toOutageItem(row: OutageRow)`. `quiet_hours` is `{ start: 'HH:MM', end: 'HH:MM' }` or `null`. M2 `firmware` is `{ version: fw_version, available: null, update: null }`. `settings_sync` is `{ desired_version, applied_version, pending: applied !== desired }`.
  - `MAX_DEVICES_PER_USER = 20`; `devicesRouter(deps: AppDeps): Router`, `devicesPaths`. Routes:
    - `POST /api/v1/devices` (JWT, verified) `{ name }` → `201 { device: Device, pairing_code, pairing_code_expires_at }`.
    - `GET /api/v1/devices` → `200 { items: DeviceListItem[] }`.
    - `GET /api/v1/devices/:id` → `200 Device`.
    - `DELETE /api/v1/devices/:id` → `204`.
  - Produces (test): `createDevice(db, ownerId, overrides?): Promise<DeviceRow>`; `pairDevice(db, ownerId, overrides?): Promise<{ device: DeviceRow; token: string }>` (sets `token_hash`, `claimed_at`).
  - `:id` is parsed with `z.uuid()`, so a malformed id is `400`, not a Postgres `500`.

- [ ] **Step 1: Tests** (`FakeClock` at `16:42:00Z`):
  - create → `201`; `device` is `{ id, name: 'Home', role: 'OWNER', state: 'PENDING', … }` with default settings; `pairing_code` matches the alphabet; `pairing_code_expires_at` = `2026-11-21T17:12:00.000Z`; the row stores only `sha256(code)`.
  - name `'  Dacha '` → `'Dacha'`; `''`, 65 chars, missing → `400`.
  - unverified user → `403 email_not_verified`; no JWT → `401`.
  - 20 devices exist → the 21st is `409 conflict`; another user can still create.
  - list → only the caller's devices, oldest first, no `telemetry` / `settings_sync` / `firmware` keys; another user's devices absent.
  - get → the full A §4 object; for an `ONLINE` device with `boot_id` set and a `device_boot` row, `telemetry.reset_reason` comes from that row; with an open outage, `open_outage` equals `toOutageItem` of it.
  - get, delete as a stranger → `404`; `GET /devices/not-a-uuid` → `400`.
  - delete → `204`; its outages, boots and diagnostics are gone (cascade); the user's other device is untouched.
- [ ] **Step 2: Run** → FAIL, implement, register the router and a `Devices` OpenAPI group after `Account` in `app.ts`, → PASS.
- [ ] **Step 3: Docs.** A §4: list response shape and order (decision 13), `open_outage` (decision 15), `409` at 20 devices. P §4 Adding a device: the cap.
- [ ] **Commit point:** `server/src/devices/ server/src/http/devices/ server/src/http/app.ts server/test/devices.ts docs/` — `Add device create, list, get and delete`

### Task 5: Settings, re-pair and token rotation

**Files:**

- Create: `server/src/devices/settings.ts`, `server/src/devices/settings.test.ts`
- Modify: `server/src/http/devices/devices.ts`, `server/src/http/devices/devices.test.ts`
- Docs: `docs/API.md` §4 (ranges, error path example `settings.ping_interval_s`), `docs/DATABASE.md` §4 `device` notes (decision 6), `docs/PROJECT_V2.md` §4 Remote configuration (decision 6)

**Interfaces:**

- Consumes: Tasks 1, 3, 4.
- Produces:
  ```ts
  settingsPatchSchema; // strict partial, decision 5 ranges
  type SettingsPatch = z.infer<typeof settingsPatchSchema>;
  applySettingsPatch(current: DeviceRow, patch: SettingsPatch):
    { changes: Partial<typeof device.$inferInsert> } | { error: ErrorDetail };
  ```
  `changes` includes `settingsVersion` and `previousPingIntervalS` when the interval changes, and `offlineAt` (via `offlineDeadline`) when the device is `ONLINE`.
- Routes:
  - `PATCH /api/v1/devices/:id` (owner) strict `{ name?, settings? }` → `200 Device`.
  - `POST /api/v1/devices/:id/pairing-code` (owner) → `201 { pairing_code, pairing_code_expires_at }`. Replaces any earlier code. The token keeps working.
  - `POST /api/v1/devices/:id/rotate-token` (owner) → `204`, `token_hash = null`.

- [ ] **Step 1: `applySettingsPatch` tests:**
  - `{ ping_interval_s: 60 }` on defaults → `settingsVersion` 2, `previousPingIntervalS` 30; the same value 30 → no version change.
  - two changes (30 → 60 → 15) → `previousPingIntervalS` 60, version 3.
  - `{ ping_interval_s: 90 }` with timeout 120 → `{ error: { path: 'settings.offline_timeout_s', code: 'too_small', min: 180 } }`; `{ ping_interval_s: 90, offline_timeout_s: 180 }` → ok.
  - `ONLINE`, last seen 100 s ago, `{ offline_timeout_s: 60 }` (Review Focus 4) → `offlineAt` = last seen + 60 s (in the past); then `{ ping_interval_s: 15, offline_timeout_s: 30 }` from 30/120 → `offlineAt` = last seen + 60 s (2 × previous 30).
  - `PENDING` device → no `offlineAt` key.
  - `quiet_hours: { start: '23:00', end: '07:00' }` → `quietHoursStart '23:00'`, `quietHoursEnd '07:00'`; `null` clears both; `start === end`, `'24:00'`, `'7:00'` → schema error.
- [ ] **Step 2: Route tests:** `PATCH { name: 'Dacha', settings: { notify_short_outages: false } }` → `200` with both changed and `updated_at` advanced; unknown key → `400`; `{}` → `200` unchanged; stranger → `404` on all three routes. Pairing code: the new code's hash replaces the old one and expiry is now + 30 min; the device's `token_hash` is unchanged. Rotate: `token_hash` is `null`.
- [ ] **Step 3: Run** → FAIL, implement, → PASS.
- [ ] **Step 4: Docs** per the Files list.
- [ ] **Commit point:** `server/src/devices/settings* server/src/http/devices/ docs/` — `Add device settings, re-pair and token rotation`

### Task 6: Device auth and claim

**Files:**

- Create: `server/src/http/device/auth.ts`, `server/src/http/device/auth.test.ts`, `server/src/http/device/claim.ts`, `server/src/http/device/claim.test.ts`
- Modify: `server/src/rateLimit/limiter.ts`, `server/src/http/rateLimit.ts`, `server/src/http/rateLimit.test.ts`, `server/src/http/openapi.ts`, `server/src/http/app.ts`
- Docs: `docs/API.md` §2 claim (decision 1, normalization), `docs/PROJECT_V2.md` §5 (decision 3)

**Interfaces:**

- Consumes: Task 3, `rateLimit`, `AUTH_PER_IP`.
- Produces:
  - `DEVICE_CHECKIN: RateRule = { limit: 6, windowS: 60 }`; `rateLimitKey` scope gains `'device'`; `rateLimit` rules gain `device?: RateRule`, keyed by `getDeviceAuth(res).deviceId`.
  - `requireDevice(deps: Pick<AppDeps, 'db'>): RequestHandler` — Bearer token in the right format, `select id from device where token_hash = $1` (no lock) → `res.locals.device`, else `401 unauthorized`. `getDeviceAuth(res): { deviceId: string; tokenHash: Buffer }`.
  - `openapi.ts` adds security scheme `deviceToken: { type: 'http', scheme: 'bearer' }`.
  - `claimRouter(deps)`, `claimPaths`: `POST /api/v1/device/claim` `{ pairing_code, fw }` → `200 { device_id, device_token, settings: { version, ping_interval_s } }`. Rate limit `rateLimit(limiter, 'claim', { ip: AUTH_PER_IP })`. One transaction: find by `pairing_code_hash` `for update`; none → `404`; `pairing_code_expires_at <= now` → `410 expired`; else decision 3 update.

- [ ] **Step 1: Tests:**
  - auth: no header, `Basic …`, wrong format, unknown token, rotated token → `401`; a valid token sets `deviceId` (test via a tiny route added with `testApp({ routes })`).
  - claim → `200`; `device_token` is 64 hex; the row has `token_hash = sha256(token)`, `claimed_at = now`, `fw_version '2.0.0'`, pairing columns `null`, `boot_id` and `seq` `null`.
  - `'k7q2-m9xd '` claims a device created with `K7Q2M9XD` (Review Focus 1).
  - the same code twice → second is `404`. Expired at exactly 30 min → `410`; at 29 min 59 s → `200`. Unknown → `404`. Malformed (`'abc'`, missing `fw`) → `400`.
  - re-pair a claimed device (new code via Task 5 route) → claim → the old token is `401`, the new one works.
  - rate limit middleware with a `device` rule builds the key `name:device:<sha256 hex of deviceId>`.
- [ ] **Step 2: Run** → FAIL, implement, add a `Device` OpenAPI group after `Devices`, → PASS.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/http/device/ server/src/rateLimit/ server/src/http/ docs/` — `Add device token auth and claim`

### Task 7: Check-in endpoint

**Files:**

- Create: `server/src/notifications/queue.ts`, `server/src/monitoring/diagnostics.ts`, `server/src/monitoring/diagnostics.test.ts`, `server/src/monitoring/checkIn.ts`, `server/src/monitoring/checkIn.test.ts`, `server/src/monitoring/checkIn.pg.test.ts`, `server/src/http/device/ping.ts`, `server/src/http/device/ping.test.ts`
- Modify: `server/src/http/app.ts` (`AppDeps.notifications`), `server/src/api.ts`, `server/test/app.ts`, `server/test/fakes.ts`, `server/test/devices.ts`
- Docs: `docs/API.md` §2 ping (decisions 9–12), `docs/PROJECT_V2.md` §5 (decisions 7, 8)

**Interfaces:**

- Consumes: Tasks 1, 2, 6.
- Produces:
  ```ts
  type OutageEvent = { deviceId: string; outageId: string };
  interface NotificationQueue {
    recovery(tx: Tx, event: OutageEvent): Promise<void>;
    summary(tx: Tx, event: OutageEvent): Promise<void>;
    powerBlip(tx: Tx, event: OutageEvent): Promise<void>;
  }
  noopNotificationQueue: NotificationQueue;

  type WifiReport = { evicted: number; events: Array<{ id: number; kind: DiagnosticKind; start_uptime_s: number; end_uptime_s: number; reason?: number | null }> };
  storeWifiReport(tx: Tx, logger: Logger, a: { deviceId: string; bootId: string; uptimeS: number; now: Date; report: WifiReport }): Promise<void>;

  type CheckIn = { type: CheckInType; bootId: string; seq: number; uptimeS: number; resetReason: ResetReason; rssi: number; fw: string; wifi?: WifiReport };
  recordCheckIn(deps: Pick<AppDeps, 'db' | 'clock' | 'logger' | 'notifications'>, deviceId: string, tokenHash: Buffer, checkIn: CheckIn): Promise<'ACCEPTED' | 'DUPLICATE' | 'UNAUTHORIZED'>;
  ```
  - `pingBodySchema` (decision 10: `reset_reason` `.catch('UNKNOWN')`, `rssi` int −128..127, `seq` and `uptime_s` int 0..2³¹−1, `fw` 1–32 chars, `settings_version` optional, `wifi.events` max 32, `reason` int 0..32767 or null); `pingRouter(deps)`, `pingPaths`: `POST /api/v1/device/ping` → `requireDevice` → `rateLimit(…, 'checkin', { device: DEVICE_CHECKIN })` → `204`; `UNAUTHORIZED` → `401`.
  - Produces (test): `RecordingNotificationQueue implements NotificationQueue { calls: Array<{ kind: 'recovery' | 'summary' | 'powerBlip' } & OutageEvent> }`; `testApp` defaults to a fresh one. `markOffline(db, deviceId, { offAlertQueuedAt?: Date })` sets `OFFLINE`, `offline_at null`, `state_since` = last seen + timeout, and inserts the open outage starting at `last_seen_at`, standing in for the M3 worker. `pingBody(overrides?)` returns a valid `PING` body.
- `recordCheckIn` in one transaction: lock the device by `id` and `token_hash` (`null` → `UNAUTHORIZED`); lock its open outage; `planCheckIn`. On `DUPLICATE`, store Wi-Fi events only. On `ACCEPT`: insert `device_boot` (`on conflict do nothing`) when `boot_id` differs from the device's; persist the event (close the outage with `ended_at = now`, `cause`, `kind`, or insert a closed `OUTAGE` / `POWER_BLIP`); call the matching queue method with the outage ID; store Wi-Fi events; update `state`, `state_since`, `last_seen_at = now`, `offline_at` (`offlineDeadline` when `ONLINE`, else `null`), `boot_id`, `seq`, `uptime_s`, `rssi`, `fw_version`.
- `storeWifiReport`: upsert `device_boot.wifi_evicted` with the greater-than rule (D §6); per valid event insert `device_diagnostic` with `started_at = now − (uptimeS − start_uptime_s) s`, `ended_at = now − (uptimeS − end_uptime_s) s`, `reason = null` for `API`, `on conflict do nothing`. Invalid events → `logger.warn`, skipped.

- [ ] **Step 1: `storeWifiReport` tests:** time estimates for uptime 1260, event 900–948 at `16:42:00Z` → `16:36:00Z`–`16:36:48Z`; the same event twice → one row; `evicted` 3 then 2 → 3; `API` with reason 5 → stored `null`; an event with end < start and one with end > uptime are skipped while a valid one in the same report is stored (Review Focus 3).
- [ ] **Step 2: `recordCheckIn` tests** (PGlite): one per event type, checking the persisted row (`type`, `cause`, `kind`, `duration_s`, `started_at`, `ended_at`) and exactly one queue call of the right kind with that outage ID; a duplicate leaves `last_seen_at`, `seq` and `updated_at` unchanged and makes no queue call; rotated token → `UNAUTHORIZED`.
- [ ] **Step 3: Route tests:** `204` with an empty body; `reset_reason: 'DEEP_SLEEP'` → `204` and the boot row says `UNKNOWN` (Review Focus 2); missing `boot_id`, `type: 'HELLO'`, 33 events → `400`; no token → `401`; with a limiter that denies → `429` with `Retry-After`.
- [ ] **Step 4: Real-Postgres test** (`checkIn.pg.test.ts`): device `ONLINE` on boot `A`; fire two identical `BOOT` check-ins (boot `B`, `POWER_ON`, `seq` 1) with `Promise.all` through `recordCheckIn` → results are one `ACCEPTED` and one `DUPLICATE`, one `POWER_BLIP` row, one `powerBlip` call (Review Focus 5).
- [ ] **Step 5: Run** `npm test -w server` → FAIL then PASS; run the pg test with `TEST_DATABASE_URL` set if a local Postgres is available, otherwise it runs in CI.
- [ ] **Step 6:** `api.ts` passes `notifications: noopNotificationQueue`. Register the router in the `Device` group.
- [ ] **Step 7: Docs** per the Files list.
- [ ] **Commit point:** `server/src/notifications/ server/src/monitoring/ server/src/http/ server/src/api.ts server/test/ docs/` — `Add device check-in endpoint`

### Task 8: Monitoring acceptance scenarios

**Files:**

- Create: `server/src/monitoring/acceptance.test.ts`

**Interfaces:**

- Consumes: Tasks 4–7 through HTTP only (`testApp` with PGlite, `FakeClock`, `RecordingNotificationQueue`), plus `markOffline` for the worker step.

- [ ] **Step 1: Scenarios** (the P §5 acceptance list, server side; each starts from a claimed device and default settings):
  1. **First boot:** `BOOT` `POWER_ON` → `GET /devices/:id` is `ONLINE`, `state_since` = now, no outages, no queue calls.
  2. **Regular pings** every 30 s for 5 min → `last_seen_at` is the last ping, no outages.
  3. **Power reset before the timeout:** `PING` at T, `BOOT` new boot `POWER_ON` at T + 25 s → `ONLINE`; `GET /outages` has one `POWER_BLIP`, `cause: 'POWER'`, `kind: 'SHORT'`, `duration_s: 25`; one `powerBlip` call.
  4. **Wi-Fi-only interruption:** `PING` at T, `markOffline`, `PING` same boot at T + 300 s with a `WIFI` event covering the gap → outage `NETWORK` / `LONG` / 300 s, closed; `GET /diagnostics` lists the event; `summary` call (no OFF alert queued). Variant with `offAlertQueuedAt` set → `recovery` call.
  5. **Software reset:** `BOOT` new boot `SOFTWARE` at T + 20 s → no outage, no call; `telemetry.reset_reason` is `SOFTWARE`.
  6. **Duplicates:** the step 3 `BOOT` resent at T + 27 s → `204`, `last_seen_at` still T + 25 s, still one blip and one call. A `PING` with Wi-Fi event 7 sent twice with the same `seq`, then again with `seq + 1` → one diagnostic row.
  7. **Recovery after the timeout before the worker runs:** `PING` at T, `PING` same boot at T + 150 s → state `ONLINE` throughout, one closed `OUTAGE` `NETWORK` / `SHORT` / 150 s, one `summary` call; resending that check-in → no second outage or call.
  8. **Re-pair:** device `ONLINE` on boot `A`, new pairing code, claim, `BOOT` boot `B` `POWER_ON` → no power blip.
- [ ] **Step 2: Run** → PASS (fix the owning task's code if a scenario fails).
- [ ] **Commit point:** `server/src/monitoring/acceptance.test.ts` — `Add monitoring acceptance tests`

### Task 9: Outage history and diagnostics

**Files:**

- Create: `server/src/http/pagination.ts`, `server/src/http/pagination.test.ts`, `server/src/http/devices/history.ts`, `server/src/http/devices/history.test.ts`
- Modify: `server/src/http/app.ts`
- Docs: `docs/API.md` §4 Outages (decision 14, filters, `limit` default 50), diagnostics section with decision 16 (remove **(proposed)**), §9 gap row

**Interfaces:**

- Consumes: Task 4 (`getAccessibleDevice`, `toOutageItem`).
- Produces:
  - `limitSchema` (`z.coerce.number().int().min(1).max(100).default(50)`); `encodeCursor(values: string[]): string` (base64url JSON); `decodeCursor(cursor: string, arity: number): string[]`, which throws `HttpError(400, 'validation_error', 'Invalid cursor')` for bad base64, bad JSON, the wrong arity or non-strings.
  - `historyRouter(deps)`, `historyPaths`:
    - `GET /api/v1/devices/:id/outages?from&to&type&cause&kind&limit&cursor` (owner) → `{ items: OutageItem[], next_cursor }`, ordered `started_at desc, id desc`, keyset `(started_at, id) < (…)`.
    - `GET /api/v1/devices/:id/diagnostics?from&to&kind&limit&cursor` (owner) → `{ items, next_cursor }`, ordered `started_at desc, boot_id desc, id desc`.

- [ ] **Step 1: Tests:**
  - cursor round trip; tampered, wrong arity, `'%%%'` → `400`.
  - 120 outages, `limit=50` → pages of 50, 50, 20 with no duplicates or gaps and `next_cursor: null` on the last; two outages with the same `started_at` both appear once.
  - filters: `type=POWER_BLIP`, `cause=NETWORK`, `kind=LONG` each narrow correctly; an open outage started before `from` is included (overlap); `from > to` → `400`; `limit=0` and `limit=101` → `400`; `cause=power` (lowercase) → `400`.
  - an open outage item has `ended_at`, `duration_s`, `cause`, `kind` all `null`.
  - diagnostics: newest first, `kind=API` filter, `boot_wifi_evicted` from the boot row, `duration_s = end_uptime_s − start_uptime_s`.
  - stranger → `404` on both; another device's outages never appear.
- [ ] **Step 2: Run** → FAIL, implement, add an `Outages` OpenAPI group after `Device`, → PASS.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/http/pagination* server/src/http/devices/history* server/src/http/app.ts docs/API.md` — `Add outage history and diagnostics`

### Task 10: Fake device script

**Files:**

- Create: `server/scripts/fake-device.ts`, `server/scripts/fake-device.test.ts`
- Modify: `server/package.json` (`"fake-device": "tsx --conditions=source scripts/fake-device.ts"`), `server/tsconfig.json` (include `scripts`), `.gitignore` (`.fake-device.json`)

**Interfaces:**

- Produces:
  ```ts
  type FakeState = { api: string; deviceId: string; token: string; bootId: string | null; seq: number; bootStartedAt: string | null; nextEventId: number };
  nextBoot(state: FakeState, reason: ResetReason, now: Date): { state: FakeState; body: unknown };
  nextPing(state: FakeState, now: Date, wifiDropS?: number): { state: FakeState; body: unknown };
  ```
- CLI (state in `./.fake-device.json`; API from `--api` or `API_URL`, default `http://localhost:3000`):
  - `claim <code>` → saves token and device ID.
  - `boot [--reason POWER_ON]` → one `BOOT` with a new `boot_id`, `seq` 1.
  - `ping [--wifi-drop <s>]` → one `PING` on the saved boot; with `--wifi-drop` it adds a `WIFI` event that ended 5 s ago and lasted `s` seconds.
  - `run [--interval 30] [--reason POWER_ON]` → `boot`, then `ping` every interval until Ctrl+C; prints each status code. Honors `Retry-After` on `429`.

- [ ] **Step 1: Tests** for `nextBoot` / `nextPing` only: new boot ID and `seq` 1 on boot; `seq` increments and `uptime_s` equals seconds since `bootStartedAt` on ping; `--wifi-drop 40` at uptime 300 gives `start_uptime_s` 255, `end_uptime_s` 295, `id` from `nextEventId` (then incremented); `ping` without a boot throws a clear error.
- [ ] **Step 2: Run** → FAIL, implement, → PASS; `npm run typecheck -w server` and `npm run lint` cover the script.
- [ ] **Commit point:** `server/scripts/ server/package.json server/tsconfig.json .gitignore` — `Add fake device script`

### Task 11: OpenAPI coverage, docs and roadmap

**Files:**

- Modify: `server/src/http/openapi.test.ts`, `docs/ROADMAP.md`, `docs/API.md` §7 (tag order now includes `Devices`, `Device`, `Outages`), §9

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: OpenAPI test:** the document has `post /api/v1/device/claim`, `post /api/v1/device/ping`, `get|post /api/v1/devices`, `get|patch|delete /api/v1/devices/{id}`, `post /api/v1/devices/{id}/pairing-code`, `post /api/v1/devices/{id}/rotate-token`, `get /api/v1/devices/{id}/outages`, `get /api/v1/devices/{id}/diagnostics`; device API operations use `deviceToken` security, the others `bearerAuth`; tags in order `Health, Auth, Account, Devices, Device, Outages`; `components.schemas` has `Device`, `DeviceListItem`, `OutageItem`.
- [ ] **Step 2: Full check:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` all exit 0.
- [ ] **Step 3: Roadmap.** Tick the M2 deliverables that merged. The Q14 row gains "✅ M2: `GET /devices/:id/diagnostics`". Reword the classification deliverable to match decision 7. Status board: M2 🟡 until the manual checks pass, then ✅.
- [ ] **Commit point:** `server/src/http/openapi.test.ts docs/` — `Complete M2 docs and OpenAPI coverage`

**M2 done when (ROADMAP):** the controlled-clock scenarios in Task 8 pass (first boot, regular pings, 25 s power blip, Wi-Fi-only interruption, software reset, duplicates, recovery before the worker). Verify by hand on staging:

- Get an access token (log in with `/api/auth/login` from Swagger UI or curl) and create a device with `POST /api/v1/devices`. Note the pairing code.
- From `server/`: `API_URL=https://staging-api.<domain> npm run fake-device -- claim <code>`, then `npm run fake-device -- run`. `GET /api/v1/devices/:id` shows `ONLINE` and `last_seen_at` moving.
- Stop `run`, then `npm run fake-device -- boot --reason POWER_ON` within 2 min → `GET …/outages` shows one `POWER_BLIP`.
- `npm run fake-device -- ping --wifi-drop 40` → `GET …/diagnostics` lists the event.
- Stop pinging for more than 2 min, then `ping` → `GET …/outages` shows a closed `OUTAGE` with cause `NETWORK` (the worker comes in M3, so this is the late-recovery path).
- Rotate the token from Swagger UI → the next `ping` prints `401`.
