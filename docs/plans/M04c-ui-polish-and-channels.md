# M4c — UI polish, history periods, channels and timings

Follow-up to [M4b](M04b-device-page-and-brand.md). Status: **approved, in progress.** Items marked
_(assumption)_ are calls made in the draft.

## Decisions from review

- Periods: Day · Week · Month · Year · Custom, with a calendar heatmap for
  Year.
- Notifications: build the server additions now, in the existing backend
  structure. The page must stay manageable with 10+ channels.
- No own Telegram bot: only the platform bot and webhooks. Remove
  `TELEGRAM_BOT` everywhere.
- Kind and cause are shown as styled tags, not just colors.
- Public links have three levels: current state · state + history ·
  state + history + people.
- Timings: ping minimum 5 s, default 20 s; offline timeout minimum 10 s,
  default 40 s.
- Bot messages hide long links behind buttons or link text.

## Findings

| #   | Point                     | What the code does today                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Tabs content shows late   | `[data-motion='enter']` runs `app-rise` for `--app-motion-duration × 2` with fill `both`, so content stays invisible during its delay and run. Lamp's token is 650 ms → **1.3 s**, Sonar 450 ms → 0.9 s. Tab panels animate, and the rows inside them animate again with a 60 ms stagger per row, uncapped, so a 20-row table waits about 1.2 s more before the last row shows. Switching tabs remounts the panel and restarts all of it.                                        |
| 7   | Lamp blinks while online  | `LampStatusMark` renders `.lamp-glow` whenever the state is `ONLINE`, and its CSS runs `lamp-flicker` on mount. So it flickers every time the mark mounts (opening a page, switching tabs, a remount after a refetch), not only when the state changes. `theme.md` says it should play only on a real change. Classic, Sonar and Switchboard already gate theirs through `useStateChange`. Other "blinks" come from the same entrance animation in point 3 replaying on remount. |
| 5   | Toast in the old language | `ProfileForm` calls `toast.success(t(...))` with the `t` captured before the mutation; `useUpdateMe` calls `void i18n.changeLanguage(...)` without waiting for it.                                                                                                                                                                                                                                                                                                               |
| 4   | Table and grid scroll     | The grid has `min-w-176` and 24 cells × `min-w-6`, so it is wider than its box below about 760 px. The table has `min-w-xl`.                                                                                                                                                                                                                                                                                                                                                     |
| 11  | Hero shows everything     | `DeviceTelemetry` (used by every style's hero) lists since, last seen, signal and uptime as equal lines.                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Notifications page        | It lists channels with type and status badges, Delete, and "Connect Telegram". The API already has `GET` / `DELETE /channels`, `POST /channels/telegram-link`, and `GET` / `PUT /devices/:id/channels`. `PATCH /channels/:id`, `POST /channels/:id/test`, `POST /channels` (webhook) and deliveries are in API.md but **not built** (M8). There is no way to see which devices use a channel without asking each device.                                                         |
| 12  | Webhooks                  | Already specified (P §7 Webhooks, A §4) and planned as **M8**: signed requests, retries, SSRF guard, delivery log, redeliver.                                                                                                                                                                                                                                                                                                                                                    |
| 13  | Public links              | Not in the spec or roadmap.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1   | Short / long              | `kind` is stored on the outage when it closes, using the owner's threshold at that moment, and is shown as plain grey text.                                                                                                                                                                                                                                                                                                                                                      |
| —   | Bot messages with links   | Password reset, "you already have an account" and device invite texts end with a raw `{{link}}` (`server/src/telegram/bot.ts`, `pushes.ts`), so users see the long token URL. Messages go out as plain text without `parse_mode`.                                                                                                                                                                                                                                                |
| —   | Own Telegram bot          | `TELEGRAM_BOT` exists in `channelTypes`, the `notification_channel` checks, a `telegram_bot_token_enc` column, API.md, DATABASE.md, spec §7 and M8. Nothing uses it yet.                                                                                                                                                                                                                                                                                                         |
| —   | Timings                   | Server allows ping 15–600 s (default 30) and offline timeout 30–3600 s (default 120). The rate limit is 6 check-ins per minute per device. The worker loop runs every 10 s (`server/src/worker.ts`). Firmware `kMinPingS = 15`: a lower value is ignored and the board uses 30 s.                                                                                                                                                                                                |

## Phase A — Bugs and motion guard rails (do first)

**A1. Entrance motion that never hides content for long** (points 3, 7)

- New token `--app-enter-duration: min(calc(var(--app-motion-duration) * 2), 240ms)`.
  `[data-motion='enter']` uses it. Stagger becomes
  `min(var(--i), 8) * 30ms`, so the last row shows within about 0.5 s
  in every style.
- Start the entrance at `opacity: 0.4; translateY(0.25rem)` instead of
  fully hidden, so remounted content is readable at once.
- Tab panels and view panels get a quick fade (`app-fade-in`, 120 ms, no
  delay) instead of `enter`. Only list rows stagger. One level of
  entrance per screen, never nested.
- Lamp: render the glow without animation, and play `lamp-flicker` only
  while `useStateChange(state)` is true, like the other styles.
- Theme picker previews and other mounts keep working, because mount never
  animates decoratively.

**A2. Rules and checks so it stays fixed across the app**

- Extend the "Client motion" rule in `CLAUDE.md` and the motion rules in
  `theme.md`:
  - decorative animation runs only on a real state change (through
    `useStateChange`), never on mount;
  - entrance only through `data-motion="enter"`, never nested, stagger
    capped;
  - nothing may stay invisible longer than `--app-enter-duration`.
- Test (`appStyles/motion.test.ts`): read every `style.css` and fail if an
  `animation:` rule is not under `[data-motion…]`, `[data-pulse]`,
  `[data-snap]` or a state selector listed as ambient in `theme.md`.
- Test per style: the first render of each `StatusMark` has no change
  motion attribute.

**A3. Language toast** (point 5): `useUpdateMe` awaits
`i18n.changeLanguage`, and the save toast is built after the change (or
with `lng: me.language`). Test: switching to Ukrainian shows the toast in
Ukrainian.

## Phase B — Device page

**B1. Hero with main info only** (point 11)

- The hero shows the state sentence and one "since" line.
- A small **Show details** link (a disclosure button, remembered in
  `localStorage`, default closed) reveals:
  - last seen, signal, uptime, reset reason;
  - firmware version and settings sync status, when present.
- Same component in every style, so all four heroes change at once.

**B2. Kind and cause tags** (point 1)

- A `Tag` component: a small pill with an icon, a label and a style per
  value. Not just color: each value has its own icon and fill, so the
  tags read at a glance and also in grayscale.

  | Tag     | Look                                                  |
  | ------- | ----------------------------------------------------- |
  | Short   | outline pill, `--warning` border and text, timer icon |
  | Long    | filled pill, `--status-offline` tint, hourglass icon  |
  | Power   | filled pill, `--status-offline` tint, plug-off icon   |
  | Network | outline pill, `--primary` border, Wi-Fi-off icon      |
  | Unknown | dashed outline, muted text, question icon             |
  | Blip    | outline pill, `--warning`, small zap icon             |
  | Ongoing | filled `--status-offline` with the live dot           |

- Used in the timeline, the table, the grid card and the device cards'
  open outage. Theme tokens only, contrast checked in light and dark, in
  all four styles.

**B3. Tooltips across the app** (point 8)

- `components/ui/tooltip.tsx` on Base UI `Tooltip`; one app-wide provider
  with a 300 ms delay.
- `<Moment iso>` component: shows the short form (`26 Nov 02:07`); the
  tooltip shows the full date with seconds, weekday and timezone
  (`Thursday, 26 November 2026, 02:07:41 (Europe/Kyiv)`). It renders a
  `<time datetime>` element. It replaces every `format.moment` / `since`
  output: hero, cards, timeline, table, members, invites, sessions.
- Durations get a tooltip with the exact value (`1 h 53 min 12 s`).
- Grid cells get a rich card (Base UI `PreviewCard` on hover and focus,
  `Popover` on tap):
  - hour range;
  - minutes with and without power;
  - each overlapping outage with start → end, duration, cause and kind;
  - blips with their time;
  - a link that switches to the timeline at that day.
- The grid becomes keyboard-navigable with one tab stop and arrow keys.
- Tooltips are hints only; nothing is reachable only by hover.

**B4. Periods instead of weeks only** (point 9)

- A period selector: **Day · Week · Month · Year · Custom**. The URL
  keeps `?period=day|week|month|year|custom&from=YYYY-MM-DD[&to=YYYY-MM-DD]`.
  The old `?week=` keeps working.
- Previous / next / Today move by the selected period. Custom opens a
  two-month range calendar (Base UI `Popover` with a small calendar of our
  own, no new dependency), with a maximum of 366 days.
- Views per period:

  | Period        | Timeline       | Grid                                                            | Table |
  | ------------- | -------------- | --------------------------------------------------------------- | ----- |
  | Day           | one day        | 1 × 24, tall cells                                              | rows  |
  | Week          | as now         | 7 × 24                                                          | rows  |
  | Month, ≤ 31 d | grouped by day | N × 24                                                          | rows  |
  | Year, > 31 d  | grouped by day | calendar heatmap: a cell per day, filled by hours without power | rows  |

- Day chips in the timeline become a compact day strip that scrolls for
  Month and Custom.
- Loading: one query per range, following cursors. Ranges longer than 31
  days load in month chunks in parallel and show progress. Past ranges
  never poll.

**B5. No sideways scroll where it can fit** (point 4)

- Grid at ≥ 640 px: `table-fixed`, no minimum width, cells shrink to fit;
  hour labels every 3 hours below `lg`.
- Below 640 px, the grid turns sideways (days as columns, hours as rows),
  so 7 columns fit a phone.
- Table at ≥ 640 px: no minimum width, cause and kind merge into one
  column.
- Below 640 px, each outage becomes a stacked row (start → end on top,
  duration and badges below). No horizontal scroll anywhere on the page.

## Phase C — Forms and account

**C1. Email / phone label that lights up** (point 2)

- The label "Email or phone" becomes two words: **Email** · **Phone**.
- While empty, both are quiet. When the field detects an email, "Email"
  lights up: primary color, a soft glow (`text-shadow` and a 2 px
  underline that slides in) and a small mail icon inside the input. A
  phone does the same with "Phone", next to the country chip.
- The switch is animated with the motion tokens and respects reduced
  motion.
- `aria-live` stays quiet. The visible label text and the accessible name
  remain "Email or phone".

**C2. Account tabs** (point 10)

- Same `Tabs` as the device page, kept in `?tab=`:
  - **Profile** (name, language, timezone);
  - **Appearance**;
  - **Sign-in & security** (emails and phones, Google, password,
    sessions);
  - **Danger zone** (delete account).

## Phase D — Notifications, built for many channels (point 6)

Client:

- Header: **Add channel** menu: Telegram (works now), Webhook ("Coming
  soon" until M8). New types are added through a client registry
  (`channelTypes.tsx`: icon, label key, config summary, add flow), so a new
  messenger is one entry plus its add dialog.
- **Built for 10+ channels:**
  - search by name;
  - filters by type, by device and by status (active, off, failing);
  - sort by name, newest, or most devices;
  - all kept in the URL; counts per filter.
- Compact rows by default; a row expands for details. Row content: type
  icon, name, status tag, on/off switch, and device chips (first 3 + "+N").
- Expanded row: the full device list, **Edit devices** (searchable
  checklist of devices you own or view), **Send test**, **Rename**,
  **Delete**. Webhook rows later add URL, events, secret and the delivery
  log in the same place.
- Bulk select: turn on, turn off, delete, with a confirm.
- Device page → Notifications tab: the same row component, filtered to
  that device.

Server (same structure as today: routes in `server/src/http/channels/`,
schemas in `shared/src/api/channels.ts`, data access next to the routes,
OpenAPI snapshot, API.md):

- `GET /channels` items gain `device_ids`.
- `PUT /channels/:id/devices { device_ids }`: replaces links from the
  channel side, with the same access checks as `PUT /devices/:id/channels`.
- `PATCH /channels/:id { name?, enabled? }`: turning on clears `USER`;
  `TOO_MANY_FAILURES` clears only after a successful test.
- `POST /channels/:id/test` for `TELEGRAM_PLATFORM`, rate limited.
- Tests for ownership, viewers' own channels, and the 404 / 403 cases.

**D2. Remove the own-bot channel type**

- Remove `TELEGRAM_BOT` from `channelTypes`, the i18n keys, API.md,
  DATABASE.md, spec §7 and ROADMAP M8 (M8 becomes "Webhooks").
- Migration: drop `telegram_bot_token_enc`, and rewrite the two
  `notification_channel` checks without `TELEGRAM_BOT`. A guard first
  fails the migration if any `TELEGRAM_BOT` row exists (none should).

## Phase E — Bot messages

- Links become **inline URL buttons** under the message ("Reset password",
  "Log in", "Open invite"), so no token URL is visible. Telegram only
  accepts public `https` button URLs, so with a local `http://` client URL
  (dev) the text falls back to an HTML link `<a href>`.
- Alerts use `parse_mode: HTML`: device name in bold, times and duration on
  their own lines, cause and kind as words. Device names and every other
  value are HTML-escaped (a new `escapeHtml` in the renderer, with tests
  for `<`, `>` and `&` in names).
- Update the message texts in spec §7 and the render snapshot tests.

## Phase F — Faster detection timings

| Setting         | Now                    | New                                                  |
| --------------- | ---------------------- | ---------------------------------------------------- |
| Ping interval   | 15–600 s, default 30   | **5–600 s, default 20**                              |
| Offline timeout | 30–3600 s, default 120 | **10–3600 s, default 40**; still ≥ 2 × ping interval |

- **Worker:** the offline check runs every **2 s** (its own loop, separate
  from deliveries) so a 10 s timeout alerts within 10–12 s.
- **Rate limit:** check-ins go from 6 to **20 per minute** per device.
- **Firmware:** `kMinPingS` 5, default 20. Release a new firmware version;
  boards need a USB reflash until OTA (M11).
- **Server guard:** a ping interval under 15 s is accepted only for a
  device whose reported firmware supports it; otherwise `400` with detail
  `{ code: "firmware_too_old", min_version }`, and the settings form says
  "Update the firmware to use pings under 15 s". This stops old boards from
  being marked offline over and over.
- **Existing devices** keep their current settings. Only new devices get
  20 / 40 (column defaults and the claim response).
- **Side effects, to note in spec §5:**
  - with a 40 s timeout, a power flicker becomes an outage instead of a
    blip when the board needs more than about 20–40 s to boot, join Wi-Fi
    and sync the clock;
  - one slow ping (TLS, Wi-Fi hiccup) can trigger an alert at 10–15 s
    timeouts;
  - load per device rises 1.5× at the new default and 6× at 5 s.
- Update spec §4–5, API.md validation, DEVICE_STATUS.md and the settings
  form hints.

## Future — planning only (no code in this milestone)

**Webhooks** (point 12) stay **M8**, already specified (now without the
own bot). Phase D makes the client ready.

**Public device links** (point 13), proposed **M13 — Public status links**:

- The owner creates links per device: `https://…/s/<token>`. The token has
  at least 128 random bits and is stored hashed. A link can be revoked
  and can have an optional expiry.
- **Level** per link:
  1. **State:** current state, how long, last update.
  2. **State + history:** adds the history views (period selector, grid,
     timeline), read-only.
  3. **State + history + people:** adds the members list with display
     names and roles only.
- Never shown at any level: emails, phones, settings, telemetry, device ID,
  invites.
- Level 3 shows people's names to anyone with the link. The owner sees a
  warning when choosing it; viewers are not notified.
- The page is `noindex` and rate limited per IP; the name can be replaced
  by a public label.
- API: `POST` / `GET` / `PATCH` / `DELETE /devices/:id/public-links`
  (owner), `GET /public/:token` and `GET /public/:token/outages` (no
  auth, minimal schemas).
- DB: `public_link` (device, token hash, level, label, expires_at,
  revoked_at, last_viewed_at).

## Order and size

| Phase | Size                         | Depends on            |
| ----- | ---------------------------- | --------------------- |
| A     | small                        | —                     |
| F     | medium (server + firmware)   | —                     |
| E     | small                        | —                     |
| B1–B3 | medium                       | A                     |
| B4–B5 | large                        | B3 (tooltips in grid) |
| C     | small                        | A                     |
| D     | medium client + small server | —                     |

Each phase is one or two commits with tests. Spec, `API.md`,
`DATABASE.md`, `theme.md`, `DEVICE_STATUS.md` and `ROADMAP.md` are updated
in the same change.

## Open questions

None.
