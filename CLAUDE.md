# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current focus: v2

v1 is released. The active product plan is the [v2 specification](docs/PROJECT_V2.md),
which describes the multi-user platform and the migration from v1.

## docs/

The specs are the source of truth. Read the relevant section before
changing behaviour, and update the spec if a decision changes.

- [PROJECT_V2.md](docs/PROJECT_V2.md) covers active requirements and milestones.
- [PROJECT_V1.md](docs/archived/PROJECT_V1.md) records the released v1 design.
- [DEVICE_STATUS.md](docs/DEVICE_STATUS.md) covers LED states and serial log
  messages. Update it when firmware LED or log behaviour changes.

## v2 design

- `server/` contains the Node.js/Express API and the background worker.
  PostgreSQL is the source of truth for accounts, devices, monitoring state
  and notification deliveries. Preserve `/ping` for migrated v1 devices.
- Server stack: Express 5 (async errors reach the error handler without
  try/catch), TypeScript built with `tsc`, run in dev with `tsx`, tests in
  Vitest. Where the `node` skill suggests `node:test` or type stripping,
  follow this stack instead.
- `client/` is the planned React app for account and device management.
  `admin/` is the planned React app for platform monitoring. Both use the
  same API. Enforce owner, viewer and platform administrator permissions
  on the server.
- Generate the public OpenAPI document from API schemas and serve it through
  Swagger UI. Keep Ukrainian, English and Russian translations in keyed
  dictionaries in the repo.
- Treat a missed ping as loss of contact. Estimate the cause after the
  device returns. Test time-based monitoring with Vitest and a controlled
  clock, without real HTTP requests or Telegram sends.
- `firmware/` targets ESP32-C3. Device settings sync on check-in. Distribute
  compiled releases and verify signed OTA updates. An OTA reboot requires
  server confirmation of a bounded maintenance window. If the device misses
  the deadline, mark it offline and notify the user.
