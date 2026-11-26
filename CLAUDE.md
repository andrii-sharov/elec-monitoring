# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current focus: v2

v1 is released. The active product plan is the [v2 specification](docs/PROJECT_V2.md),
which describes the multi-user platform.

## docs/

The specs are the source of truth. Read the relevant section before
changing behaviour, and update the spec if a decision changes.

- [PROJECT_V2.md](docs/PROJECT_V2.md) covers active requirements and milestones.
- [ROADMAP.md](docs/ROADMAP.md) is the build order and progress tracker.
  Tick deliverables and update statuses as work merges. Write each
  milestone's detailed plan in `docs/plans/` before starting it.
- [API.md](docs/API.md) is the source of truth for all API endpoints,
  auth, errors, rate limits and payloads. Update it when an endpoint changes.
- [DATABASE.md](docs/DATABASE.md) is the source of truth for the PostgreSQL
  schema: tables, constraints and indexes. Update it when a table changes.
- [PROJECT_V1.md](docs/archived/PROJECT_V1.md) records the released v1 design.
- [theme.md](docs/theme.md) is the source of truth for app colors. Update it
  when a color token changes.
- [DEVICE_STATUS.md](docs/DEVICE_STATUS.md) covers LED states and serial log
  messages. Update it when firmware LED or log behaviour changes.

## Environment variables

- When code starts reading a new env variable, add it in the same change to
  `server/.env.example` (local value) and `deploy/staging.env.example`
  (placeholder) when staging needs it, and to the config list in
  [PROJECT_V2.md §12](docs/PROJECT_V2.md). Keep `server/.env.example` valid:
  the API must start with it as-is.

## v2 design

- `server/` contains the Node.js/Express API and the background worker.
  PostgreSQL is the source of truth for accounts, devices, monitoring state
  and notification deliveries.
- Server stack: Node.js 26 LTS, Express 5 (async errors reach the error
  handler without try/catch), TypeScript built with `tsc`, run in dev with
  `tsx`, tests in Vitest (database tests on in-process PGlite, lock and
  `skip locked` tests on a real Postgres service in CI), Drizzle ORM with
  Drizzle Kit SQL migrations, Zod
  for request and response schemas with `zod-openapi` generating the
  OpenAPI document, `jose` for JWTs, `arctic` for Google sign-in, i18next
  for server-rendered messages. Where the `node` skill suggests
  `node:test` or type stripping, follow this stack instead.
- `client/` is the planned React app for account and device management.
  `admin/` is the planned React app for platform monitoring. Both use the
  same API. Enforce owner, viewer and platform administrator permissions
  on the server.
- Client motion: every new or changed screen, section, list and panel in
  `client/` uses the existing motion system from `client/src/styles.css`
  and [theme.md](docs/theme.md). Content that appears gets
  `data-motion="enter"`, and list rows add a stagger with
  `style={{ '--i': index }}`. Tab and view panels use `data-motion="panel"`.
  Live indicators use `data-motion="ambient"`. Use the motion tokens, never
  hard-coded timings, and keep `prefers-reduced-motion` working. Don't
  add another animation library.
- Motion must never hide or flash content:
  - no entrance inside another entrance;
  - nothing stays invisible longer than `--app-enter-duration` (240 ms max);
  - decorative animation (flicker, pulse, snap) runs only on a real state
    change through `useStateChange`, never on mount.
  - `client/src/appStyles/motion.test.tsx` enforces this. Extend its
    ambient list only for motion that `theme.md` allows.
- Client base controls: pages and features build every control from
  `client/src/components/ui` and never restyle its padding, size or motion.
  - Dropdowns use `Select`, or `PickerField` when they need search. Both
    share the `select*ClassName` look.
  - Segmented button groups use `SegmentedControl` and `Segment`, which
    share the pill look and sliding indicator of `TabsList variant="pill"`.
  - Popovers and menus use the `Popover` and `DropdownMenu` wrappers.
  - A missing control or variant goes into `components/ui` first.
  - `client/src/components/ui/consistency.test.ts` enforces this. It
    rejects Base UI imports, raw form elements and hand-rolled
    popup or pressed-state classes outside `components/ui`.
- `shared/` is an npm workspace for code used by the server and both React
  apps: the translation dictionaries and shared enums.
- Generate the public OpenAPI document from API schemas and serve it through
  Swagger UI. Keep Ukrainian, English and Russian translations in keyed
  dictionaries in `shared/`.
- Treat a missed ping as loss of contact. Estimate the cause after the
  device returns. Test time-based monitoring with Vitest and a controlled
  clock, without real HTTP requests or Telegram sends.
- `firmware/` targets ESP32-C3. Device settings sync on check-in. Distribute
  compiled releases and verify signed OTA updates. An OTA reboot requires
  server confirmation of a bounded maintenance window. If the device misses
  the deadline, mark it offline and notify the user.
