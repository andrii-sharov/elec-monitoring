# M4b — Device page tabs, history views and brand assets

Follow-up polish to [M4](M04-client.md).

## Design

### Intent

The device page is one long scroll, and the outage timeline is hard to read
once a device has many outages. Split the page into tabs and give the
history three views with period navigation. Ship the brand assets from
`assets/` (logo, favicons, social image, promo video) in the client.

### Goals

- **Tabs** under the hero: History, Notifications, Members. The tab lives in
  the URL (`?tab=history|notifications|members`, default `history`,
  replacing the history entry), so links and reloads keep it. The "Finish
  setting up" section of a `PENDING` device stays above the tabs. Stats (M9) becomes a fourth tab.
- **History views**: Timeline, Grid and Table, switched with a segmented
  control. The view lives in the URL (`?view=timeline|grid|table`, default
  `timeline`) and the last choice is remembered in `localStorage`
  (`em.historyView`).
- **One week per screen.** All three views show one Monday–Sunday week in
  the user's timezone, with previous / next week buttons and "This week".
  The week lives in the URL (`?week=YYYY-MM-DD`, its Monday). The client
  loads the week with `from` / `to`, following cursors until done.
- **Timeline** groups outages by day under day headings (newest first),
  with a row of day chips (Mon–Sun, outage count each) that scrolls to a
  day. Days without outages are skipped.
- **Grid** is a 7 × 24 board like a power-company schedule: a row per day,
  a column per hour. Each cell fills by how much of the hour had no power
  (outage) and marks power blips. Hover shows the hour and the time
  without power; screen readers read the same text per cell. Future hours are blank. On narrow screens the grid
  scrolls sideways with the day column fixed.
- **Table**: start, end, duration, type, cause, kind; newest first.
- **Motion**: tab panels, view switches, timeline rows, grid rows and table
  rows use `data-motion="enter"` with a stagger.
- **Brand**: favicons, web manifest, `theme-color` and Open Graph tags in
  `index.html`; the logo mark replaces the bolt tile in the app header and
  on auth pages; the localized promo video plays beside the auth card on
  wide screens; the hero animation illustrates the empty Devices page.

### Non-goals

- No API or database changes: `GET /devices/:id/outages` already filters by
  `from` / `to`.
- No filters by cause or kind yet.
- No stats (M9).

### Anti-goals

- The promo video must not download on phones or play under
  `prefers-reduced-motion` (it shows the poster with controls instead).
- Status is never shown by color alone: grid cells have text labels.

## Decisions

- Week, not day, is the period for all views: the grid needs a week, and one
  shared period keeps switching views cheap (one query per week).
- Tab, view and week changes replace the history entry instead of pushing
  one, so Back leaves the device page.
- Time before the device existed shows as "Power on" in the grid: the API
  has no device creation time yet.
- Hero media is imported from `assets/` through Vite (hashed, cached);
  favicons, manifest and social images are copied to `client/public/`
  because they need fixed URLs.

## Tasks

- [x] Animate channel, member and invite rows; add the client motion rule.
- [x] Brand assets in the client.
- [x] Device page tabs.
- [x] Week loading and the three history views.
- [x] Spec, roadmap and theme docs.
