# M15 — Channel language, planned network work and UI fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** each Telegram channel can use its own language. Planned router or
Wi-Fi work no longer creates alerts or outages. Internet-only gaps stop
counting as time without power. Eight UI problems found on desktop and phone
are fixed.

**Architecture:** two new nullable columns: `notification_channel.language`
and `device.network_pause_until`. The pure check-in planner
(`monitoring/plan.ts`) and `offAlertDueAt` read the pause. Stats split
downtime by cause. The UI fixes live in `components/ui`, so every page picks
them up. Pages only compose them.

**Tech stack:** Express 5, Drizzle with SQL migrations, Zod schemas in
`shared/`, React with Base UI wrappers in `client/src/components/ui`, Vitest
on PGlite and jsdom.

**Spec:** [PROJECT_V2.md](../PROJECT_V2.md) §5, §7, §9 ·
[API.md](../API.md) Devices, Outages and stats, Notification channels ·
[DATABASE.md](../DATABASE.md) · [theme.md](../theme.md).

## Global constraints

- Languages: `uk`, `en`, `ru` (`languages` in `shared/src/enums.ts`).
  Fallback is `uk`.
- Webhooks carry no human text (P §7), so channel language applies to
  `TELEGRAM_PLATFORM` only.
- Pause durations: 5–120 min. Only the owner can set or cancel a pause.
- Every new text gets a key in `uk`, `en` and `ru` (`parity.test.ts`).
- Motion: new panels use `data-motion="panel"`, and appearing content uses
  `data-motion="enter"`. Do not nest entrances (CLAUDE.md).
- Controls come only from `components/ui` (`consistency.test.ts`).
- Vitest timeout is 30 s per workspace. Do not add per-test timeouts. Use
  `FakeClock` and no real timers.
- Run the full `npm test` from the repo root before you call a task done.
- Commits: the user commits. At each "Time to commit" step, list the
  files to stage and give the message. Do not run git.

## Design decisions

### 1. Notification language per channel

- `notification_channel.language text null`. `null` means "same as my
  account", which keeps today's behaviour. The DB rejects a value on a
  `WEBHOOK` row.
- Delivery rendering, the channel test message and bot replies in that chat
  (`/status`, `/stats`, `/stop`) use
  `coalesce(channel.language, app_user.language)`. Timezone stays the
  account's.
- A chat linked by several users keeps today's rule: the oldest channel
  decides the reply language for bot commands.

### 2. Internet-only gaps

The system already labels these gaps `NETWORK` (same `boot_id`), as the
screenshot shows ("Сеть"). Two things go wrong:

- the OFF alert goes out before the cause can be known;
- Stats and the history grid count a `NETWORK` gap as time without power.

Fix, in two parts:

**a) Planned network work ("Pause network alerts").** Before swapping the
router, the owner opens the device page and picks _Router work → 15 min_.
Until `network_pause_until`:

- no OFF alert is queued. `offAlertDueAt` is pushed to at least
  `network_pause_until`;
- if the device comes back with the **same** `boot_id` and no OFF alert was
  queued, the gap is dropped. The open outage is deleted, or a late gap is
  not inserted. No history, no stats, no message;
- if it comes back with a **new boot** (the power really dropped), it is
  recorded and notified as usual;
- if the pause ends while the device is still offline, the OFF alert goes
  out at the end of the pause. The outage is then kept and follows the
  normal rules.

The device state stays truthful (`OFFLINE` while silent). The device card
shows "Network alerts paused until 14:30" with a Cancel button.

**b) Unplanned gaps: `NETWORK` is not "without power".** This needs your
decision, see the Open decision section at the end. The recommendation:

- `total_downtime_s` and `availability_pct` count `POWER`, `UNKNOWN` and
  open outages only;
- a new `network_downtime_s` counts `NETWORK` gaps;
- the history grid, heatmap and day popover show network time apart,
  as "Без связи", in the muted colour;
- the bot's `/stats` line adds "no internet: 12 min" when the value is
  above zero.

The existing "Notify on suspected network outages" setting still covers
summaries.

### 3. UI decisions

| #   | Problem                                                     | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Sort looks like a filter; Selects change width; popup clips | `SelectTrigger` gets a `stableWidth` prop that keeps the trigger as wide as its widest item, so it never resizes. The Select popup uses `w-max min-w-(--anchor-width) max-w-[calc(100vw-1rem)]`. New `SortSelect` in `components/ui`: `ArrowDownUp` icon and a short label. Sort labels get shorter: "По названию", "Сначала новые", "Больше устройств".                                                                                                 |
| 4   | Channel card: 7 loose buttons, wrong words, log outside     | Header: name, status, devices, switch, a **⋯** `DropdownMenu` (Rename, New signing key, Delete) and the expand chevron. Body: `TabsList variant="pill"` with **Overview** and, for webhooks only, **Delivery log**. Overview shows the destination, events as localized chips, the device chips, a language `Select` (Telegram only) and two primary buttons: Choose devices and Send test, plus Edit webhook for webhooks. The log moves into the card. |
| 4   | Localization                                                | The status tag reuses the plural filter label ("Активные"). Add singular keys `app.notifications.state.{active,off,failing}` ("Активен", "Выключен", "Сбои"). Show events as `app.notifications.events.<event>` labels, not `device.offline`.                                                                                                                                                                                                            |
| 5   | Day popover runs off screen                                 | `PopoverContent` gets `max-h-(--available-height)` and `collisionPadding`. The day popover keeps its title and totals fixed and scrolls only the outage list (`min-h-0 overflow-y-auto`).                                                                                                                                                                                                                                                                |
| 6   | Account tabs wrap to two lines; Appearance segments wrap    | On phones, `line` tabs become one scrollable row: icon and label inline, no wrap, the active tab scrolled into view. Labels get shorter in uk/ru: "Безопасность", "Удаление". On phones, `SegmentedControl` gets a `layout="stacked"` option: equal columns, icon above the label. The theme picker uses it, with "Системная" instead of "Как в системе".                                                                                                |
| 7   | Popups cover the bottom nav                                 | `Layout` measures the fixed bottom nav and provides `BottomInsetContext`. Every positioner in `components/ui` (Popover, Select, DropdownMenu, Tooltip) passes `collisionPadding={{ …8, bottom: 8 + inset }}`, so popups flip or shrink above the nav. Dialogs and sheets stay above it, as now.                                                                                                                                                          |
| 8   | Custom dates and Month grid on phones                       | Below 640 px, the custom range opens in a `Dialog` (already a bottom sheet) with stacked, full-width date fields. The `Input type="date"` touch styles get `min-w-0 w-full appearance-none` so iOS doesn't overflow. On phones, the Month grid uses a calendar: 7 weekday columns, one row per week, day number and colour per cell, and the same day popover. The 24-hour grid stays for Day and Week, and for Month on `sm+`.                          |

## Review focus

1. A pause set while the device is already `OFFLINE` with an alert queued
   changes nothing. The recovery still follows the OFF alert.
2. A power reset during a pause is still recorded and notified (new
   `boot_id` wins over the pause).
3. A channel with `language = null` follows later account language changes.
   Only a set value overrides.
4. `stableWidth` with long translations on a 360 px phone: the trigger must
   not exceed its container (`max-w-full`, text truncates).
5. Popup collision when the nav is not fixed (`sm+`): the inset must be 0.

Each item has a test in the task that owns it.

---

## Part A: server and shared

### Task 1: Channel language (server)

**Files:**

- Create: `server/drizzle/0009_channel_language_network_pause.sql` (also
  holds Task 2's column, one migration for M15)
- Modify: `server/src/db/schema/notifications.ts`,
  `shared/src/api/channels.ts`, `server/src/channels/views.ts`,
  `server/src/http/channels/channels.ts`,
  `server/src/notifications/deliveries.ts`, `server/src/telegram/bot.ts`
- Docs: `docs/DATABASE.md`, `docs/API.md` (Notification channels), P §7
  ("Render … in the channel's language, else the recipient's")
- Test: `server/src/http/channels/channels.test.ts`,
  `server/src/notifications/deliveries.pg.test.ts`,
  `server/src/telegram/bot.test.ts`, `server/src/db/schema.test.ts`

**Interfaces:**

- Produces: `channelSchema.language: Language | null`;
  `channelPatchSchema.language?: Language | null`; column
  `notificationChannel.language`.
- `ClaimedDelivery.recipient.language` is now the effective language.

- [ ] **Step 1: failing tests.**
  - `PATCH /channels/:id { language: 'en' }` on Telegram → 200,
    `language: 'en'`. `{ language: null }` → back to `null`.
  - The same patch on a webhook → 422 `validation_failed`, reason
    `telegram_only`.
  - `claimDue` for a channel with `language: 'en'` and owner `uk` →
    `recipient.language === 'en'`. With `null`, it follows the owner.
  - Bot `/status` in a chat whose channel has `language: 'ru'` replies in
    Russian.
  - Schema test: the check rejects `language` on a `WEBHOOK` row.
- [ ] **Step 2:** run the tests and confirm they fail:
      `npm test -w server -- channels deliveries bot schema`.
- [ ] **Step 3:** implement:
  - the column and checks
    `language in ('uk','en','ru')` and
    `type = 'TELEGRAM_PLATFORM' or language is null`;
  - `coalesce(notificationChannel.language, appUser.language)` in the
    `claimDue` select;
  - `chatOwner` returns the coalesced language;
  - `sendTelegramTest` receives the channel's effective language.
- [ ] **Step 4:** the tests pass. Regenerate the OpenAPI snapshot. Run the
      full `npm test`.
- [ ] **Time to commit:** `Add per-channel notification language`

### Task 2: Planned network pause (server)

**Files:**

- Modify: `server/src/db/schema/devices.ts` (`networkPauseUntil: tstz()`),
  the migration from Task 1, `server/src/monitoring/plan.ts`,
  `server/src/monitoring/checkIn.ts`, `server/src/monitoring/offline.ts`,
  `server/src/notifications/rules.ts`, the device routes (owner-only router
  next to the device settings routes), `shared/src/api/devices.ts`
- Docs: P §5 (new subsection "Planned network work"), `docs/API.md`
  Devices, `docs/DATABASE.md`
- Test: `server/src/monitoring/plan.test.ts`,
  `server/src/notifications/rules.test.ts`,
  `server/src/monitoring/acceptance.test.ts`, device route tests

**Interfaces:**

- `DeviceSnapshot.networkPauseUntil: Date | null`
- New `CheckInEvent` variant `{ type: 'DISCARD_OUTAGE'; outageId: string }`
- `offAlertDueAt(startedAt, now, s: { notifyShortOutages; shortOutageThresholdS; networkPauseUntil: Date | null }): Date`
- `PUT /devices/:id/network-pause` body `{ minutes: 5..120 }` → 200
  `{ until: string }`. `DELETE /devices/:id/network-pause` → 204.
- `DeviceListItem` and device detail gain `network_pause_until: string | null`.
  The value is `null` once it has passed.

- [ ] **Step 1: failing tests** (planner, pure):
  - OFFLINE, open outage started inside the pause, same `boot_id`,
    `offAlertQueuedAt: null` → `DISCARD_OUTAGE`.
  - Same case, new boot with `POWER_ON` → `CLOSE_OUTAGE` cause `POWER`.
  - Same boot, but `offAlertQueuedAt` set → `CLOSE_OUTAGE` with
    `notify: 'RECOVERY'` (Review focus 1).
  - ONLINE late gap inside the pause with the same boot → `event: null`.
  - `offAlertDueAt` with a pause ending 10 min ahead → returns the pause
    end. With a pause in the past → behaves as today.
  - Acceptance on `FakeClock`: pause 15 min, 3 min silence, return →
    no outage rows and no deliveries. Pause 5 min, 8 min silence → OFF
    alert at minute 5, outage kept.
  - Routes: a viewer gets 403. `minutes: 3` gets 422.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement. `checkIn.ts` handles `DISCARD_OUTAGE` by
      deleting the open outage inside the device-locked transaction. The PUT
      sets `now + minutes`.
- [ ] **Step 4:** run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Add planned network pause`

### Task 3: Network gaps outside power downtime (server). Blocked on the open decision.

**Files:** `server/src/stats/compute.ts`, `shared/src/api/stats.ts`,
`server/src/telegram/bot.ts` (`statsText`), the locales, P §2 Statistics,
`docs/API.md` stats payload.
**Test:** `server/src/stats/compute.test.ts`, `server/src/telegram/bot.test.ts`.

**Interfaces:** `DeviceStats.network_downtime_s: number` and
`StatsBucket.network_downtime_s: number`. `total_downtime_s`,
`availability_pct`, `avg_outage_s`, `longest_outage_s` and `outages` count
non-`NETWORK` spans (open spans count). `by_cause.network` stays.

- [ ] **Failing tests:**
  - a day with a 2 h `POWER` outage and a 10 min `NETWORK` outage →
    `total_downtime_s = 7200`, `network_downtime_s = 600`,
    `outages = 1`, `by_cause.network = 1`;
  - a `NETWORK` span crossing a bucket edge is clipped into both buckets'
    `network_downtime_s`;
  - `/stats` text shows "no internet" only when the value is above zero.
- [ ] Implement, run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Count network gaps apart from power downtime`

## Part B: client base controls

### Task 4: Popups respect the bottom nav (#7) and fit the screen (#5)

**Files:**

- Create: `client/src/components/ui/bottom-inset.tsx`
  (`BottomInsetProvider`, `usePopupCollisionPadding(): Padding`)
- Modify: `popover.tsx`, `select.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`,
  `client/src/app/Layout.tsx`,
  `client/src/pages/devices/history/GridCell.tsx`
- Test: `client/src/components/ui/bottom-inset.test.tsx`,
  `client/src/pages/devices/history/DeviceHistory.test.tsx`

**Interfaces:**
`usePopupCollisionPadding() → { top: 8, right: 8, left: 8, bottom: 8 + inset }`.
`Layout` sets `inset` from a `ResizeObserver` on the nav while its computed
`position` is `fixed`, else 0.

- [ ] **Failing tests:**
  - with the provider set to `inset = 64`, the hook returns `bottom: 72`.
    Without the provider, it returns 8 (Review focus 5);
  - `PopoverContent` renders with `max-h-(--available-height)`;
  - the day popover's outage list has the scroll container role, and its
    totals sit outside that container.
- [ ] Implement, run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Keep popups above the bottom nav`

### Task 5: Stable Select width and SortSelect (#3)

**Files:** `client/src/components/ui/select.tsx`, create
`client/src/components/ui/sort-select.tsx`,
`client/src/pages/notifications/NotificationsPage.tsx`, the locales
(`app.notifications.sort.*`).
**Test:** `client/src/components/ui/select.test.tsx` (new),
`NotificationsPage.test.tsx`.

**Interfaces:**

- `SelectTrigger` prop `stableWidth?: boolean`. When true, `SelectValue`
  renders every item label as an invisible `aria-hidden` sizer, stacked in
  one grid cell (`grid [grid-template-areas:'x'] *:[grid-area:x]`). The
  trigger takes `max-w-full`, and the label truncates.
- `SortSelect({ label, value, options, onChange })` uses the same `items`
  shape as `FilterSelect`.

- [ ] **Failing tests:**
  - with `stableWidth`, every option label is present once as
    `aria-hidden`, and the accessible name is unchanged;
  - the Notifications page renders the sort control with the
    `ArrowDownUp` icon and the short labels;
  - all four filter selects use `stableWidth`.
- [ ] Implement. Keep `consistency.test.ts` green. Run the full `npm test`
      and confirm it passes.
- [ ] **Time to commit:** `Keep select width stable and style sorting`

### Task 6: Phone tabs and stacked segments (#6)

**Files:** `client/src/components/ui/tabs.tsx`,
`client/src/components/ui/segmented-control.tsx`,
`client/src/components/ThemeControl.tsx`, the locales (account tab labels,
`theme.system`).
**Test:** `segmented-control.test.tsx`, `AccountPage.test.tsx`.

**Interfaces:** `SegmentedControl` prop `layout?: 'row' | 'stacked'`.
`stacked` means `max-sm:grid max-sm:auto-cols-fr max-sm:grid-flow-col`,
with segments in `max-sm:flex-col`. Line tabs on `max-sm` lose the
`flex-col`/`whitespace-normal` rules and gain `whitespace-nowrap` with
`scrollIntoView({ inline: 'nearest' })` on the active tab.

- [ ] **Failing tests:**
  - `layout="stacked"` sets `data-layout="stacked"`;
  - the active account tab calls `scrollIntoView` on change (stub it in
    jsdom);
  - the ru/uk labels are the new short strings.
- [ ] Implement, run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Fit account tabs and theme picker on phones`

## Part C: features in the client

### Task 7: Channel card redesign and localization (#4)

**Files:** `client/src/pages/notifications/ChannelRow.tsx` (split into
`ChannelRow.tsx` header, `ChannelOverview.tsx`, `ChannelActionsMenu.tsx`),
`channelTypes.tsx`, `DeliveryLog.tsx`, the locales.
**Test:** `NotificationsPage.test.tsx`, `DeliveryLog.test.tsx`, a new
`ChannelRow.test.tsx`.

- [ ] **Failing tests:**
  - an expanded webhook card has the tabs "Overview" and "Delivery log".
    The log renders **inside** the card (`within(card)`);
  - a Telegram card has no tabs;
  - the ⋯ menu holds Rename, New signing key (webhook only) and Delete.
    Delete still asks for confirmation;
  - the status tag shows `app.notifications.state.active`, not the filter
    label;
  - the webhook summary shows localized event labels and no
    `device.offline` text.
- [ ] Implement. The tab panel uses `TabsPanel` (it already has
      `data-motion="panel"`). Do not nest `enter` inside the card's `enter`.
      Run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Reorganize channel card and fix its wording`

### Task 8: Channel language picker (#1, client). Depends on Tasks 1 and 7.

**Files:** `ChannelOverview.tsx`, `client/src/api/endpoints.ts`, the
locales.
**Test:** `ChannelRow.test.tsx`.

- [ ] **Failing tests:**
  - a Telegram overview has a `Select` labelled "Notification language".
    Its options are "Same as account (Українська)", "Українська",
    "English", "Русский";
  - choosing English sends `PATCH { language: 'en' }`. Choosing "Same as
    account" sends `{ language: null }`;
  - a webhook overview has no language select.
- [ ] Implement, run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Pick notification language per channel`

### Task 9: Pause network alerts UI (#2a). Depends on Task 2.

**Files:** create `client/src/pages/devices/NetworkPause.tsx`, mount it in
`DevicePage.tsx` (owner only, next to the device actions), the device card
badge in `DevicesPage.tsx`, `client/src/api/endpoints.ts`, the locales.
**Test:** `client/src/pages/devices/NetworkPause.test.tsx`.

- [ ] **Failing tests:**
  - the owner sees a "Router work" button. It opens a `DropdownMenu` with
    10, 15, 30 and 60 min. Choosing 15 sends `PUT { minutes: 15 }`;
  - while paused, the page shows "Network alerts paused until {{time}}"
    and a Cancel button that sends `DELETE`;
  - a viewer sees the badge but no controls.
- [ ] Implement. The badge uses `data-motion="enter"`. Run the full
      `npm test` and confirm it passes.
- [ ] **Time to commit:** `Add router work pause to device page`

### Task 10: Network time in history (#2b). Depends on Task 3.

**Files:** `client/src/lib/week.ts` (`offMs` excludes `NETWORK`, new
`networkMs`), `GridCell.tsx`, `HistoryHeatmap.tsx`, `StatsSummary.tsx`,
the locales, `docs/theme.md` if a colour token is added.
**Test:** `client/src/lib/week.test.ts`, `DeviceHistory.test.tsx`.

- [ ] **Failing tests:**
  - `hourCells` with a 10 min `NETWORK` gap → `offMs = 0` and
    `networkMs = 600000`;
  - the day popover shows the "Без связи" total only when it is above
    zero.
- [ ] Implement, run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Show network gaps apart in history`

### Task 11: Phone date range and Month calendar (#8)

**Files:** `client/src/pages/devices/history/PeriodControls.tsx`,
`client/src/components/ui/input.tsx` (date touch styles), create
`client/src/pages/devices/history/MonthCalendar.tsx`, `DeviceHistory.tsx`
(choose `MonthCalendar` on `max-sm` via `useMediaQuery('(width < 40rem)')`).
**Test:** `DeviceHistory.test.tsx`, a new `MonthCalendar.test.tsx`.

- [ ] **Failing tests:**
  - with the phone media query mocked, "Custom" opens a dialog with two
    stacked date fields and a full-width Show button;
  - on desktop it stays a popover;
  - `MonthCalendar` for Nov 2026 in `Europe/Kyiv` renders 5 week rows
    starting Monday, 30 day buttons, and leading blanks for Oct 26–31;
  - pressing a day opens the same day popover as `GridCell`.
- [ ] Implement, run the full `npm test` and confirm it passes.
- [ ] **Time to commit:** `Fit custom dates and month view on phones`

### Task 12: Docs and roadmap

- [ ] Tick M15 in `docs/ROADMAP.md`. Update P §5, P §7, P §9 and
      `theme.md` where the tasks changed behaviour (tasks already touch API.md
      and DATABASE.md).

## Verify by hand (after all tasks)

- In Telegram, set one group channel to English with the account in
  Ukrainian. Run the channel test and `/status`: both should be English.
- Start Router work for 15 min, unplug the router for 2 min, plug it back.
  You should get no Telegram message and no new history row.
- Without a pause, unplug the router for 2 min. In the grid it should show
  as "Без связи", and "Без света" should not grow.
- On a phone: the account tabs fit on one row and scroll; the theme picker
  shows three even columns; popups never cover the bottom nav; a busy day
  popover scrolls; Custom dates open as a sheet; Month shows the calendar.
- On desktop: filter Selects keep their width when the value changes; the
  sort control looks like sorting; the webhook card shows its log inside
  the card.

## Open decision

**Network gaps in stats (Task 3, Task 10).** Today a `NETWORK` gap counts
as time without power. Recommendation: count it separately as "no
internet", because the same `boot_id` proves the device had power the
whole time. This changes the meaning of `total_downtime_s`.
