# M9 — Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** owners and viewers see outage counts, downtime and availability for any History range, as numbers and charts on a new Stats tab. The platform bot answers `/stats` with the last 7 days.

**Architecture:** the timezone and period helpers move from `client/src/lib/week.ts` and `period.ts` into `shared/`, so the server builds the same local days, weeks and months as the History tab. A new `server/src/stats/` module has a pure `computeStats()` (outages in, totals and buckets out) and a loader that reads the outages overlapping the range plus the device's first check-in. `GET /devices/:id/stats` and the bot's `/stats` both call the loader. The client adds a Stats tab that shares the History range in the URL. It shows summary tiles and a Recharts bar chart, loaded with a dynamic import.

**Tech Stack:** unchanged (server: Node 26, Express 5, Drizzle, Zod, zod-openapi, i18next, Vitest + PGlite + supertest; client: React 19, TanStack Query 5, `components/ui`, Vitest + Testing Library + MSW). **New dependency (decided with the user): `recharts` ^3** in `client/` only.

**Spec:** [ROADMAP.md § M9](../ROADMAP.md#m9--statistics) · [PROJECT_V2.md](../PROJECT_V2.md) §2 Statistics, §5 Power blips and Outage classification, §7 platform bot, §9 Device page · [API.md](../API.md) §4 Outages and stats, §6 Telegram webhook, §9 Inconsistencies · [DATABASE.md](../DATABASE.md) §6 `outage`, `device_boot`, §9 Stats · [theme.md](../theme.md) Touch tier.

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints)–[M8](M08-webhooks.md#global-constraints) constraints still applies (ESM, strict TS, `newId()`, `clock.now()` only, error shape, no comments, no real names, shared Zod schemas, theme and motion tokens, `components/ui` only, MSW `onUnhandledRequest: 'error'`).
- **No migration in M9.** Stats come from `outage` and `device_boot` on request (D §9). If a task seems to need a column or index, stop and ask.
- Time comes only from `clock.now()` on the server and `useNow()` in the client. Tests use `FakeClock` and fixed `now` values, never real timers.
- DST tests use **`Europe/Berlin`** (2026-03-29 has 23 hours, 2026-10-25 has 25 hours). Its rules are stable in tzdata, unlike `Europe/Kyiv`.
- Seed range tests with one bulk `insert` of outage rows, never a helper call per row (CLAUDE.md, Tests in CI).
- Access: a stranger gets `404 not_found`. Owner and viewer can read stats (`getAccessibleDevice(..., 'read')`).
- Every endpoint change goes into the OpenAPI document under the `Outages` tag and into API.md in the same task. Run `npm run test -w server -- -u` only for the OpenAPI snapshot, and review the diff.
- User-facing text: `app.*` and `telegram.*` keys in `uk`, `en` and `ru` (parity test). Telegram texts may use only `<b>` (P §7).
- Recharts animation is **off** (`isAnimationActive={false}`). Appearing content uses `data-motion="enter"` from the motion system (CLAUDE.md, Client motion).

## Decisions made in this plan

Each task records its decisions in the spec. Task 8 marks them in the ROADMAP.

1. **Periods match History (decided with the user).** `GET /devices/:id/stats?period&from&to` takes `period` = `DAY | WEEK | MONTH | YEAR | CUSTOM` and **local dates** (`YYYY-MM-DD`), like the History URL:
   - `DAY`, `WEEK`, `MONTH`, `YEAR`: `from` is any date in the period, and the server snaps it to the period start (weeks start on Monday). `from` is optional and defaults to today in the caller's timezone. `to` is not allowed (`400 validation_error`).
   - `CUSTOM`: `from` and `to` are both required and inclusive, `to >= from`, at most 366 days. Otherwise `400 validation_error`.
   - Dates must be between 2000-01-01 and 2100-12-31. A range in the future is allowed. Its buckets have no monitored time.
   - Day boundaries use the caller's timezone from `/me` (`app_user.timezone`). The response echoes `timezone`.
2. **Buckets.** `HOUR` for `DAY`, `DAY` for `WEEK`, `MONTH` and `CUSTOM` up to 31 days, `MONTH` for `YEAR` and `CUSTOM` over 31 days. Month buckets are clipped to the range. Hour buckets step 3600 s from local midnight to the next local midnight, so a DST day has 23 or 25 buckets. Each bucket has `from` and `to` as ISO instants.
3. **Overlap counting (decided with the user).** An outage or power blip counts in **every** bucket it overlaps, and in the period total if it overlaps the range. The rule is `started_at < to` and (`ended_at` is null or `ended_at > from`), the same filter as `GET /outages`. So the totals match the History list for the same range. Bucket counts can add up to more than the total.
4. **Downtime and availability.**
   - The monitored window of a range or bucket is `[max(from, monitoring_since), min(to, now))`. `monitoring_since` is `min(device_boot.first_seen_at)`, which is the first check-in. Re-pairing keeps the old boot rows, so it doesn't reset this.
   - `total_downtime_s` is the sum of `OUTAGE` intervals clipped to the monitored window. An open outage runs until `now`. The value is floored to whole seconds.
   - `availability_pct = (monitored_s − total_downtime_s) / monitored_s × 100`, rounded to 2 decimals. It is `null` when `monitored_s = 0`: a future bucket, before the first check-in, or a `PENDING` device.
   - Power blips never add downtime. Planned OTA windows create no rows (D §6), so they count as available.
5. **Totals.**
   - `outages`: `OUTAGE` rows overlapping the range, the open one included.
   - `long_outages`: closed with kind `LONG`, plus the open outage once `now − started_at ≥ short_outage_threshold_s`. This is the same rule as classification at close (P §5).
   - `power_blips`: `POWER_BLIP` rows overlapping the range.
   - `by_cause: { power, network, unknown }` counts the closed outages. `open_outage: boolean` marks an open outage in the range. `power + network + unknown + (open_outage ? 1 : 0) = outages`.
   - `avg_outage_s` and `longest_outage_s` use each outage's **full** observed duration (the open one up to `now`), not the clipped one. They describe the outages, while downtime describes the period. Both are `null` when `outages = 0`. The average is floored.
6. **Response shape** (replaces the A §4 draft):

   ```json
   {
     "period": "WEEK",
     "timezone": "Europe/Kyiv",
     "from": "2026-11-15T22:00:00Z",
     "to": "2026-11-22T22:00:00Z",
     "bucket": "DAY",
     "monitoring_since": "2026-10-02T09:14:05Z",
     "outages": 7,
     "long_outages": 3,
     "open_outage": false,
     "power_blips": 2,
     "by_cause": { "power": 5, "network": 1, "unknown": 1 },
     "total_downtime_s": 28800,
     "avg_outage_s": 4114,
     "longest_outage_s": 14400,
     "availability_pct": 95.24,
     "buckets": [
       {
         "from": "2026-11-15T22:00:00Z",
         "to": "2026-11-16T22:00:00Z",
         "outages": 1,
         "power_blips": 0,
         "total_downtime_s": 3600,
         "availability_pct": 95.83
       }
     ]
   }
   ```

7. **Bot `/stats`.** It covers the last 7 local days, today included (6 full days and today up to now). It lists each device that notifies the chat, like `/status`, in the chat owner's language and timezone. An unlinked chat gets `notLinked`, and no devices gets `statusEmpty`. Format:

   ```
   📊 Last 7 days · 21–27 Nov
   <b>Home</b> — 3 outages · 2 h 15 min without contact · 98.66%
   <b>Dacha</b> — no outages · 100%
   <b>Garage</b> — no data yet
   ```

   A device with blips adds ` · 2 power blips`. The help text gains `/stats — last 7 days`.

8. **Stats tab.** The tabs become History · **Stats** · Notifications · Members (`?tab=stats`). The Stats tab reads and writes the same `?period=&from=&to=` as History, so switching tabs keeps the range. The range query polls only when the range includes today, at the device page's interval (`pollMs.device`).
9. **Charts (decided with the user): Recharts**, wrapped as `components/ui/chart.tsx` (shadcn `chart` adapted to our tokens). The Stats panel loads it with `React.lazy`, so the main bundle doesn't grow. The fallback is a `Skeleton` of the chart's height, so the layout doesn't jump. One bar chart shows downtime per bucket in `--status-offline`, with blips as a `--warning` marker row. The tooltip shows outages, downtime and availability. The chart is `aria-hidden`. An `sr-only` table next to it gives the same values per bucket. Causes appear as a labeled bar list (power `--status-offline`, network `--primary`, unknown `--status-pending`), not as a pie.

## Review Focus

1. **A DST day.** On 2026-03-29 in `Europe/Berlin`, `DAY` has 23 buckets summing to 82 800 s. On 2026-10-25 it has 25. An outage 01:30–03:30 local on the spring day yields 3 600 s of downtime, not 7 200 s. Pinned in Task 3.
2. **An outage across midnight** counts once in the total, once in each day bucket, and its downtime is split exactly at local midnight. Pinned in Task 3.
3. **An open outage** adds downtime up to `now` only, makes `open_outage: true`, is missing from `by_cause`, and becomes `LONG` at the threshold. Future buckets have `availability_pct: null`, not 100. Pinned in Task 3.
4. **The first check-in in the middle of a range.** Time before it is not counted as available. Pinned in Task 3 and Task 4.
5. **Lazy Recharts.** The main client chunk doesn't import `recharts`. Pinned in Task 6 with a build check.

---

### Task 1: Shared time and period helpers

**Files:**

- Create: `shared/src/time.ts`, `shared/src/time.test.ts`, `shared/src/period.ts`, `shared/src/period.test.ts`
- Modify: `shared/src/index.ts` (exports), `client/src/lib/week.ts`, `client/src/lib/period.ts` (import the moved functions from `@elec/shared` and re-export them, so client imports don't change)

**Interfaces:**

- Produces in `@elec/shared`:

  ```ts
  type LocalDate = string;
  localDate(at: number, timezone: string): LocalDate;
  zonedTime(date: LocalDate, hour: number, timezone: string): number;
  addDays(date: LocalDate, days: number): LocalDate;
  addMonths(date: LocalDate, months: number): LocalDate;
  diffDays(from: LocalDate, to: LocalDate): number;
  weekdayOf(date: LocalDate): number; // Monday = 0
  isLocalDate(value: unknown): value is LocalDate;
  type PeriodKind = 'day' | 'week' | 'month' | 'year';
  periodBounds(period: PeriodKind, anchor: LocalDate): { from: LocalDate; to: LocalDate }; // inclusive
  dayStart(date: LocalDate, timezone: string): number; // zonedTime(date, 0, tz)
  ```

- The client keeps `Range`, `parseRange`, `shiftRange`, `monthChunks`, `hourCells` and `daysBetween`, built on these.

- [ ] **Step 1: Move the existing tests** for the moved functions from `client/src/lib/period.test.ts` and `week.test.ts` into `shared/src/*.test.ts`. Add failing tests: `dayStart('2026-03-29', 'Europe/Berlin')` and `dayStart('2026-03-30', …)` are 23 h apart, and 25 h apart around 2026-10-25. `localDate` at 2026-10-25T00:30Z in Berlin is `2026-10-25`. `periodBounds('week', '2026-11-27')` is `2026-11-23 → 2026-11-29`. `periodBounds('month', '2024-02-10')` ends `2024-02-29`. `isLocalDate('2026-02-30')` is false.
- [ ] **Step 2:** Run `npm run test -w shared` → FAIL.
- [ ] **Step 3:** Move the code without changing behaviour. `client/src/lib/period.ts` `periodRange` calls `periodBounds`.
- [ ] **Step 4:** Run `npm test` from the root → PASS (the client History tests must still pass). Run `npm run typecheck`.
- [ ] **Commit point:** `Move timezone and period helpers to shared`

### Task 2: Stats schemas

**Files:**

- Create: `shared/src/api/stats.ts`, `shared/src/api/stats.test.ts`
- Modify: `shared/src/api/index.ts`, `shared/src/enums.ts` (`statsPeriods`, `statsBuckets`)

**Interfaces:**

- Produces:

  ```ts
  statsPeriods = ['DAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM'] as const;
  statsBuckets = ['HOUR', 'DAY', 'MONTH'] as const;
  statsQuerySchema; // { period, from?, to? } with decision 1 rules in superRefine
  statsBucketSchema; // meta id 'StatsBucket'
  statsSchema; // meta id 'DeviceStats', decision 6 shape
  type StatsQuery; type DeviceStats; type StatsBucket;
  ```

- [ ] **Step 1: Failing tests** (`test.each`): `CUSTOM` without `to` fails at path `to`. `CUSTOM` with 367 days fails. `WEEK` with `to` fails at path `to`. `from: '2026-02-30'` fails. `from: '1999-12-31'` fails. `DAY` with no `from` passes. A valid `statsSchema` sample (decision 6 JSON) parses, and `availability_pct: null` parses.
- [ ] **Step 2:** Run `npm run test -w shared -- stats` → FAIL.
- [ ] **Step 3:** Implement with `isLocalDate` and `diffDays` from Task 1.
- [ ] **Step 4:** Run → PASS.
- [ ] **Commit point:** `Add stats request and response schemas`

### Task 3: `computeStats` (pure)

**Files:**

- Create: `server/src/stats/compute.ts`, `server/src/stats/compute.test.ts`

**Interfaces:**

- Consumes: Task 1 helpers, Task 2 types.
- Produces:

  ```ts
  type StatsOutage = {
    type: 'OUTAGE' | 'POWER_BLIP';
    startedAt: number;
    endedAt: number | null;
    cause: OutageCause | null;
    kind: OutageKind | null;
  };
  type StatsRange = { period: StatsPeriod; from: LocalDate; to: LocalDate }; // resolved, inclusive
  resolveRange(query: StatsQuery, timezone: string, now: number): StatsRange;
  bucketsFor(range: StatsRange, timezone: string): { bucket: StatsBucketKind; slots: { start: number; end: number }[] };
  computeStats(input: {
    range: StatsRange;
    timezone: string;
    now: number;
    monitoringSince: number | null;
    shortOutageThresholdS: number;
    outages: StatsOutage[];
  }): DeviceStats;
  ```

- [ ] **Step 1: Failing tests**, each with a fixed `now` and hand-built outages:
  - `resolveRange`: `WEEK` + `from: '2026-11-27'` → `2026-11-23 → 2026-11-29`. `DAY` with no `from` → today in the timezone at `now` (`now` = 2026-11-26T23:30Z, Kyiv → `2026-11-27`).
  - `bucketsFor`: `DAY` 2026-03-29 Berlin → 23 `HOUR` slots, the total is 82 800 s. 2026-10-25 → 25 slots. `MONTH` → `DAY` slots. `CUSTOM` 2026-01-15 → 2026-03-10 → 3 `MONTH` slots, the first starting 2026-01-15 and the last ending at the start of 2026-03-11 (Review Focus 1).
  - An outage 23:30 → 01:15 local across two `DAY` buckets: total `outages: 1`, each bucket `outages: 1`, downtime 1 800 s and 4 500 s (Review Focus 2).
  - An outage 01:30 → 03:30 local on 2026-03-29 Berlin: `total_downtime_s` = 3 600 (Review Focus 1).
  - An open outage started 2 h before `now`, threshold 180: `open_outage: true`, `long_outages` includes it, `by_cause` sums to `outages − 1`, downtime 7 200. Buckets after `now` have `availability_pct: null` and `total_downtime_s: 0` (Review Focus 3).
  - An open outage started 60 s before `now`, threshold 180: not in `long_outages`.
  - `monitoringSince` in the middle of a day: availability uses only the time after it. `monitoringSince: null` → every `availability_pct` is `null`, and counts still work (Review Focus 4).
  - A power blip: counts in `power_blips` and in its bucket. It doesn't change `outages`, downtime or `by_cause`.
  - An outage that started before the range: counted, downtime clipped to `from`, `longest_outage_s` = its full duration.
  - `avg_outage_s` is floored. Availability is rounded to 2 decimals (e.g. 1 s down in a day → `100` vs. 600 s → `99.31`). No outages → `avg_outage_s: null`, `longest_outage_s: null`, `availability_pct: 100`.
- [ ] **Step 2:** Run `npm run test -w server -- stats/compute` → FAIL.
- [ ] **Step 3:** Implement. Clip each interval to `[slot.start, min(slot.end, now))` and to `monitoringSince`. Hour slots step 3 600 000 ms from `dayStart(from)` to `dayStart(addDays(from, 1))`. Month slots run from `dayStart` of each month start (or the range start), clipped to the range end.
- [ ] **Step 4:** Run → PASS. Each test runs in well under 1 s.
- [ ] **Commit point:** `Add stats computation with timezone buckets`

### Task 4: `GET /devices/:id/stats`

**Files:**

- Create: `server/src/stats/load.ts`, `server/src/http/devices/stats.ts`, `server/src/http/devices/stats.test.ts`
- Modify: `server/src/http/app.ts` (mount the router, add `statsPaths`), `server/src/http/__snapshots__/*` (via `-u`), `server/src/http/devices/access.test.ts` (add the route), `docs/API.md` §4 Outages and stats and §9 Inconsistencies (remove the "Stats response" bullet)

**Interfaces:**

- Consumes: `computeStats`, `resolveRange`, `bucketsFor` (Task 3), `statsQuerySchema`, `statsSchema` (Task 2), `getAccessibleDevice`.
- Produces:

  ```ts
  loadStats(db: Db, input: { deviceId: string; query: StatsQuery; timezone: string; now: number }): Promise<DeviceStats>;
  statsPaths: ZodOpenApiPathsObject;
  statsRouter(deps: AppDeps): Router;
  ```

  `loadStats` resolves the range, runs one select on `outage` with the `GET /outages` overlap filter on `[range start, range end)` (index `outage_device_started_idx`), and one `select min(first_seen_at)` on `device_boot` for the device. It reads `short_outage_threshold_s` from the device row.

- [ ] **Step 1: Failing tests** (PGlite + supertest, `FakeClock`):
  - Access: no token → `401`. Stranger → `404`. Viewer → `200`. Owner → `200`. Unknown ID → `404`.
  - Validation: `period=CUSTOM&from=2026-01-01` → `400 validation_error` at `to`. `period=WEEK&from=2026-02-30` → `400`.
  - The caller's timezone: two users (owner `Europe/Kyiv`, viewer `America/New_York`) get different `from` for the same `period=DAY&from=2026-11-20`.
  - A device seeded with a bulk insert of one outage a day for 366 days, `period=YEAR` → 12 `MONTH` buckets, `outages` = the number of rows overlapping the year. The test runs in under 1 s.
  - A device whose first `device_boot` is 2026-11-25 → `monitoring_since` is that time, and the 2026-11-23 bucket has `availability_pct: null`.
  - A `PENDING` device → `200` with zero counts and every `availability_pct: null`.
- [ ] **Step 2:** Run `npm run test -w server -- stats` → FAIL.
- [ ] **Step 3:** Implement the route next to `historyRouter` (same `requireUser`, `deviceIdParam`, error responses). Add it to the OpenAPI paths under `Outages`. Rewrite A §4 "Outages and stats" with decisions 1–6. The route table says "Stats for a History range".
- [ ] **Step 4:** Run `npm run test -w server -- -u` and review the snapshot diff. Then run `npm run test -w server` → PASS.
- [ ] **Commit point:** `Add device stats endpoint`

### Task 5: Bot `/stats`

**Files:**

- Modify: `server/src/telegram/bot.ts`, `server/src/telegram/bot.test.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts` (`telegram.bot.stats.*`, `telegram.bot.help`), `docs/API.md` §6 (remove "until then it gets the help text"), `docs/PROJECT_V2.md` §7 (`/stats` format)

**Interfaces:**

- Consumes: `loadStats` (Task 4), `formatDuration`, `momentParts`, `telegramT`.
- Produces: `case 'stats'` in the command switch. It reuses the `/status` device query (extract `chatDevices(db, chatId)` and use it in both cases).

- [ ] **Step 1: Failing tests** in `bot.test.ts` (`describe('/stats')`, `FakeClock` at 2026-11-27T10:00Z):
  - Unlinked chat → `notLinked`. Linked with no devices → `statusEmpty`.
  - Two devices, one with 3 outages (2 h 15 min total) and 2 blips, one never checked in → the exact decision 7 text in English, device names bold, and `Garage — no data yet` for the second.
  - A device name with `<script>` is escaped.
  - The owner's language `uk` gives the Ukrainian text, and the range label uses the owner's timezone.
  - `/help` and an unknown command list `/stats`.
  - The existing test that checks every `telegram.*` text allows only `<b>`, and it still passes with the new keys.
- [ ] **Step 2:** Run `npm run test -w server -- telegram/bot` → FAIL.
- [ ] **Step 3:** Implement. Call `loadStats` per device with `{ period: 'CUSTOM', from: addDays(today, -6), to: today }` in the owner's timezone. Use plural keys (`_one`, `_few`, `_many`, `_other`) for "outages" and "power blips" in uk and ru.
- [ ] **Step 4:** Run `npm run test -w server` and `npm run test -w shared` (parity) → PASS.
- [ ] **Commit point:** `Answer /stats in the platform bot`

### Task 6: Chart control in `components/ui`

**Files:**

- Create: `client/src/components/ui/chart.tsx`, `client/src/components/ui/chart.test.tsx`
- Modify: `client/package.json` (`recharts` ^3), `package-lock.json`, `client/src/components/ui/consistency.test.ts` (only if it needs to know about the new control), `client/test/setup.ts` (a `ResizeObserver` stub if Recharts needs one in jsdom)

**Interfaces:**

- Produces:

  ```tsx
  type ChartSeries = Record<string, { label: string; color: string }>; // color is a CSS var, e.g. 'var(--status-offline)'
  <ChartContainer config={series} className>{recharts children}</ChartContainer>
  <ChartTooltip content={<ChartTooltipContent formatter? />} />
  ```

  `ChartContainer` sets `--color-<key>` from the config, renders `ResponsiveContainer`, and turns off animation for its children by default. Text uses `text-xs` and `--muted-foreground`. Grid lines use `--border`.

- [ ] **Step 1: Failing tests:** `ChartContainer` with a two-key config sets `--color-downtime` on its root. A `BarChart` with 3 data points, rendered at a fixed size, draws 3 bars whose `fill` is `var(--color-downtime)`.
- [ ] **Step 2:** Run `npm run test -w client -- chart` → FAIL.
- [ ] **Step 3:** Install `recharts`. Add the shadcn `chart` component (`npx shadcn add chart`), then adapt it: theme tokens only, no hex, no hard-coded timings, no animation.
- [ ] **Step 4:** Run `npm run test -w client` → PASS (the consistency and motion tests too).
- [ ] **Commit point:** `Add chart control on Recharts`

### Task 7: Stats tab

**Files:**

- Create: `client/src/lib/useRangeParams.ts` (extracted from `useHistoryParams` in `DeviceHistory.tsx`), `client/src/pages/devices/stats/DeviceStats.tsx`, `client/src/pages/devices/stats/StatsSummary.tsx`, `client/src/pages/devices/stats/StatsChart.tsx` (default export, lazy loaded), `client/src/pages/devices/stats/CauseBars.tsx`, `client/src/pages/devices/stats/DeviceStats.test.tsx`
- Modify: `client/src/pages/devices/DevicePage.tsx` (the `stats` section, icon `ChartColumn`), `client/src/pages/devices/history/DeviceHistory.tsx` (use `useRangeParams`), `client/src/api/endpoints.ts`, `client/src/api/queries.ts` (`useDeviceStats(id, range)`), `client/test/server.ts` and `client/test/fixtures.ts` (MSW stats handler and fixture), `client/src/appStyles/motion.test.tsx` (only if a new pattern needs listing), `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.device.tabs.stats`, `app.stats.*`)

**Interfaces:**

- Consumes: `GET /devices/:id/stats` (Task 4), `ChartContainer` (Task 6), `PeriodNav` and `PeriodSelect` from `history/PeriodControls.tsx`.
- Produces: `useRangeParams(today) → { range, setRange }`. `useDeviceStats(deviceId, range)` sends `period` uppercased, `from` and `to` (custom only). Its query key includes the timezone. It polls with `pollMs.device` only while the range contains today.

Layout (top to bottom):

1. Period controls, the same components as History.
2. Summary tiles (`data-motion="enter"`, stagger with `--i`): availability, time without contact, outages (with "3 long"), average and longest, power blips. A null availability shows "No data yet". Before the first check-in the panel shows "Statistics start after the first check-in" with the `EmptyState` illustration.
3. Chart card: downtime per bucket (lazy `StatsChart`, `Skeleton` fallback of the same height). Axis labels are hours for `HOUR`, day numbers for `DAY` and short month names for `MONTH`, in the user's locale and timezone. The tooltip shows the bucket label, outages, downtime and availability. On phones the axis shows every 3rd hour label or every 5th day label. Bars never scroll sideways (at most 31 buckets).
4. Cause bars: power, network and unknown with counts and shares, plus "1 still open" when `open_outage`.

- [ ] **Step 1: Failing tests** (Testing Library + MSW, fixed `now`):
  - `?tab=stats` renders the Stats tab. The tiles show `95.24%`, `8 h`, `7 outages · 3 long` and `2 power blips` from a decision 6 fixture.
  - Changing the period to Month calls the API with `period=MONTH`. Switching to the History tab keeps `?period=month`.
  - `statsPollMs(range, today)` returns `pollMs.device` for a range with today and `false` for last month. `useDeviceStats` passes it as `refetchInterval`.
  - `availability_pct: null` everywhere → "Statistics start after the first check-in".
  - The `sr-only` table has one row per bucket with its downtime text.
  - Cause bars: `open_outage: true` shows the "still open" line.
  - The API error shows the retry button (same pattern as History).
- [ ] **Step 2:** Run `npm run test -w client -- stats` → FAIL.
- [ ] **Step 3:** Implement. Extract `useRangeParams` first and keep the History tests green. Then build the tab from `components/ui` only.
- [ ] **Step 4:** Run `npm run test -w client`, `npm run build -w client`. Check that `recharts` is not in the entry chunk: `grep -L recharts client/dist/assets/index-*.js` lists the entry file (Review Focus 5). Run the full `npm test` from the root.
- [ ] **Commit point:** `Add Stats tab with charts`

### Task 8: Spec, theme and roadmap

**Files:**

- Modify: `docs/PROJECT_V2.md` §9 Device page (Stats tab, its order and contents; drop "later" and the "Then stats (day / week / month)" fragment), `docs/theme.md` (chart colors: downtime `--status-offline`, blips `--warning`, causes; no chart animation; the phone axis rule under Touch tier), `docs/DATABASE.md` §9 Stats (monitoring start from `device_boot`, the overlap rule), `docs/ROADMAP.md` (M9 deliverables ticked when merged, status, Q14 not affected)

- [ ] **Step 1:** Update the docs to match what was built. Check the Spec links in this plan still resolve.
- [ ] **Step 2:** Run `npm run lint`, `npm run fmt:check`, `npm run typecheck` and the full `npm test` → PASS.
- [ ] **Commit point:** `Document statistics and close M9 tasks`

## Manual checks

Verify by hand on staging with a device that has a few outages:

- The Stats tab for Day, Week, Month, Year and Custom. The totals match the History list for the same range.
- Charts in all four app styles, light and dark. The tooltip appears on hover and on tap.
- On a phone: tiles wrap, axis labels don't overlap, and nothing scrolls sideways.
- The first load of the Stats tab shows the skeleton, then the chart, with no layout jump.
- `/stats` in a private chat and in a group, in uk, en and ru.
- A day with an outage still open: the downtime grows on each poll.
