# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current focus: building PROJECT_V1

We are building **v1** as specified in `docs/PROJECT_V1.md`. Follow its
scope strictly: one owner, one device, as little code as possible.

`docs/PROJECT_V2.md` (multi-user platform: auth, many devices, sharing,
webhooks, REST API, React client) is the **future** plan. Don't build v2
features now. Read it only to avoid v1 choices that would make v2
harder (e.g. keep Telegram sending in one `notifyTelegram(text)`
function, which v2 turns into a `Notifier` interface).

## docs/

The specs are the source of truth. Read the relevant section before
changing behaviour, and update the spec if a decision changes.

- `docs/PROJECT_V1.md` — current spec (goal, firmware, server,
  deploy, milestones).
- `docs/PROJECT_V2.md` — next version, not in scope yet.
- `docs/DEVICE_STATUS.md` — LED states and serial log messages. Update it
  when firmware LED or log behaviour changes.

## What v1 is

An ESP32-C3 SuperMini on mains power pings the server every 30 s. When
pings stop for `OFFLINE_TIMEOUT` (120 s), the server sends
"🔴 Power is OFF" to the owner's Telegram; the next ping sends
"🟢 Power is ON" with the outage duration. An outage is detected by
missing pings, not directly.

Planned layout (no code exists yet):

```
firmware/   PlatformIO + Arduino, board esp32-c3-devkitm-1
server/     Node.js LTS + Express + TypeScript, Vitest
```

## Key design points (span several spec sections)

- **Only two monitoring variables in memory:** `lastSeen` (initially
  null) and `offlineNotified` (initially false). No formal state machine,
  database, event history, or restart recovery in v1.
- **On startup/restart**, wait for the first valid ping, then monitor.
  The first ping is silent. Any previous outage is forgotten.
- The checker triggers OFF once after the timeout. The next ping triggers
  ON with duration calculated from the previous `lastSeen` before updating
  it. Update both variables before asynchronous notification work.
- Test ping/checker behavior with Vitest and a controlled clock, without
  real HTTP requests or Telegram sends.
- `uptime_s` is diagnostic only in v1; outage classification belongs to v2.
- Telegram failures are logged and retried, never crash the server.
- Device token is compared in constant time. Secrets live in env vars
  (server) and `firmware/include/secrets.h` (never committed).
- Deploy: one process on one Render **paid** instance (free tier sleeps).
  No Supabase setup is needed for v1.
