# Electricity Monitor — Project Spec (v1, archived)

The [v2 specification](../PROJECT_V2.md) is the active plan. This document
records the released v1 design.

## 1. Goal

Get a Telegram message when the electricity in the house goes off, and
another one when it comes back.

An ESP32-C3 SuperMini is plugged into mains power at home (USB charger,
no battery). It sends a **ping** to the server over the home Wi-Fi.
While the power is on, pings keep coming in. When the power goes off,
the ESP turns off and the pings stop. The server sees this and sends a
message.

We don't detect an outage directly — we detect that the pings stopped.

**v1 is for testing the idea:** one owner, one device, as little code as
possible. The next version is the [multi-user platform](../PROJECT_V2.md).

## 2. Scope

### In v1

- One ESP32-C3 device sending pings over HTTPS.
- Express (Node.js) server with 2 endpoints: `/ping` and `/health`.
- Two in-memory variables: `lastSeen` and `offlineNotified`.
- Telegram notifications to the owner's private chat when pings stop/resume:
  - `🔴 Power is OFF` (with the time of the last ping)
  - `🟢 Power is ON` (with how long the outage lasted)
- Server deployed on Render.

### Not in v1

- Database, event history, restart recovery, formal state machine.

- Client app, users, accounts, public API, webhooks → v2.
- Statistics, short vs long outages, other messengers → v2.

## 3. Device (ESP32-C3 SuperMini firmware)

### Behaviour

1. Boot → connect to home Wi-Fi.
2. Every `PING_INTERVAL` (**30 s**) send:
   ```
   POST https://<server>/ping
   Authorization: Bearer <DEVICE_TOKEN>
   Content-Type: application/json

   {"uptime_s": 12345}
   ```
3. If Wi-Fi drops → keep trying to reconnect.
4. If the request fails → try again on the next tick. HTTP timeout ~10 s.
5. Hardware watchdog on: if the firmware hangs, the chip restarts.
6. Status LEDs — see `DEVICE_STATUS.md`.

`uptime_s` is diagnostic information only in v1. Automatic power vs
network classification is deferred to v2.

### Notes

- ESP32-C3 supports **2.4 GHz Wi-Fi only**.
- The SuperMini's antenna is weak at full TX power: it associates but
  drops connections. Firmware sets TX power to 8.5 dBm, which made
  pings reliable in testing.
- Wi-Fi reconnects are left to the driver's auto-reconnect; the firmware
  forces `WiFi.reconnect()` only after 60 s without a connection, so it
  doesn't interrupt a slow WPA2/WPA3 handshake.
- The server timestamps events. The ESP synchronizes time for HTTPS
  certificate validation and uses a trusted CA certificate.
- Wi-Fi SSID/password, server URL and token live in
  `include/secrets.h`, which is **not** committed to git.

### Tooling

- PlatformIO + Arduino framework (`esp32-c3-devkitm-1` board profile
  works for the SuperMini).

## 4. Server (Express)

### Endpoints

| Method | Path      | Auth         | Purpose           |
| ------ | --------- | ------------ | ----------------- |
| POST   | `/ping`   | device token | Ping from the ESP |
| GET    | `/health` | none         | Server is alive   |

`/ping` returns `204` on success, `401` on a wrong token.

### How it works

Only two variables, kept in memory:

```
lastSeen         time of the last valid ping, initially null
offlineNotified boolean, initially false
```

1. **On a valid `/ping`:** capture the previous `lastSeen`. If
   `offlineNotified` is true, prepare an ON message with the estimated
   duration (`now - previous lastSeen`). Update `lastSeen = now` and
   clear `offlineNotified` before starting any asynchronous send.
   Send the prepared message, if any. The first ping starts monitoring
   silently; ordinary pings produce no message.
2. **Checker** (`setInterval`, every **10 s**): if `lastSeen` is not null,
   `now - lastSeen > OFFLINE_TIMEOUT`, and `offlineNotified` is false,
   set `offlineNotified = true` before starting the OFF notification.
   Include `lastSeen` in the message. Further checks do not send more
   OFF alerts until a ping returns.
3. **On server start/restart:** reset both variables. Wait for the first
   valid ping before monitoring. No database, history, or recovery.

`offlineNotified` means an OFF notification was triggered; delivery
retries belong to `notifyTelegram`, not the checker. Invalid or
unauthenticated requests never update `lastSeen`.

Duration is an estimate from the last signal to the first returning
signal, including network reconnection time.

### Timing

| Setting           | Default | Meaning                     |
| ----------------- | ------- | --------------------------- |
| `PING_INTERVAL`   | 30 s    | ESP sends a ping this often |
| `OFFLINE_TIMEOUT` | 120 s   | ~4 missed pings → OFF alert |
| `CHECK_INTERVAL`  | 10 s    | How often the server checks |

An outage is reported **~2 minutes** after it starts.

### Telegram

- `POST https://api.telegram.org/bot<TOKEN>/sendMessage`.
- Messages go only to the owner's private chat.
- A failed send is logged and retried a few times; it must never crash
  the server.
- Kept in one small `notifyTelegram(text)` function. v2 turns this into
  a `Notifier` interface for more messengers.

Setup:

1. Create a bot with `@BotFather`, get the bot token.
2. Send any message to the bot.
3. Get the `chat_id` via `getUpdates`.
4. Put both into the Render environment variables.

Messages:

```
🔴 Power is OFF
Last signal: 21 Nov 18:42

🟢 Power is ON
Was off for 2 h 15 min (18:42 → 20:57)
```

### Config (environment variables)

```
DEVICE_TOKEN=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
OFFLINE_TIMEOUT=120
CHECK_INTERVAL=10
TZ=Europe/Kyiv
```

### Stack

- Node.js (LTS) + Express + TypeScript.
- Tests: Vitest. Test the ping/checker logic with a controlled clock,
  without real HTTP requests or Telegram sends.

## 5. Deployment

The server must run **outside the house**. If it runs at home, it loses
power together with the ESP and can't send anything.

- **Render:** one Web Service for the Express server. Must be a **paid**
  instance: free services sleep after ~15 min without requests, so
  during a long outage the checker would stop and the first ping after
  the power returns would hit a cold start.
- Run one server process/instance for this test. Its monitoring memory
  is local to that process.

## 6. Known limitations

- **Power outage vs internet outage.** If the router or the internet
  provider goes down while the power is on, pings also stop and the
  server reports "Power is OFF". V1 does not distinguish the cause.
- **Server restart resets monitoring.** Any ongoing outage is forgotten.
  The next ping starts monitoring silently, without an ON alert or
  duration for the forgotten outage. This is acceptable for the test.
- **No saved history.** Notification retries are in memory too; a restart
  can lose pending messages.
- **Server down = no alerts.**

## 7. Security

- HTTPS only (Render).
- Device token compared in constant time.
- Secrets in Render env vars / `secrets.h`, never in git.

## 8. Repo layout

```
elec-monitoring/
  docs/
  firmware/
  server/
```

## 9. Milestones

1. **Firmware:** ESP connects to Wi-Fi and sends pings (test against a
   local server).
2. **Server:** `/ping`, `/health`, two-variable checker, with tests.
3. **Telegram:** OFF / ON messages.
4. **Deploy:** Render, point the ESP at it.
5. **Real test:** unplug the ESP → OFF message in ~2 min; plug it back
   in → ON message with duration.

V1 is successful when the ESP reconnects reliably and Telegram receives
one OFF alert per detected gap and one ON alert on recovery. Also check
that no alert is sent before the first ping, repeated checker ticks do
not duplicate OFF alerts, and a server restart starts monitoring fresh.
