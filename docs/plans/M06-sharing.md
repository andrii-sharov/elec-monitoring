# M6 — Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** owners invite family by email; viewers see shared devices, attach their own channels and get alerts in their own language and timezone.

**Architecture:** `getAccessibleDevice()` learns the viewer role (`read` for viewers, `manage` owner-only). New `server/src/sharing/` holds the invite and membership logic, used by a `sharing` router and by the three places an email becomes verified (verify link, password reset, Google sign-up), which auto-accept pending invites. Fan-out widens from "owner's channels" to "channels of anyone who can read the device", with a send-time access check. The client adds a public `/invite` page and a Members section on the Device page.

**Tech Stack:** unchanged from M4 (server: Express 5, Drizzle, Zod, zod-openapi, i18next, Vitest + PGlite + supertest; client: React 19, React Router 8, TanStack Query 5, React Hook Form, shadcn/ui, Vitest + Testing Library + MSW).

**Spec:** [ROADMAP.md § M6](../ROADMAP.md#m6--sharing) · [PROJECT_V2.md](../PROJECT_V2.md) §6, §7 platform bot, §9 Client app · [API.md](../API.md) §1 Errors, §4 Devices, Sharing, Notification channels · [DATABASE.md](../DATABASE.md) §4 `device_viewer`, `device_invite`, §7 `device_channel`, `delivery`.

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints)–[M4](M04-client.md#global-constraints) constraints still applies (ESM, strict TS, UUIDv7 from `newId()`, `clock.now()` only, error shape, no comments, no real names, shared Zod schemas, theme tokens only, MSW with `onUnhandledRequest: 'error'`).
- **No migration in M6.** `device_viewer` and `device_invite` exist since M0. If a task seems to need one, stop and ask.
- Access answers: stranger → `404 not_found` (never leak existence); viewer on an owner-only action → `403 forbidden`; owner → allowed.
- Invite tokens: `randomToken()` (43-char base64url), stored only as `sha256` in `device_invite.token_hash`. Valid **7 days**. Emails stored lowercased (`emailSchema`).
- Emails go out after the transaction commits, through `sendInBackground`. No email inside a transaction.
- Lock order stays `device` row first (D §9). Sharing writes that check limits lock the device row `for update`.
- User-facing text: `app.*` and `email.*` keys in `uk`, `en` and `ru` (parity test). No plural suffixes or `count` variable (M3 rule).
- Every new `/api/v1` endpoint is in the OpenAPI document under the `Sharing` tag, and API.md is updated in the same task.
- JWT-only endpoints (invite create, list, revoke, accept) are marked "JWT" in API.md. Only JWTs exist until M7, which adds the `403 jwt_required` check.

## Decisions made in this plan

Each task records its decisions in the spec. Task 9 marks them in the ROADMAP.

1. **Access.** `getAccessibleDevice(db, userId, deviceId, need, { lock })` returns `OWNER` for the owner and `VIEWER` for a `device_viewer` row. A viewer with `need = 'manage'` → `403 forbidden` ("Only the device owner can do this"). Neither → `404`.
   - `read` (owner, viewer): `GET /devices/:id`, `GET /devices/:id/outages`, `GET /devices/:id/members`, `GET|PUT /devices/:id/channels`, `DELETE /devices/:id/members/:userId` (viewer: self only).
   - `manage` (owner): `PATCH|DELETE /devices/:id`, `pairing-code`, `rotate-token`, `diagnostics`, `POST|GET /devices/:id/invites`, `DELETE /devices/:id/invites/:inviteId`.
2. **`GET /devices`** returns owned and shared devices together, oldest first by `device.created_at`, each with its `role`. The 20-device cap counts owned devices only.
3. **Create invite** `POST /devices/:id/invites` strict `{ email }` → `201 Invite`. JWT, verified email, owner. Rate limit `INVITE_PER_USER` = 10 / h per user. In one transaction with the device locked:
   - The owner's email or a current viewer's email → `409 conflict` with detail `{ path: 'email', code: 'already_member' }`.
   - Viewers + unexpired pending invites for **other** emails ≥ 10 → `409 conflict` without details ("Member limit reached").
   - Upsert on `(device_id, email) where accepted_at is null`: new token hash, `expires_at = now + 7 d`, `invited_by = caller`, `created_at = now`. The previous link stops working.
   - The email goes in the recipient account's `language`, or `uk` without an account. Link: `${urls.client}/invite?token=<token>`.
4. **Invite object** `{ id, email, expires_at, created_at }`. `GET /devices/:id/invites` → `{ items }`, pending invites (`accepted_at is null`) including expired ones, oldest first. `DELETE /devices/:id/invites/:inviteId` → `204`. An unknown invite or one from another device → `404`.
5. **Preview** `GET /invites/:token` (public, `AUTH_PER_IP`) → `200 { device_name, inviter_name, email, expires_at, accepted }`. An unknown, revoked or expired token → `410 expired`. An accepted invite before `expires_at` → `200` with `accepted: true`, so the page still renders after an auto-accept.
6. **Accept** `POST /invites/:token/accept` (JWT, email need **not** be verified) → `200 Device`. In one transaction, the device row locked first, then the invite row (D §9 lock order; `applyPendingInvites` locks its devices by ID first too):
   - Unknown or expired → `410`. Caller email ≠ invite email → `403 forbidden`.
   - Already accepted: caller is a viewer of the device → `200` with the device (idempotent). Otherwise → `410`.
   - Caller owns the device → mark accepted and return the device as `OWNER`, no viewer row.
   - Otherwise set `accepted_at`, insert the viewer (`on conflict do nothing`), attach the caller's channels (decision 8) and set `email_verified_at = coalesce(email_verified_at, now)`: the link proves the inbox, as with reset (P §3).
7. **Auto-accept on verification.** `applyPendingInvites(tx, clock, user)` accepts every pending, unexpired invite for `user.email` (skipping devices the user owns), inserts viewers and attaches channels. It runs in the same transaction where the email **becomes** verified: `POST /api/auth/verify-email`; `POST /api/auth/reset-password` only when the account was unverified; Google sign-in creating an account or verifying an unverified one. Not on plain log in.
8. **Channels follow membership.** Joining (accept or auto-accept) attaches **all** of the viewer's channels to the device (`on conflict do nothing`). A new platform Telegram link attaches to every device the user owns **or views**. Leaving or removal deletes the user's `device_channel` rows for that device in the same transaction.
9. **Members** `GET /devices/:id/members` → `{ items: Member[] }`, `Member = { user_id, name, email, role, joined_at }`. The owner comes first (`joined_at = device.created_at`), then viewers by `device_viewer.created_at, user_id`. `email` is set when the caller is the owner or the member is the caller, else `null`.
10. **Remove / leave** `DELETE /devices/:id/members/:userId` (scope write) → `204`. Owner: any viewer; the owner's own ID → `409 conflict`; not a member → `404`. Viewer: only themselves, else `403 forbidden`. Stranger → `404`.
11. **Fan-out** queues to enabled channels whose user is the owner **or a current viewer**. At send time `claimDeliveries` also reports `hasAccess`; a delivery whose user lost access becomes `FAILED` with `skipped: no access` (checked before `channel disabled` and `outage closed`), with no channel failure.
12. **Invite email** `email.deviceInvite.*` (en): subject `{{inviter}} shared {{device}} with you`; intro `{{inviter}} invited you to see the status of {{device}} in Electricity Monitor and get its alerts.`; action `Open invite`; expiry `This invite is valid for 7 days.`; then the existing footer.
13. **Client invite flow** (`/invite?token=…`, public like `/verify-email`):
    - `410` → "This invite has expired or was revoked. Ask the owner for a new one."
    - Signed out → "{{inviter}} invited you to {{device}}" with **Create account** (`/signup?email=<e>&invite=1`), **Log in** (`/login?email=<e>&next=<this page>`) and Google (`next` = this page).
    - Signed in, other email → "This invite is for {{email}}. You're signed in as {{current}}." with **Sign out**.
    - Signed in, same email → **Accept** (or **Open device** when `accepted`), both `POST accept` → `/devices/:id`.
    - Sign-up and log in prefill `?email=`. With `invite=1`, the sign-up "check your email" screen adds "After you confirm your email, the shared device appears in your list."
14. **Members section** on the Device page, below channels. Everyone sees the members list. The owner gets per-viewer **Remove** (confirm), the invite form, and pending invites with **Resend** (same `POST`) and **Revoke**; an expired invite shows "Expired". The form is disabled with a hint at 10 members + unexpired invites. A viewer gets **Leave** (confirm) → `/devices` with a toast. The "Shared" marker in the Devices list already exists in all four app styles (M4).
15. **Proposed endpoints accepted (Q14):** `GET /devices/:id/invites`, `DELETE /devices/:id/invites/:inviteId`, `GET /invites/:token`.

## Review Focus

1. **The invitee signs in with a different account** (Google with another address, or an existing session) → the invite page shows the mismatch, `accept` answers `403`, and nothing is joined. Tests in Tasks 4 and 7.
2. **The owner resends an invite** → the first link answers `410`, the new one works, there is one pending row, and accepting gives exactly one viewer. Tests in Tasks 3 and 4.
3. **A viewer is removed while their OFF alert is queued** → their delivery is skipped with `skipped: no access`; the owner's delivery for the same outage is sent. Tests in Task 6.
4. **A device named `<b>Дім & "Home"` and an inviter name with emoji** → the invite email's HTML is escaped and the text part is verbatim. Tests in Task 2.
5. **A new Google user lands back on the invite page after auto-accept, or two tabs accept at once** → both get `200` with the device, one viewer row, channels attached once. Tests in Task 4.

---

## File structure

```
shared/src/api/sharing.ts                 sharing schemas (new), re-exported from shared/src/api/index.ts
shared/src/i18n/locales/{uk,en,ru}.ts     + email.deviceInvite.*, app.members.*, app.invite.*, app.auth.signup.inviteNote
server/src/devices/access.ts              viewer role, 403 for viewer on manage
server/src/devices/queries.ts             findDeviceViews: owned + shared
server/src/sharing/invites.ts             createInvite, findInviteByToken, acceptInvite, applyPendingInvites
server/src/sharing/members.ts             listMembers, removeMember, attachUserChannels
server/src/http/sharing/sharing.ts        sharingRouter, sharingPaths
server/src/email/templates.ts             + renderInviteEmail
server/src/rateLimit/limiter.ts           + INVITE_PER_USER
server/src/http/auth/{signup,password,google}.ts   call applyPendingInvites
server/src/notifications/queue.ts         fan-out to viewers
server/src/notifications/deliveries.ts    + hasAccess on claimed rows
server/src/notifications/deliveryLoop.ts  skip "no access"
server/src/telegram/bot.ts                link attaches owned + viewed devices
server/src/http/app.ts                    Sharing group + router
server/test/sharing.ts                    addViewer, seedInvite
server/src/http/devices/access.test.ts    role matrix
client/src/api/{endpoints,queries}.ts     sharing calls and hooks
client/src/pages/invite/InvitePage.tsx    /invite
client/src/pages/devices/DeviceMembers.tsx   members, invites, leave
client/src/pages/auth/{SignupPage,LoginPage}.tsx   ?email= prefill, invite note
client/src/app/router.tsx                 + /invite
client/test/fixtures.ts                   + memberFixture, inviteFixture, invitePreviewFixture
```

Tests sit next to the code. Run one file with `npm test -w server -- <path>` or `npm test -w client -- <path>`.

---

### Task 1: Viewer access and shared devices in the list

**Files:**

- Modify: `server/src/devices/access.ts`, `server/src/devices/queries.ts`, `server/src/http/devices/devices.ts` (OpenAPI `403` responses on owner-only operations, list description), `server/src/http/devices/history.ts` (`403` on diagnostics)
- Create: `server/test/sharing.ts`, `server/src/http/devices/access.test.ts`
- Docs: `docs/API.md` §4 Devices (`GET /devices` returns shared devices with `role`, oldest first by creation; viewer `403`)

**Interfaces:**

- Produces:
  - `getAccessibleDevice(db: Executor, userId: string, deviceId: string, need: DeviceAccess, options?: { lock?: boolean }): Promise<{ device: DeviceRow; role: DeviceRole }>`, same signature, decision 1. With `lock`, lock only the `device` row (`for update of device`).
  - `findDeviceViews(db: Executor, userId: string): Promise<DeviceView[]>`: owned (`OWNER`) and viewed (`VIEWER`) devices, ordered by `device.created_at, device.id`.
  - `addViewer(db: Db, deviceId: string, userId: string): Promise<void>` in `server/test/sharing.ts`.

- [ ] **Step 1: Role matrix test** in `access.test.ts`. Users `owner`, `viewer` (via `addViewer`) and `stranger`, one paired device. One table-driven test per row, expected status per role:

  | Request                                  | owner | viewer | stranger |
  | ---------------------------------------- | ----- | ------ | -------- |
  | `GET /api/v1/devices/:id`                | 200   | 200    | 404      |
  | `PATCH /api/v1/devices/:id` `{name:'X'}` | 200   | 403    | 404      |
  | `DELETE /api/v1/devices/:id`             | 204   | 403    | 404      |
  | `POST /api/v1/devices/:id/pairing-code`  | 201   | 403    | 404      |
  | `POST /api/v1/devices/:id/rotate-token`  | 204   | 403    | 404      |
  | `GET /api/v1/devices/:id/outages`        | 200   | 200    | 404      |
  | `GET /api/v1/devices/:id/diagnostics`    | 200   | 403    | 404      |
  | `GET /api/v1/devices/:id/channels`       | 200   | 200    | 404      |
  | `PUT /api/v1/devices/:id/channels` `[]`  | 200   | 200    | 404      |

  Tasks 3–5 append their sharing rows to this table. Plus:
  - The viewer's `GET /devices/:id` has `role: 'VIEWER'`; the owner's has `'OWNER'`.
  - `GET /devices` for a user who owns device B (created second) and views device A (created first) → `[A (VIEWER), B (OWNER)]`.
  - A viewer's `403` body is `{ error: { code: 'forbidden', … } }`, and the device is unchanged after the viewer's `PATCH` / `DELETE`.
  - The owner with 20 owned devices plus one shared still gets `409` on the 21st create, and a user with 19 owned and 5 shared can create one.

- [ ] **Step 2: Run** `npm test -w server -- src/http/devices/access.test.ts` → FAIL (viewer gets `404`).
- [ ] **Step 3: Implement** decision 1 in `access.ts` (left join `device_viewer` on `(device_id, user_id = $user)`), and decision 2 in `findDeviceViews` (`owner_id = $user or exists device_viewer`, role from the same join).
- [ ] **Step 4: Run** the file and the existing `devices.test.ts`, `history.test.ts`, `channels.test.ts` → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `server/src/devices/ server/src/http/devices/ server/test/sharing.ts docs/API.md` — `Give viewers read access to shared devices`

### Task 2: Sharing schemas and the invite email

**Files:**

- Create: `shared/src/api/sharing.ts`
- Modify: `shared/src/api/index.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts` (`email.deviceInvite.*`), `server/src/email/templates.ts`, `server/src/email/templates.test.ts`

**Interfaces:**

- Produces (`@elec/shared/api`):
  - `memberSchema` (`.meta({ id: 'Member' })`) `{ user_id: uuid, name: string, email: string | null, role: DeviceRole, joined_at: isoDate }`; `membersSchema = { items: Member[] }`.
  - `inviteSchema` (`.meta({ id: 'Invite' })`) `{ id: uuid, email, expires_at, created_at }`; `invitesSchema = { items: Invite[] }`.
  - `createInviteBodySchema = z.strictObject({ email: emailSchema })`.
  - `invitePreviewSchema` (`.meta({ id: 'InvitePreview' })`) `{ device_name, inviter_name, email, expires_at, accepted: boolean }`.
  - `memberParamsSchema = { id: uuid, userId: uuid }`, `inviteParamsSchema = { id: uuid, inviteId: uuid }`, `inviteTokenParamsSchema = { token: z.string().min(1).max(128) }`.
  - Types `Member`, `Invite`, `InvitePreview`.
- Produces (server): `renderInviteEmail(i18n: i18n, vars: { lang: Language; inviter: string; device: string; link: string }): RenderedEmail`, reusing `layout()` and `escapeHtml()`.

- [ ] **Step 1: Tests** in `templates.test.ts`:
  - `en`, inviter `John`, device `Home` → subject `John shared Home with you`; text contains the intro, `Open invite:`, the link, `This invite is valid for 7 days.` and the footer.
  - `uk` and `ru` render their own subject (not the English one).
  - Device `<b>Дім & "Home"`, inviter `John 🔌` → HTML contains `&lt;b&gt;Дім &amp; &quot;Home&quot;` and no `<b>`; the text part contains `<b>Дім & "Home"` verbatim.
  - The parity test passes with the new keys.
- [ ] **Step 2: Run** `npm test -w server -- src/email/templates.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schemas, the keys (decision 12 for `en`; translate for `uk` and `ru`) and `renderInviteEmail`. The i18next interpolation of `inviter` and `device` must not HTML-escape (the template escapes once).
- [ ] **Step 4: Run** the server and shared tests → PASS. `npm run typecheck` → 0.
- [ ] **Commit point:** `shared/src/ server/src/email/` — `Add sharing schemas and invite email`

### Task 3: Create, list, revoke and preview invites

**Files:**

- Create: `server/src/sharing/invites.ts`, `server/src/http/sharing/sharing.ts`, `server/src/http/sharing/invites.test.ts`
- Modify: `server/src/rateLimit/limiter.ts`, `server/src/http/app.ts` (`Sharing` group after `Notifications`, router), `server/test/sharing.ts`, `server/src/http/devices/access.test.ts`
- Docs: `docs/API.md` §4 Sharing (decisions 3–5, 15; remove the three **(proposed)** markers), §1 Rate limits (`Invites: 10 / h per user`), §9 gap row ✅

**Interfaces:**

- Consumes: `getAccessibleDevice`, `requireUser`, `requireVerifiedEmail`, `rateLimit`, `randomToken`, `sha256`, `renderInviteEmail`, `sendInBackground`, the Task 2 schemas.
- Produces:
  - `INVITE_PER_USER: RateRule = { limit: 10, windowS: 3600 }`; `INVITE_TTL_MS = 7 * 24 * 3600 * 1000`; `MAX_MEMBERS = 10`.
  - `createInvite(tx: Tx, clock: Clock, input: { deviceId: string; email: string; invitedBy: string }): Promise<{ invite: InviteRow; token: string }>`: decision 3 checks and the upsert. The caller has already locked the device.
  - `findInviteByToken(db: Executor, token: string): Promise<InviteRow | null>`.
  - `sharingRouter(deps: AppDeps): Router`, `sharingPaths: ZodOpenApiPathsObject`.
  - `seedInvite(db: Db, o: { deviceId: string; invitedBy: string; email: string; expiresAt?: Date; acceptedAt?: Date | null }): Promise<{ id: string; token: string }>` in `server/test/sharing.ts`.

- [ ] **Step 1: Tests** in `invites.test.ts` (controlled clock at `2026-11-21T16:42:00Z`):
  - Create `{ email: ' Mary@Example.com ' }` → `201` with `email: 'mary@example.com'`, `expires_at` = now + 7 d. One email to `mary@example.com`, in `uk` (no account), whose link is `https://app.test/invite?token=<43 chars>`; only `sha256(token)` is stored.
  - An existing account with `language: 'en'` → the email is in English.
  - Create again for the same email → still one pending row, new `expires_at`; the first token's preview → `410`, the second → `200`.
  - The owner's email → `409` with detail `email` / `already_member`. A viewer's email → the same.
  - 9 viewers + 1 unexpired pending invite → a new email gets `409` without details. An expired pending invite does not count. Re-inviting one of the pending emails at the limit → `201`.
  - Unverified owner → `403 email_not_verified`. Denying limiter → `429`. Unknown body key → `400`.
  - `GET /devices/:id/invites` → pending ones (expired included) oldest first; accepted ones not listed.
  - `DELETE …/invites/:inviteId` → `204`, then the token's preview → `410`. An invite ID from another device → `404`.
  - Preview → `{ device_name: 'Home', inviter_name: 'John', email, expires_at, accepted: false }`. At `expires_at + 1 s` → `410`. An unknown token → `410`. An accepted invite before expiry → `accepted: true`.
  - Role matrix rows added in `access.test.ts`: `POST|GET /devices/:id/invites`, `DELETE /devices/:id/invites/:inviteId` → owner 201/200/204, viewer 403, stranger 404.
- [ ] **Step 2: Run** `npm test -w server -- src/http/sharing` → FAIL.
- [ ] **Step 3: Implement.** Create: `getAccessibleDevice(tx, …, 'manage', { lock: true })`, then `createInvite`, then send the email after commit (look up an account by email for the language).
- [ ] **Step 4: Run** the sharing and access tests → PASS. Update the OpenAPI snapshot (`npm test -w server -- -u src/http/openapi.snapshot.test.ts`) and check the diff only adds the Sharing paths and schemas.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `server/src/sharing/ server/src/http/ server/src/rateLimit/ server/test/sharing.ts docs/API.md` — `Add device invites`

### Task 4: Accept invites and auto-accept on verification

**Files:**

- Modify: `server/src/sharing/invites.ts`, `server/src/http/sharing/sharing.ts`, `server/src/http/auth/signup.ts`, `server/src/http/auth/password.ts`, `server/src/http/auth/google.ts`
- Create: `server/src/sharing/members.ts` (only `attachUserChannels` here; Task 5 adds the rest), `server/src/http/sharing/accept.test.ts`
- Modify tests: `server/src/http/auth/signup.test.ts`, `password.test.ts`, `google.test.ts`
- Docs: `docs/API.md` §4 Sharing (decision 6), `docs/PROJECT_V2.md` §6 (decisions 6–8: auto-accept, channels follow membership, accept verifies the email), §3 (verification also accepts pending invites)

**Interfaces:**

- Consumes: `findInviteByToken`, `seedInvite`, `findDeviceView`, `toDevice`.
- Produces:
  - `attachUserChannels(tx: Tx, userId: string, deviceId: string): Promise<void>`.
  - `acceptInvite(tx: Tx, clock: Clock, token: string, user: { id: string; email: string }): Promise<{ deviceId: string; role: DeviceRole }>`: throws `HttpError` 410 / 403 per decision 6.
  - `applyPendingInvites(tx: Tx, clock: Clock, user: { id: string; email: string }): Promise<string[]>`: returns the joined device IDs.

- [ ] **Step 1: Tests** in `accept.test.ts`:
  - Mary (matching email, one platform channel and one webhook) accepts → `200` with `role: 'VIEWER'`; `GET /devices/:id/channels` as Mary lists both channels; `accepted_at` = now.
  - Accept at `expires_at − 1 s` → `200`; a fresh invite accepted at `expires_at + 1 s` → `410`.
  - Another account → `403 forbidden`, no viewer row. No JWT → `401`.
  - Accept twice in a row → both `200`, one viewer row, channel links unchanged. Two accepts with `Promise.all` → both `200`, one viewer row.
  - Accepted, then the owner removes Mary (delete the viewer row), then Mary accepts again → `410`.
  - An unverified Mary accepts → `200` and `email_verified_at` is set.
  - A revoked invite → `410`.
  - **Sign-up-then-accept:** invite `mary@example.com` → `POST /api/auth/signup` as Mary → verify with the emailed token → Mary logs in → `GET /devices` has the device as `VIEWER`. Then `POST /invites/:token/accept` → `200` (idempotent). An expired pending invite is not applied.
- [ ] **Step 2: Auth tests:**
  - `password.test.ts`: reset for an unverified account with a pending invite → joined. Reset for an already verified account with a pending invite → not joined.
  - `google.test.ts`: a new Google account with a pending invite → joined. Google sign-in that verifies an existing unverified account → joined. Google sign-in to an already verified account → not joined.
- [ ] **Step 3: Run** `npm test -w server -- src/http/sharing src/http/auth` → FAIL.
- [ ] **Step 4: Implement** decisions 6–8. `acceptInvite` locks the invite row (`for update`), then the viewer insert uses `on conflict do nothing`. In `password.ts`, read `email_verified_at` before the update to decide. In `google.ts`, call it in the new-account and the `unverified` branches.
- [ ] **Step 5: Run** all server tests → PASS.
- [ ] **Step 6: Docs** per the Files list.
- [ ] **Commit point:** `server/src/sharing/ server/src/http/ docs/` — `Accept invites and apply them on verification`

### Task 5: Members list, remove and leave

**Files:**

- Modify: `server/src/sharing/members.ts`, `server/src/http/sharing/sharing.ts`, `server/src/http/devices/access.test.ts`
- Create: `server/src/http/sharing/members.test.ts`
- Docs: `docs/API.md` §4 Sharing (decisions 9–10, the `Member` object)

**Interfaces:**

- Produces:
  - `listMembers(db: Executor, deviceId: string, caller: { id: string; role: DeviceRole }): Promise<Member[]>`.
  - `removeMember(tx: Tx, deviceId: string, userId: string): Promise<boolean>`: deletes the viewer row and the user's `device_channel` rows for the device; `false` when no viewer row existed.

- [ ] **Step 1: Tests:**
  - Owner John + viewers Mary, Pete → owner sees `[John OWNER, Mary, Pete]` with all emails. Mary sees the same order with John's and Pete's `email: null` and her own email set.
  - Owner removes Mary → `204`; Mary's `GET /devices/:id` → `404`; Mary's links to this device are gone, her links to another device stay; Pete's links stay.
  - Mary leaves (`DELETE …/members/<mary>`) → `204`. Mary removes Pete → `403`. Owner removes themselves → `409`. Owner removes a non-member → `404`. Stranger → `404`.
  - Role matrix rows: `GET /devices/:id/members` owner 200, viewer 200, stranger 404.
- [ ] **Step 2: Run** `npm test -w server -- src/http/sharing/members.test.ts` → FAIL, implement, → PASS.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/sharing/ server/src/http/ docs/API.md` — `Add device members, remove and leave`

### Task 6: Viewers in fan-out, send-time access and Telegram linking

**Files:**

- Modify: `server/src/notifications/queue.ts`, `queue.test.ts`, `deliveries.ts`, `deliveries.test.ts`, `deliveryLoop.ts`, `deliveryLoop.test.ts`, `server/src/telegram/bot.ts`, `bot.test.ts`
- Docs: `docs/DATABASE.md` §7 `delivery` (skipped `no access`), `docs/PROJECT_V2.md` §7 platform bot (link attaches owned and shared devices), `docs/API.md` §4 `POST /channels/telegram-link`

**Interfaces:**

- Consumes: `addViewer`, `createPlatformChannel`, `linkChannel`, `seedDelivery`.
- Produces: `ClaimedDelivery` gains `hasAccess: boolean` (the channel's user owns or views the outage's device).

- [ ] **Step 1: Tests:**
  - `queue.test.ts`: owner channel + viewer channel + a stranger's channel linked to the device (insert the link directly) → an OFF alert queues for the owner and the viewer only. A disabled viewer channel → not queued. A viewer webhook without `device.offline` → not queued.
  - `deliveryLoop.test.ts` (Review Focus 3): queue an OFF alert for owner and viewer, remove the viewer, run the loop → owner's `SENT`, viewer's `FAILED` with `last_error = 'skipped: no access'`, viewer channel `consecutive_failures` unchanged, no Telegram call for it.
  - `deliveryLoop.test.ts`: the viewer renders in their own language and timezone (`en`, `America/New_York`) while the owner's is `uk`, `Europe/Kyiv`.
  - `bot.test.ts`: `/start <code>` by a user who owns A and views B → the new channel is linked to A and B, not to a stranger's device C.
- [ ] **Step 2: Run** `npm test -w server -- src/notifications src/telegram` → FAIL.
- [ ] **Step 3: Implement** decision 11 and the linking half of decision 8. One SQL predicate, "the user owns or views the device", reused by the queue and the claim query.
- [ ] **Step 4: Run** all server tests (and `*.pg.test.ts` with `TEST_DATABASE_URL` if set) → PASS.
- [ ] **Step 5: Docs** per the Files list.
- [ ] **Commit point:** `server/src/notifications/ server/src/telegram/ docs/` — `Notify viewers and skip lost access`

### Task 7: Client invite page and invite-aware sign-up

**Files:**

- Create: `client/src/pages/invite/InvitePage.tsx`, `InvitePage.test.tsx`
- Modify: `client/src/api/endpoints.ts`, `client/src/api/queries.ts`, `client/src/app/router.tsx`, `client/src/pages/auth/SignupPage.tsx`, `LoginPage.tsx`, `SignupPage.test.tsx`, `LoginPage.test.tsx`, `client/test/fixtures.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.invite.*`, `app.auth.signup.inviteNote`)
- Docs: `docs/PROJECT_V2.md` §9 Pages (Invite page, decision 13)

**Interfaces:**

- Produces (`endpoints.ts`): `getMembers(api, id)`, `removeMember(api, id, userId)`, `getInvites(api, id)`, `createInvite(api, id, body)`, `revokeInvite(api, id, inviteId)`, `getInvitePreview(api, token)`, `acceptInvite(api, token): Promise<Device>`.
- Produces (`queries.ts`): `queryKeys.members(id)`, `queryKeys.invites(id)`, `queryKeys.invitePreview(token)`; `useMembers(id)`, `useInvites(id, { enabled })`, `useInvitePreview(token)`.
- Produces (`fixtures.ts`): `memberFixture`, `inviteFixture`, `invitePreviewFixture`.

- [ ] **Step 1: Tests** in `InvitePage.test.tsx` (`renderRoute('/invite?token=t1', { me })`):
  - Signed out → "John invited you to Home"; **Create account** links to `/signup?email=mary%40example.com&invite=1`; **Log in** links to `/login?email=mary%40example.com&next=%2Finvite%3Ftoken%3Dt1`.
  - Preview `410` → the expired message, no buttons.
  - Signed in as `pete@example.com` → the mismatch text with both emails and **Sign out**; no Accept.
  - Signed in as Mary → **Accept** → `POST /api/v1/invites/t1/accept` → lands on `/devices/<id>`. With `accepted: true` the button reads **Open device** and does the same.
  - Accept answers `403` → the mismatch message; `410` → the expired message.
  - No `token` param → the expired message.
- [ ] **Step 2: Sign-up and log-in tests:** `/signup?email=mary%40example.com&invite=1` prefills the email; after `201` the check-email screen shows the invite note. `/login?email=…` prefills the email. Without the params nothing changes.
- [ ] **Step 3: Run** `npm test -w client -- src/pages/invite src/pages/auth` → FAIL, implement (route `invite` next to `verify-email`, outside `RequireAnon` and `RequireAuth`; `AuthLayout`), → PASS.
- [ ] **Step 4: Docs** per the Files list.
- [ ] **Commit point:** `client/ shared/src/i18n/ docs/PROJECT_V2.md` — `Add invite page`

### Task 8: Members section on the Device page

**Files:**

- Create: `client/src/pages/devices/DeviceMembers.tsx`, `DeviceMembers.test.tsx`
- Modify: `client/src/pages/devices/DevicePage.tsx`, `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.members.*`)
- Docs: `docs/PROJECT_V2.md` §9 Device page (decision 14)

**Interfaces:**

- Consumes: Task 7 endpoints and hooks, `ConfirmDialog`, `TextField`, `applyServerErrors`.
- Produces: `DeviceMembers({ device }: { device: Device })`, rendered under `DeviceChannels`.

- [ ] **Step 1: Tests:**
  - Owner sees members with emails, the invite form and pending invites. An expired invite shows "Expired" and **Resend**. **Revoke** → `DELETE` and the row disappears.
  - Invite `mary@example.com` → `POST` with that body, the field clears, a toast, and the invites list refetches. A `409` with detail `email` / `already_member` → the message on the email field. An invalid email → a validation message before submit.
  - 9 members + 1 unexpired invite → the form is disabled with the limit hint.
  - **Remove** Mary → a confirm dialog → `DELETE …/members/<mary>` → the list refetches.
  - Viewer sees the members list without emails of others, no invite form, no Remove, and `GET …/invites` is never requested. **Leave** → confirm → `DELETE …/members/<me>` → `/devices` and a toast.
  - Every interactive control is reachable by keyboard (tab to the form, Enter submits).
- [ ] **Step 2: Run** `npm test -w client -- src/pages/devices/DeviceMembers.test.tsx` → FAIL, implement, → PASS. Run the whole client suite → PASS (the existing `DevicesPage.test.tsx` already checks the Shared marker).
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `client/src/pages/devices/ shared/src/i18n/ docs/PROJECT_V2.md` — `Add members and invites to the device page`

### Task 9: OpenAPI coverage, docs and roadmap

**Files:**

- Modify: `server/src/http/openapi.test.ts`, `docs/ROADMAP.md`, `docs/API.md` §7 (tag order adds `Sharing`), §9 Inconsistencies "Invites" bullet (resolved: invites JWT only, member removal `write`)

- [ ] **Step 1: OpenAPI test:** the document has `get /api/v1/devices/{id}/members`, `delete /api/v1/devices/{id}/members/{userId}`, `post|get /api/v1/devices/{id}/invites`, `delete /api/v1/devices/{id}/invites/{inviteId}`, `get /api/v1/invites/{token}` (no security) and `post /api/v1/invites/{token}/accept` (`bearerAuth`). The tag order ends with `Notifications, Sharing`. `components.schemas` has `Member`, `Invite`, `InvitePreview`.
- [ ] **Step 2: Full check:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` all exit 0.
- [ ] **Step 3: Roadmap:**
  - Tick the merged M6 deliverables.
  - The Q14 row gains "✅ M6: `GET` / `DELETE /devices/:id/invites`, `GET /invites/:token`".
  - Status board: M6 🟡 until the manual checks pass, then ✅.
- [ ] **Commit point:** `server/src/http/openapi.test.ts docs/` — `Complete M6 docs and OpenAPI coverage`

**M6 done when (ROADMAP):** the Task 1 role matrix (with the Task 3 and 5 rows), the Task 4 expiry and sign-up-then-accept tests pass.

Verify by hand on staging, with two accounts:

- As the owner, invite the second email from the Device page. The invite email arrives in the right language, and the pending invite shows on the page.
- Open the link signed out, create the account from the invite page, confirm the email, log in. The device is in the list with the Shared marker.
- As the viewer, connect Telegram. The new chat is attached to the shared device. Stop the fake device: both the owner and the viewer get the 🔴 and 🟢 messages, each in their own language and time zone.
- As the viewer: no Settings button, and the Members section has Leave and no invite form.
- Resend an invite: the old link shows "expired", the new one works. Revoke one: its link shows "expired".
- Open an invite while signed in as the wrong account: the mismatch message shows, and Sign out leads to the log in page.
- Remove the viewer: the device disappears from their list, and their Telegram gets nothing for the next outage.
