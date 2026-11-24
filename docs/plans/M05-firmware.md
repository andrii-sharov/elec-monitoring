# M5 — Firmware core and device setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a real ESP32-C3 is flashed from the browser or pre-flashed, set up from a phone through its own captive portal, claims a pairing code and checks in with `BOOT` and `PING`. It sends Wi-Fi diagnostics. The first firmware fixes the partition table and the OTA verifying key for the life of the device.

**Architecture:** `firmware/` is a PlatformIO project on Arduino core 3.x (pioarduino platform, ESP-IDF 5). All decision logic lives in `firmware/lib/core/`: reset reason mapping, backoff, the Wi-Fi interruption log, check-in bodies and the check-in scheduler. It is plain C++17 with no Arduino headers and is unit-tested natively (`pio test -e native`, Unity). `firmware/src/` is thin Arduino glue: Wi-Fi events, NVS, HTTPS, captive portal, LED and button. It feeds events into `core` and runs what `core` decides. CI builds and tests the firmware. A `fw-v*` tag builds staging and production images, signs them and attaches them to a GitHub Release. A server script uploads a release to that environment's private Supabase Storage bucket and adds the `firmware_release` row. The API serves the ESP Web Tools manifest and the factory image from the bucket. The client gets a **Flash firmware** page.

**Tech Stack:** PlatformIO Core 6, pioarduino `platform-espressif32` (Arduino core 3.x), ArduinoJson 7, Unity (native tests), mbedtls (in the framework), esptool `merge_bin`, OpenSSL in CI. Server: Node.js 26, Express 5, Zod 4, zod-openapi 6, Vitest 5. Client: React 19, `esp-web-tools` 10. Check the pioarduino platform URL, `board_build.embed_txtfiles`, Arduino 3.x `WiFiClientSecure`, `WebServer` / `DNSServer` and ESP Web Tools manifest fields against current docs (context7) before writing config.

**Spec:** [ROADMAP.md § M5](../ROADMAP.md#m5--firmware-core-and-device-setup) · [PROJECT_V2.md](../PROJECT_V2.md) §4 Two ways, Firmware, Monitoring signals, Wi-Fi diagnostics, Flash storage, Firmware distribution, Adding a device, §5 Monitoring acceptance checks, §12 CI/CD and Config · [API.md](../API.md) §2 claim and ping, §4 Firmware · [DATABASE.md](../DATABASE.md) §5 · [DEVICE_STATUS.md](../DEVICE_STATUS.md) · v1 firmware in git (`git show 24ab6f0:firmware/src/main.cpp`).

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints)–[M4](M04-client.md#global-constraints) constraints still applies to `server/`, `shared/` and `client/`. **No migration in M5**: `firmware_release` already has every column.
- **Permanent on the board:** bootloader, partition table and the OTA verifying public key. Any change to `firmware/partitions.csv`, `firmware/keys/` or the platform version that changes the bootloader needs explicit sign-off in review.
- `firmware/lib/core/` includes no Arduino or ESP-IDF headers. Time comes in as a `uint64_t` millisecond argument, and randomness through an injected `Random` interface. `firmware/src/` holds no decisions that could be tested natively.
- Monotonic time on the device is `esp_timer_get_time() / 1000` as `uint64_t` ms, never `millis()`, so nothing wraps.
- No flash writes on `PING` or Wi-Fi records. NVS is written only when setup succeeds or settings change.
- One HTTP request at a time, 10 s connect and response timeouts. The task watchdog (60 s) is fed in `loop()` only.
- The firmware never logs the device token, Wi-Fi password or pairing code.
- Firmware versions are plain semver `MAJOR.MINOR.PATCH`. Local builds report `0.0.0-dev`, and the release script rejects them.
- Device user-facing text (setup portal) comes from the `shared/` dictionaries in uk, en and ru through a generated header. Firmware code itself has no hand-written UI strings.
- The signing private key never enters the repo, the server or a developer machine after generation. Only the public key is committed.

## Decisions made in this plan

Task 1 records Q8–Q10 in the spec. The other tasks record their own decisions. Task 15 marks the rows ✅ in the ROADMAP.

1. **Framework (permanent):** PlatformIO with pioarduino, Arduino core 3.x. Task 1 confirms that the shipped bootloader has app rollback on (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`). If it doesn't, switch to `framework = arduino, espidf` with `sdkconfig.defaults` before anything else lands. M5 leaves Arduino's default "mark app valid at start". M11 overrides `verifyRollbackLater()`.
2. **Partition table** (4 MB flash, 64 KB aligned apps):

   | Name     | Type | SubType  | Offset     | Size       |
   | -------- | ---- | -------- | ---------- | ---------- |
   | nvs      | data | nvs      | `0x9000`   | `0x5000`   |
   | otadata  | data | ota      | `0xE000`   | `0x2000`   |
   | app0     | app  | ota_0    | `0x10000`  | `0x1E0000` |
   | app1     | app  | ota_1    | `0x1F0000` | `0x1E0000` |
   | reserved | data | `0x99`   | `0x3D0000` | `0x20000`  |
   | coredump | data | coredump | `0x3F0000` | `0x10000`  |

   `reserved` is unused space kept for a future data partition, since the table can't change later.

3. **Q10 signing:** ECDSA P-256 over the SHA-256 of `app.bin`. The signature is DER and stored as-is in `firmware_release.signature`. One key for staging and production. The public key is `firmware/keys/ota-signing.pub.pem`, embedded with `board_build.embed_txtfiles`. The private key is the GitHub secret `FIRMWARE_SIGNING_KEY`, with an offline backup in a password manager. Losing it means no more OTA for any device. The device prints the key fingerprint (first 8 bytes of the SHA-256 of the DER public key, hex) at boot. M5 ships the key, and M11 ships the verify code.
4. **Q8 storage:** one private Supabase Storage bucket per environment (`firmware`). A release lives at `<version>/app.bin` (OTA) and `<version>/factory.bin` (bootloader + partitions + `boot_app0` + app merged at offset 0, for the browser). `firmware_release.image_path` is the folder `<version>`, and `size_bytes` / `sha256` describe `app.bin`. The API streams files from the bucket, and nothing links to the bucket directly.
5. **Q9 releases:** a tag `fw-v<semver>` runs the release workflow. It builds the `staging` and `production` environments, merges the factory images, signs both app images and checks each signature against the committed public key. It attaches them to a GitHub Release. `npm run firmware:release -w server -- <dir> [--publish]` is run once per environment with that environment's `.env`. It checks the files and uploads them, then inserts a draft row (or publishes it). `--publish` on an existing draft only sets `published_at`. Compatible means every published `STABLE` release with a higher `version_code` (one board type). `version_code = major × 1 000 000 + minor × 1 000 + patch`.
6. **Server URL per environment:** PlatformIO environments `staging` (`https://staging-api.elec-monitoring.homes`) and `production` (`https://api.elec-monitoring.homes`). A local build can override it with `-DSERVER_URL=…` in `platformio_override.ini` (git-ignored), for example `http://<laptop IP>:3000`. A board stays tied to the environment it was flashed for.
7. **TLS:** the firmware trusts ISRG Root X1 and X2 (`firmware/certs/isrg-roots.pem`, embedded). The Caddyfile pins the ACME issuer to Let's Encrypt so Caddy never falls back to ZeroSSL. The CA list can change later over OTA. HTTPS waits for SNTP time (up to 30 s after IP, then it tries anyway and logs `time not synced`).
8. **Setup mode** starts when NVS has no Wi-Fi credentials or no device token, or when BOOT (GPIO 9) is held for 5 s at any time. AP `ElecMonitor-XXXX` (the last 2 MAC bytes, uppercase hex) is open and runs at 192.168.4.1 with a DNS catch-all and captive-portal probe redirects. The AP stays up (AP+STA) while the device tests the submitted Wi-Fi and claims, and the page polls a status endpoint. NVS is written only after Wi-Fi connects and, if a code was given, the claim succeeds. Then the device reboots after 3 s. The pairing code may be left empty when the device already has a token, which changes Wi-Fi only. Setup entered by button exits (reboots unchanged) after 10 min without a submission. On first boot it waits forever.
9. **Setup status** values: `IDLE`, `CONNECTING`, `WIFI_NOT_FOUND`, `WIFI_AUTH_FAILED`, `WIFI_FAILED`, `CLAIMING`, `CODE_INVALID` (404), `CODE_EXPIRED` (410), `SERVER_UNREACHABLE` (network error, 5xx, 429), `DONE`. Wi-Fi test timeout 30 s.
10. **Portal language** from `Accept-Language` (first of `uk`, `en`, `ru`, else `uk`), with a switcher. Strings are the `device.setup.*` keys in the shared dictionaries. `npm run firmware:strings -w shared` generates `firmware/src/generated/portal_strings.h`, and CI fails if it is stale.
11. **Check-in schedule:** `BOOT` once per boot as soon as Wi-Fi has an IP and time is synced. It retries with backoff starting at 2 s, doubling, capped at 60 s, with full jitter in `[d/2, d]`. `Retry-After` wins when it is longer, capped at 600 s. Every retry keeps `boot_id` and `seq` and refreshes `uptime_s` and `rssi`. After `BOOT` is acknowledged, `PING` runs every `ping_interval_s`. After a reconnect one `PING` goes out at once and missed ones are skipped. A failed `PING` is not retried early. The next one goes at the interval, or after `Retry-After` when that is later. `seq` starts at 1 and increases by 1 for every new check-in, not on a retry.
12. **`401`** on any check-in → `UNAUTHORIZED`: LED pattern, check-ins every 5 min, so a re-pair through setup mode is the fix. Any `204` clears it.
13. **Wi-Fi log:** the record is `{ uint16 id; uint8 kind; uint16 reason; uint32 start_uptime_s; uint32 end_uptime_s }` (≤ 16 bytes, `static_assert(sizeof(records) <= 512)`). Ids start at 1 per boot. `evicted` is a saturating `uint16`. A `WIFI` interruption starts at the first unexpected disconnect after the first IP of the boot. Failed reconnects add nothing, and the record closes on the next IP. An `API` interruption starts at the first check-in that fails at the network level while Wi-Fi is up (connect, TLS, timeout or 5xx). It ends at the next `204`, or at a Wi-Fi disconnect, which then starts a `WIFI` record. Disconnects in setup mode are not logged. A `PING` sends every completed record (≤ 16). On `204` only the ids in that request are removed. A `BOOT` sends none.
14. **LEDs** (blue, GPIO 8, active low): setup mode 1 Hz blink; Wi-Fi connecting 5 Hz blink; check-in delivered short flash; last check-in failed solid on; `UNAUTHORIZED` two short flashes every 2 s; BOOT held 5 s solid for 1 s before setup starts.
15. **Manifest and image endpoints (Q14):** `GET /api/v1/firmware/manifest.json` accepted. New `GET /api/v1/firmware/images/:version/factory.bin`: public, published releases only, streams from the bucket, `Cache-Control: public, max-age=86400, immutable`, rate limit 20 / min per IP. The manifest is `no-store`, points at the newest published `STABLE` release by `version_code`, and is `404 not_found` when there is none. `GET /api/v1/device/firmware/:version` stays proposed for M11.
16. **Storage config:** `FIRMWARE_STORE=supabase` (default) needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and takes `FIRMWARE_BUCKET` (default `firmware`). `FIRMWARE_STORE=fs` with `FIRMWARE_DIR` is for local runs. The Supabase store uses the Storage REST API with `fetch`, so there is no SDK dependency.
17. **Flash page** `/flash` sits in the signed-in layout. The add-device wizard's pairing step links to it with "Own ESP32-C3? Flash firmware first", opening in a new tab so the code stays visible. `esp-web-tools` is loaded with a dynamic import only on that page. Browsers without Web Serial see a "Use Chrome or Edge on a computer" message instead of the button.

## Review Focus

1. **Permanent parts.** Partition offsets in decision 2, rollback on in the bootloader (Task 1 evidence in the PR), the key embedded and its fingerprint logged. The release workflow and the release script both reject a signature that doesn't verify against the committed key. Tests in Tasks 10 and 11.
2. **`BOOT` retry identity.** A retried `BOOT` has the same `boot_id` and `seq` with fresh `uptime_s` and `rssi`. A new `PING` after it gets `seq + 1`. Tests in Tasks 4 and 5.
3. **Acknowledge only what was sent.** A record that completes while a `PING` is in flight, or an eviction during it, survives the `204`. Tests in Task 3.
4. **Setup never loses a working configuration.** Wrong password, a bad code or a lost claim response leave NVS unchanged, and the old settings still work after a reboot. Tests in Task 7 (form and transitions) and a manual check.
5. **No fast loops.** `401`, `429` and server outages never send more than 6 requests a minute. Tests in Task 5.
6. **Factory image matches.** `factory.bin` holds `app.bin` byte-for-byte at `0x10000`, so the signed hash covers what the browser flashes. Test in Task 11.

---

## File structure

```
firmware/platformio.ini                      envs: staging, production, native; FW_VERSION, SERVER_URL flags
firmware/partitions.csv                      decision 2
firmware/keys/ota-signing.pub.pem            Q10 public key (committed)
firmware/certs/isrg-roots.pem                ISRG Root X1 + X2
firmware/README.md                           build, flash, monitor, override, key and release steps
firmware/lib/core/reset_reason.{h,cpp}       mapResetReason, resetReasonName
firmware/lib/core/backoff.{h,cpp}            Backoff, parseRetryAfter
firmware/lib/core/random.h                   Random interface
firmware/lib/core/uuid.{h,cpp}               uuidV4
firmware/lib/core/wifi_log.{h,cpp}           WifiLog (ring buffer, in-progress, eviction, ack)
firmware/lib/core/checkin.{h,cpp}            BootSession, CheckInBody, buildCheckInJson
firmware/lib/core/scheduler.{h,cpp}          CheckInScheduler
firmware/lib/core/setup.{h,cpp}              SetupForm validation, SetupFlow states, normalizePairingCode
firmware/lib/core/settings.{h,cpp}           DeviceSettings, parseClaimResponse
firmware/src/main.cpp                        setup()/loop(), mode switch
firmware/src/{net,api,store,portal,led,button,clock}.{h,cpp}   Arduino glue
firmware/src/generated/portal_strings.h      generated, committed
firmware/test/test_*/                        native Unity suites
shared/scripts/firmware-strings.ts           dictionary → header generator
shared/src/i18n/locales/{uk,en,ru}.ts        + device.setup.*, app.flash.*
server/src/firmware/store.ts                 FirmwareStore, supabaseStore, fsStore, memoryStore
server/src/firmware/releases.ts              versionCode, latestPublished, findPublished
server/src/firmware/verify.ts                verifyRelease (sha256, signature, factory match)
server/src/http/firmware/firmware.ts         manifest and factory image routes
server/scripts/firmware-release.ts           upload + insert / publish
client/src/pages/firmware/FlashPage.tsx      ESP Web Tools page
.github/workflows/ci.yml                     + firmware job
.github/workflows/firmware-release.yml       tag → build, sign, GitHub Release
deploy/Caddyfile                             ACME issuer pinned to Let's Encrypt
```

Native suites run with `pio test -e native` from `firmware/`. Server and client tests sit next to the code as before.

---

### Task 1: PlatformIO project and permanent layout

**Files:**

- Create: `firmware/platformio.ini`, `firmware/partitions.csv`, `firmware/certs/isrg-roots.pem`, `firmware/src/main.cpp` (boot log only), `firmware/README.md`, `firmware/.gitignore` (`.pio/`, `platformio_override.ini`)
- Modify: `.gitignore`, `deploy/Caddyfile`
- Docs: `docs/PROJECT_V2.md` §4 Firmware (decisions 1, 2, 6, 7), Firmware distribution (Q8–Q10: decisions 3–5), §12 CI/CD (release flow); `docs/DATABASE.md` §5 `image_path` note, §12 Q3 resolved; `docs/API.md` §9 Q3–Q4 resolved

**Interfaces:**

- `[env]` common: pioarduino platform pinned to an exact release URL, `board = esp32-c3-devkitm-1`, `framework = arduino`, `board_build.partitions = partitions.csv`, `board_build.embed_txtfiles = keys/ota-signing.pub.pem, certs/isrg-roots.pem`, `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1`, `-DFW_VERSION=\"${sysenv.FW_VERSION}\"` with `0.0.0-dev` when unset (small `extra_scripts` helper), `lib_deps = bblanchon/ArduinoJson@^7`.
- `[env:staging]` / `[env:production]`: `-DSERVER_URL=\"https://staging-api.elec-monitoring.homes\"` / `\"https://api.elec-monitoring.homes\"`. `extra_configs = platformio_override.ini`.
- `[env:native]`: `platform = native`, `test_framework = unity`, `build_flags = -std=c++17 -Wall -Wextra -Werror`, `lib_compat_mode = off`.

- [ ] **Step 1 (manual, before the first build):** ask the user to generate the key on their computer, then commit only the public half. Verify by hand: `openssl ecparam -name prime256v1 -genkey -noout -out ota-signing.pem && openssl ec -in ota-signing.pem -pubout -out firmware/keys/ota-signing.pub.pem`; save `ota-signing.pem` as the GitHub secret `FIRMWARE_SIGNING_KEY` and in a password manager; delete the local copy. Wait for the public key file before continuing.
- [ ] **Step 2:** project files above. `main.cpp` prints `boot fw <FW_VERSION> server <SERVER_URL> ota key <fingerprint>` (decision 3) using mbedtls on the embedded PEM.
- [ ] **Step 3: Rollback check.** `pio run -e staging`, then find `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` and `CONFIG_APP_ROLLBACK_ENABLE` in the framework's `sdkconfig` used for the build. Paste the evidence in the PR description. If either is off, stop and switch to the hybrid framework (decision 1) before going on.
- [ ] **Step 4:** `pio run -e staging`, `pio run -e production` and `pio run -e native` succeed. The build log shows the custom partition table, and the app size is below `0x1E0000`.
- [ ] **Step 5:** Caddyfile: `tls { issuer acme }` on the API site (decision 7). Docs per the Files list.
- [ ] **Commit point:** `firmware/ .gitignore deploy/Caddyfile docs/` — `Add firmware project and partition layout`

### Task 2: Reset reason, UUID and backoff

**Files:**

- Create: `firmware/lib/core/random.h`, `reset_reason.{h,cpp}`, `uuid.{h,cpp}`, `backoff.{h,cpp}`, `firmware/test/test_reset_reason/`, `firmware/test/test_uuid/`, `firmware/test/test_backoff/`

**Interfaces:**

```cpp
struct Random { virtual uint32_t next() = 0; virtual ~Random() = default; };
enum class ResetReason { PowerOn, Brownout, Software, Watchdog, Panic, Unknown };
ResetReason mapResetReason(int espResetReason);   // values of esp_reset_reason_t
const char* resetReasonName(ResetReason);          // "POWER_ON", …
std::string uuidV4(Random&);
class Backoff {
 public:
  Backoff(uint32_t baseMs, uint32_t capMs, Random&);
  uint32_t nextDelayMs(std::optional<uint32_t> retryAfterS); // max(jittered, min(retryAfter, 600 s))
  void reset();
};
std::optional<uint32_t> parseRetryAfter(const char* header); // seconds only; null, "", "abc", "-1" → nullopt
```

- [ ] **Step 1: Tests:**
  - `mapResetReason`: `ESP_RST_POWERON` (1) → `PowerOn`; `ESP_RST_BROWNOUT` (9) → `Brownout`; `ESP_RST_SW` (3) → `Software`; `ESP_RST_INT_WDT`, `ESP_RST_TASK_WDT`, `ESP_RST_WDT` (5, 6, 7) → `Watchdog`; `ESP_RST_PANIC` (4) → `Panic`; `ESP_RST_EXT` (2), `ESP_RST_DEEPSLEEP` (8), `ESP_RST_SDIO`, `ESP_RST_USB`, `ESP_RST_JTAG`, `ESP_RST_EFUSE`, `ESP_RST_PWR_GLITCH`, `ESP_RST_CPU_LOCKUP`, 0 and 999 → `Unknown`. Copy the numeric values from the pinned framework's `esp_system.h` into the test as constants, so a renumbering fails the test. Check how `ESP_RST_USB` behaves on the SuperMini during the manual checks (USB-CDC resets).
  - `uuidV4` with a fixed `Random` → the expected string, version nibble `4`, variant `8–b`, 36 chars lowercase.
  - `Backoff(2000, 60000)` with a `Random` returning max → 2000, 4000, 8000 … 60000, 60000; with min → half of each; `reset()` starts again at 2000; `Retry-After 30` on the first attempt → 30000; `Retry-After 9999` → 600000.
  - `parseRetryAfter`: `"30"` → 30, `" 5 "` → 5, HTTP-date → `nullopt`.
- [ ] **Step 2: Run** `pio test -e native` → FAIL, implement, → PASS.
- [ ] **Commit point:** `firmware/lib/core/ firmware/test/` — `Add reset reason mapping and backoff`

### Task 3: Wi-Fi interruption log

**Files:**

- Create: `firmware/lib/core/wifi_log.{h,cpp}`, `firmware/test/test_wifi_log/`

**Interfaces:**

```cpp
enum class InterruptionKind : uint8_t { Wifi = 0, Api = 1 };
struct InterruptionRecord { uint16_t id; uint8_t kind; uint16_t reason; uint32_t startUptimeS; uint32_t endUptimeS; };
class WifiLog {
 public:
  static constexpr size_t kCapacity = 16;
  void onGotIp(uint32_t uptimeS);
  void onDisconnected(uint32_t uptimeS, uint16_t reason);
  void onApiFailure(uint32_t uptimeS);
  void onApiSuccess(uint32_t uptimeS);
  void setPlanned(bool planned);          // setup / OTA: ignore disconnects
  size_t snapshot(InterruptionRecord* out, size_t max) const; // oldest first
  void acknowledge(const uint16_t* ids, size_t count);
  uint16_t evicted() const;
};
```

- [ ] **Step 1: Tests** (decision 13):
  - a disconnect before the first IP isn't logged; after it, disconnect at 900 (reason 201) + three more disconnects + IP at 948 → one `Wifi` record `{ id 1, 900, 948, 201 }`.
  - API failure at 100 and 130, success at 160 → one `Api` record 100–160; an API failure then a Wi-Fi disconnect at 140 → `Api` 100–140 closed and a `Wifi` record opened at 140.
  - 20 completed records → `snapshot` returns ids 5–20 oldest first, `evicted() == 4`; the counter saturates at 65 535.
  - **Review Focus 3:** snapshot ids 1–3, record 4 completes, then `acknowledge({1,2,3})` → only record 4 remains. Snapshot 1–16, then two evictions push out 1–2 and add 17–18, then `acknowledge(1..16)` → 17 and 18 remain. Acknowledging unknown ids changes nothing.
  - `setPlanned(true)` → disconnects ignored, and an open interruption is dropped rather than closed.
  - `static_assert(sizeof(InterruptionRecord) * WifiLog::kCapacity <= 512)` compiles.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `firmware/lib/core/wifi_log* firmware/test/test_wifi_log/` — `Add Wi-Fi interruption log`

### Task 4: Boot session and check-in bodies

**Files:**

- Create: `firmware/lib/core/checkin.{h,cpp}`, `firmware/lib/core/settings.{h,cpp}`, `firmware/test/test_checkin/`, `firmware/test/test_settings/`

**Interfaces:**

```cpp
enum class CheckInType { Boot, Ping };
struct Telemetry { uint32_t uptimeS; int8_t rssi; };
class BootSession {
 public:
  BootSession(std::string bootId, ResetReason reason, std::string fw);
  uint32_t nextSeq();            // 1, 2, 3 …
  const std::string& bootId() const; ResetReason reason() const; const std::string& fw() const;
};
struct CheckInBody { CheckInType type; uint32_t seq; Telemetry telemetry; uint32_t settingsVersion;
                     std::vector<InterruptionRecord> events; uint16_t evicted; };
std::string buildCheckInJson(const BootSession&, const CheckInBody&);
struct DeviceSettings { uint32_t version; uint32_t pingIntervalS; };
struct ClaimResult { std::string deviceId; std::string token; DeviceSettings settings; };
std::optional<ClaimResult> parseClaimResponse(const char* json);
DeviceSettings clampSettings(DeviceSettings); // ping 15..600, else default 30
```

- [ ] **Step 1: Tests:**
  - `BOOT` JSON equals the A §2 example field for field (parse it back with ArduinoJson and compare), has `settings_version` and no `wifi` key; a `PING` with two events has `wifi: { evicted, events: [{ id, kind: "WIFI"|"API", start_uptime_s, end_uptime_s, reason }] }`; `API` events send `reason: null`; a `PING` with no events and `evicted == 0` omits `wifi`.
  - `reset_reason` is the name of the session's reason on `PING` too.
  - **Review Focus 2:** a body rebuilt with the same `seq` and new telemetry differs only in `uptime_s` and `rssi`.
  - `parseClaimResponse` on the A §2 `200` body → fields; missing `device_token`, a token that isn't 64 hex chars, or invalid JSON → `nullopt`.
  - `clampSettings({3, 5})` → `{3, 30}`; `{3, 60}` unchanged.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `firmware/lib/core/checkin* firmware/lib/core/settings* firmware/test/` — `Add check-in bodies`

### Task 5: Check-in scheduler

**Files:**

- Create: `firmware/lib/core/scheduler.{h,cpp}`, `firmware/test/test_scheduler/`

**Interfaces:**

```cpp
enum class CheckInOutcome { Accepted, RateLimited, Unauthorized, BadRequest, ServerError, NetworkError };
struct Due { CheckInType type; bool retry; };
class CheckInScheduler {
 public:
  CheckInScheduler(uint32_t pingIntervalS, Random&);
  void onLinkReady(uint64_t nowMs);       // IP + time synced (or 30 s timeout)
  void onLinkLost(uint64_t nowMs);
  std::optional<Due> due(uint64_t nowMs) const;
  void onResult(CheckInType, CheckInOutcome, std::optional<uint32_t> retryAfterS, uint64_t nowMs);
  bool bootAcknowledged() const; bool unauthorized() const; bool lastFailed() const;
};
```

- [ ] **Step 1: Tests** (decisions 11–12, fake `Random` at max jitter):
  - nothing due before `onLinkReady`; then `BOOT` (`retry: false`) at once.
  - `BOOT` `NetworkError` → `BOOT` `retry: true` after 2 s, then 4 s, 8 s …, capped at 60 s; `ServerError` the same; `RateLimited` with `Retry-After 45` → 45 s.
  - `BOOT` `Accepted` → `PING` due after 30 s; `PING` failures don't advance the schedule early; `PING` `RateLimited` with `Retry-After 90` → next `PING` at 90 s.
  - link lost for 5 min within the boot, then `onLinkReady` → one `PING` due at once, not a burst.
  - link lost before `BOOT` was acknowledged → `BOOT` again on reconnect with `retry: true` (same `boot_id` and `seq`, Review Focus 2).
  - `Unauthorized` → `unauthorized()`, next attempt after 300 s; a later `Accepted` clears it.
  - `BadRequest` on `BOOT` → treated as accepted for scheduling, so the device moves on to `PING`, and `lastFailed()` is `true`.
  - **Review Focus 5:** simulate 10 min of every outcome with `due` / `onResult` at 100 ms steps → never more than 6 attempts in any 60 s window.
  - `nowMs` above 2³² works (no wrap).
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `firmware/lib/core/scheduler* firmware/test/test_scheduler/` — `Add check-in scheduler`

### Task 6: Portal strings

**Files:**

- Create: `shared/scripts/firmware-strings.ts`, `shared/scripts/firmware-strings.test.ts`, `firmware/src/generated/portal_strings.h`
- Modify: `shared/src/i18n/locales/{uk,en,ru}.ts` (`device.setup.*`), `shared/package.json` (`"firmware:strings"`), `shared/tsconfig.json` (include `scripts`)

**Interfaces:**

- `device.setup` keys: `title`, `language`, `wifiName`, `wifiScan`, `wifiPassword`, `pairingCode`, `pairingCodeHint`, `pairingCodeKeep`, `save`, and one per decision 9 status (`status.connecting` … `status.done`), plus `errors.ssidRequired`, `errors.passwordTooLong`, `errors.codeFormat`.
- `renderHeader(dicts: Record<'uk'|'en'|'ru', Record<string, string>>): string` builds a C++ header with `struct PortalStrings { const char* title; … }` and `kPortalStrings[3]` in `uk, en, ru` order. Strings are escaped for C and HTML (`"`, `\`, `<`, `&`, newlines).
- `npm run firmware:strings -w shared` writes the header. CI regenerates it and runs `git diff --exit-code` (Task 10).

- [ ] **Step 1: Tests:** escaping (`Wi-Fi "Home" <5G>`), language order, every key present in all three (the existing parity test also covers it), a stable output order so the CI diff is quiet.
- [ ] **Step 2: Run** `npm test -w shared` → FAIL, implement, → PASS. Generate the header.
- [ ] **Commit point:** `shared/ firmware/src/generated/` — `Add setup portal strings`

### Task 7: Setup form and flow

**Files:**

- Create: `firmware/lib/core/setup.{h,cpp}`, `firmware/test/test_setup/`

**Interfaces:**

```cpp
std::string normalizePairingCode(const std::string&);      // same rules as the server
enum class SetupError { None, SsidRequired, PasswordTooLong, CodeFormat, CodeRequired };
struct SetupForm { std::string ssid, password, pairingCode; };
SetupError validateSetupForm(const SetupForm&, bool hasToken); // ssid 1–32 bytes, password 0 or 8–63, code 8 from the server alphabet
enum class SetupStatus { Idle, Connecting, WifiNotFound, WifiAuthFailed, WifiFailed, Claiming,
                         CodeInvalid, CodeExpired, ServerUnreachable, Done };
class SetupFlow {
 public:
  SetupFlow(bool hasToken);
  bool submit(const SetupForm&, uint64_t nowMs);  // false while Connecting/Claiming
  void onWifiConnected(); void onWifiFailed(uint16_t reason); void tick(uint64_t nowMs); // 30 s timeout
  void onClaimResult(int httpStatus, const std::optional<ClaimResult>&);
  SetupStatus status() const; bool shouldClaim() const; bool shouldSave() const;
  const std::optional<ClaimResult>& claim() const;
};
const char* setupStatusName(SetupStatus);   // "CONNECTING", … for the status endpoint
```

- [ ] **Step 1: Tests:**
  - `normalizePairingCode(" k7q2-m9 xd ")` → `"K7Q2M9XD"`; `0`, `O`, `1`, `I`, `L` → `CodeFormat`.
  - no token and empty code → `CodeRequired`; with a token, empty code → valid (Wi-Fi only).
  - Wi-Fi reasons: 201 (`NO_AP_FOUND`) → `WifiNotFound`; 202, 15, 204 (auth fail, 4-way handshake timeout, handshake timeout) → `WifiAuthFailed`; others → `WifiFailed`; no IP within 30 s → `WifiFailed`.
  - Wi-Fi connected with a code → `Claiming`; `200` with a valid body → `Done`, `shouldSave()`; `404` → `CodeInvalid`; `410` → `CodeExpired`; `-1`, `500`, `429`, `200` with a bad body → `ServerUnreachable`. **Review Focus 4:** none of these failures set `shouldSave()`. Resubmitting after a failure starts over.
  - Wi-Fi only (has token, no code) → `Done` after Wi-Fi connects, without claiming.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `firmware/lib/core/setup* firmware/test/test_setup/` — `Add setup form and flow`

### Task 8: Device runtime

**Files:**

- Create: `firmware/src/{clock,led,button,store,net,api,portal}.{h,cpp}`
- Modify: `firmware/src/main.cpp`
- Docs: `docs/DEVICE_STATUS.md` (rewrite for v2: decision 14 LEDs, serial lines below, setup mode, BOOT button)

**Interfaces** (glue only, no logic beyond wiring `core`):

- `store`: `Preferences` namespace `elec`. Keys `ssid`, `pass`, `token`, `dev_id`, `set_ver`, `ping_s`. `load() → StoredConfig`, `saveSetup(form, optional<ClaimResult>)` in one `begin`/`end`. No other writers.
- `net`: STA mode, auto-reconnect, `WiFi.setTxPower(WIFI_POWER_8_5dBm)`, a forced reconnect after 60 s down (v1 behaviour), Wi-Fi events → `WifiLog`, SNTP (`pool.ntp.org`, `time.google.com`) → `onLinkReady`.
- `api`: `postCheckIn(json) → { status, retryAfterS }` and `claim(code) → { status, optional<ClaimResult> }`. One `WiFiClientSecure` with `setCACert` from the embedded ISRG PEM (plain `WiFiClient` for `http://` overrides), `Authorization: Bearer`, 10 s timeouts. `status < 0` maps to `NetworkError`, which also calls `WifiLog::onApiFailure` when Wi-Fi is up.
- `portal`: `WebServer` + `DNSServer`. `GET /` (form, strings by language, Wi-Fi scan list), `POST /setup`, `GET /status` (JSON `{ status }`), captive probe paths (`/generate_204`, `/hotspot-detect.html`, `/connecttest.txt`, `/ncsi.txt`) → redirect to `/`. Drives `SetupFlow` and calls `store::saveSetup` and `ESP.restart()` 3 s after `Done`.
- `button`: GPIO 9, input pull-up, held ≥ 5 s → LED solid 1 s → setup mode.
- `main`: watchdog 60 s; boot log line; load config → setup mode or normal mode; normal mode runs `CheckInScheduler` with `BootSession(uuidV4(esp_random), mapResetReason(esp_reset_reason()), FW_VERSION)`; a `PING` takes `WifiLog::snapshot`, and on `204` calls `acknowledge` with the sent ids.
- Serial lines (log format for DEVICE_STATUS.md): `boot fw 2.0.0 reason POWER_ON id b738… ota key 1a2b…`, `wifi connected ip … rssi -61`, `wifi lost reason 201`, `time synced` / `time not synced`, `BOOT -> 204`, `BOOT -> -1, retry in 4 s`, `PING -> 204 (seq 42, events 2)`, `PING -> 429, retry in 30 s`, `PING -> 401, re-pair the device`, `setup mode ElecMonitor-3F2A (button|no config)`, `setup wifi -> WIFI_AUTH_FAILED`, `claim -> 404`, `setup done, restarting`, `heap free … min …` every 10 min.

- [ ] **Step 1:** implement. `pio run -e staging` and `-e production` build with no warnings under `-Wall`.
- [ ] **Step 2:** `pio test -e native` still passes. `firmware/src/` has no `if` that decides scheduling, retries, log records or setup state (reviewer check).
- [ ] **Step 3: Docs.** Rewrite DEVICE_STATUS.md. Note the 2.4 GHz-only Wi-Fi and how to enter setup mode.
- [ ] **Step 4 (manual, by the user):** flash a SuperMini with `pio run -e staging -t upload` (or a local override), then `pio device monitor`. Look for the boot line and the setup AP. The full list is at the end of this plan.
- [ ] **Commit point:** `firmware/src/ docs/DEVICE_STATUS.md` — `Add device runtime and setup portal`

### Task 9: Firmware storage on the server

**Files:**

- Create: `server/src/firmware/store.ts`, `server/src/firmware/store.test.ts`, `server/src/firmware/releases.ts`, `server/src/firmware/releases.test.ts`
- Modify: `server/src/config.ts`, `server/src/config.test.ts`, `server/src/http/app.ts` (`AppDeps.firmware`), `server/src/api.ts`, `server/test/app.ts`, `deploy/staging.env.example`
- Docs: `docs/PROJECT_V2.md` §12 Config (decision 16)

**Interfaces:**

```ts
type StoredFile = { body: ReadableStream<Uint8Array>; size: number };
interface FirmwareStore {
  get(path: string): Promise<StoredFile | null>;
  put(path: string, bytes: Uint8Array): Promise<void>;
}
supabaseStore(c: { url: string; secretKey: string; bucket: string }, fetchFn?: typeof fetch): FirmwareStore;
fsStore(dir: string): FirmwareStore;
memoryStore(): FirmwareStore & { files: Map<string, Uint8Array> };

versionCode(version: string): number;   // throws on non-plain semver or a part > 999
latestPublished(db: Executor): Promise<FirmwareReleaseRow | null>;            // STABLE, published, max version_code
findPublished(db: Executor, version: string): Promise<FirmwareReleaseRow | null>;
```

- [ ] **Step 1: Tests:**
  - `supabaseStore` with a fake `fetch`: `get` calls `GET {url}/storage/v1/object/firmware/2.0.0/factory.bin` with `Authorization: Bearer` and `apikey`, `404` → `null`, `5xx` → throws; `put` uses `POST` with `x-upsert: true` and `content-type: application/octet-stream`.
  - `fsStore` rejects `..` and absolute paths.
  - `versionCode('2.1.3')` → 2 001 003; `'2.1'`, `'0.0.0-dev'`, `'1.1000.0'` throw.
  - `latestPublished` ignores drafts and `BETA`, and picks by `version_code`, not text (`2.10.0` beats `2.9.0`).
  - config: `FIRMWARE_STORE=supabase` without `SUPABASE_URL` or `SUPABASE_SECRET_KEY` fails at startup; `fs` needs `FIRMWARE_DIR`.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Step 3: Docs** per the Files list. Add the keys to `staging.env.example`.
- [ ] **Commit point:** `server/src/firmware/ server/src/config* server/src/http/app.ts server/src/api.ts server/test/ deploy/ docs/` — `Add firmware storage`

### Task 10: CI and release workflow

**Files:**

- Modify: `.github/workflows/ci.yml` (job `firmware`)
- Create: `.github/workflows/firmware-release.yml`, `firmware/scripts/sign.sh`
- Docs: `firmware/README.md` (release steps), `docs/PROJECT_V2.md` §12 CI/CD

**Interfaces:**

- `firmware` CI job: `actions/setup-python`, `pip install platformio==<pinned>`, cache `~/.platformio` keyed on `platformio.ini`, `pio test -e native`, `pio run -e staging -e production`, `npm ci && npm run firmware:strings -w shared && git diff --exit-code firmware/src/generated`.
- `firmware-release.yml` on `push: tags: ['fw-v*']`, `permissions: contents: write`: `FW_VERSION` from the tag (fails if not plain semver). For each of `staging` and `production`: `pio run -e <env>`; `esptool.py --chip esp32c3 merge_bin -o factory.bin 0x0 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 firmware.bin` (offsets from the build, not hard-coded, if PlatformIO exposes them); `sign.sh` writes `app.sig` (DER) and `app.sha256`; `openssl dgst -sha256 -verify firmware/keys/ota-signing.pub.pem -signature app.sig app.bin` must pass. Assets are named `elec-fw-<version>-<env>-{app.bin,factory.bin,app.sig}`. `gh release create fw-v<version> --draft` with the assets.
- `sign.sh <app.bin>` reads the key from `$FIRMWARE_SIGNING_KEY` through a temp file with `umask 077`, removed on exit. It never echoes the key.

- [ ] **Step 1:** CI job; push a branch and confirm it's green.
- [ ] **Step 2:** release workflow and `sign.sh`; `shellcheck firmware/scripts/*.sh` added to the existing shellcheck step.
- [ ] **Step 3 (manual, by the user):** push tag `fw-v2.0.0-rc` → the workflow rejects it (not plain semver). Push `fw-v2.0.0` → a draft GitHub Release with six assets.
- [ ] **Commit point:** `.github/workflows/ firmware/scripts/ firmware/README.md docs/` — `Add firmware CI and release workflow`

### Task 11: Release script

**Files:**

- Create: `server/src/firmware/verify.ts`, `server/src/firmware/verify.test.ts`, `server/scripts/firmware-release.ts`, `server/scripts/firmware-release.test.ts`, `server/test/firmware.ts` (test key pair and image fixtures generated with `node:crypto` in the test)
- Modify: `server/package.json` (`"firmware:release": "tsx --conditions=source --env-file-if-exists=.env scripts/firmware-release.ts"`)

**Interfaces:**

```ts
type ReleaseFiles = { app: Uint8Array; factory: Uint8Array; signature: Uint8Array };
verifyRelease(files: ReleaseFiles, publicKeyPem: string): { sha256: Buffer } ; // throws a clear Error
releaseFirmware(deps: { db: Db; store: FirmwareStore; clock: Clock },
                a: { version: string; env: 'staging' | 'production'; files: ReleaseFiles; publicKeyPem: string; publish: boolean }):
  Promise<'CREATED' | 'PUBLISHED' | 'UNCHANGED'>;
```

- CLI: `npm run firmware:release -w server -- <dir> --version 2.0.0 --env staging [--publish]`. It reads `elec-fw-<version>-<env>-*` from `<dir>` (downloaded with `gh release download fw-v2.0.0 -D <dir>`) and the public key from `../firmware/keys/ota-signing.pub.pem`.

- [ ] **Step 1: Tests:**
  - `verifyRelease`: a valid set passes; a signature by another key, a flipped byte in `app.bin`, and a `factory.bin` whose bytes at `0x10000` differ from `app.bin` (**Review Focus 6**) each throw with a message naming the problem; a `factory.bin` shorter than `0x10000 + app.length` throws.
  - `releaseFirmware` (PGlite, `memoryStore`): new version → files at `2.0.0/app.bin` and `2.0.0/factory.bin`, row with `version_code`, `size_bytes`, `sha256`, `signature`, `image_path '2.0.0'`, `channel 'STABLE'`, `published_at null` → `CREATED`; again with `publish` → `published_at = now` → `PUBLISHED`; again → `UNCHANGED`; same version with a different `sha256` → throws, nothing uploaded; a version not above the highest existing `version_code` → throws; `0.0.0-dev` → throws.
  - Files are uploaded before the row is inserted, so a failed upload leaves no row.
- [ ] **Step 2: Run** → FAIL, implement, → PASS.
- [ ] **Commit point:** `server/src/firmware/verify* server/scripts/firmware-release* server/test/firmware.ts server/package.json` — `Add firmware release script`

### Task 12: Manifest and factory image endpoints

**Files:**

- Create: `server/src/http/firmware/firmware.ts`, `server/src/http/firmware/firmware.test.ts`
- Modify: `server/src/http/app.ts`, `server/src/http/rateLimit.ts` (`FIRMWARE_DOWNLOAD_PER_IP`)
- Docs: `docs/API.md` §4 Firmware (decision 15: manifest shape, new image endpoint, remove **(proposed)** from the manifest), §9 gap row

**Interfaces:**

- `firmwareRouter(deps)`, `firmwarePaths`, OpenAPI tag `Firmware` after `Outages`.
- `GET /api/v1/firmware/manifest.json` (no auth) → `200`:
  ```json
  {
    "name": "Electricity Monitor",
    "version": "2.0.0",
    "new_install_prompt_erase": true,
    "builds": [
      {
        "chipFamily": "ESP32-C3",
        "parts": [
          { "path": "https://api.<domain>/api/v1/firmware/images/2.0.0/factory.bin", "offset": 0 }
        ]
      }
    ]
  }
  ```
  `path` uses `config.urls.api`. `Cache-Control: no-store`. No release → `404 not_found`.
- `GET /api/v1/firmware/images/:version/factory.bin` (no auth, 20 / min per IP) → `200 application/octet-stream`, `Content-Length`, decision 15 caching, streamed from `store.get('<image_path>/factory.bin')`. Unknown, draft or malformed version → `404`. Store missing the file → `404`, logged as an error.

- [ ] **Step 1: Tests** (PGlite, `memoryStore`): manifest with two published releases and a newer draft → the newer published one; `BETA` ignored; no rows → `404`; headers. Image: bytes match the stored file; draft → `404`; `../x` → `400` or `404`, never a store call; CORS from the client origin allowed (ESP Web Tools fetches it from the browser); rate limit deny → `429`.
- [ ] **Step 2: Run** → FAIL, implement, → PASS. Update the OpenAPI snapshot.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/http/ docs/API.md` — `Add firmware manifest and image endpoints`

### Task 13: Flash firmware page

**Files:**

- Create: `client/src/pages/firmware/FlashPage.tsx`, `client/src/pages/firmware/FlashPage.test.tsx`
- Modify: `client/package.json` (`esp-web-tools`), `client/src/app/router.tsx` (`flash`), `client/src/pages/devices/AddDevicePage.tsx` (+ test), `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.flash.*`, `app.addDevice.flashLink`)
- Docs: `docs/PROJECT_V2.md` §9 Flash firmware (decision 17)

**Interfaces:**

- `FlashPage`: title, steps ("Plug the board in with a data USB cable", "Click Install and pick the serial port", "Then connect to the ElecMonitor-XXXX Wi-Fi from your phone"), and `<esp-web-install-button manifest={`${VITE_API_URL}/api/v1/firmware/manifest.json`}>` with the default slots replaced by translated `Button`s (`activate`, `unsupported`, `not-allowed`). `esp-web-tools` is imported dynamically in an effect. Without `'serial' in navigator` it shows `app.flash.unsupported` and doesn't load the module. Add a JSX type declaration for the custom element.
- The add-device pairing step gets a link to `/flash` with `target="_blank"` and `rel="noopener"`.

- [ ] **Step 1: Tests:** jsdom has no Web Serial → the unsupported message is shown and the module isn't imported (mock the dynamic import and assert it isn't called); with `navigator.serial` stubbed → the element is rendered with the right `manifest` attribute; the wizard shows the link and it opens in a new tab; i18n parity passes.
- [ ] **Step 2: Run** `npm test -w client` → FAIL, implement, → PASS. `npm run build -w client` passes, and the main chunk doesn't include `esp-web-tools`.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `client/ shared/src/i18n/ docs/PROJECT_V2.md` — `Add Flash firmware page`

### Task 14: Full check

- [ ] **Step 1:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` all exit 0. From `firmware/`: `pio test -e native` and `pio run -e staging -e production` exit 0.
- [ ] **Step 2:** OpenAPI test lists `get /api/v1/firmware/manifest.json` and `get /api/v1/firmware/images/{version}/factory.bin` with no security, under tag `Firmware`, and the tags end in `… Outages, Firmware`.
- [ ] **Commit point:** `server/src/http/openapi.test.ts` — `Cover firmware endpoints in OpenAPI test`

### Task 15: Roadmap

**Files:**

- Modify: `docs/ROADMAP.md`

- [ ] **Step 1:** Mark Q8, Q9 and Q10 ✅ (the decisions are in the spec since Task 1). The Q14 row gains "✅ M5: `GET /firmware/manifest.json`". Tick the merged M5 deliverables. Status board: M5 🟡 until the manual checks pass, then ✅.
- [ ] **Commit point:** `docs/ROADMAP.md` — `Update roadmap for M5`

**M5 done when (ROADMAP):** native tests cover the ring buffer, reset reason mapping, backoff, scheduler and setup flow, and CI builds both firmware environments. Verify by hand on a real ESP32-C3 SuperMini against staging:

- Release `fw-v2.0.0` → `npm run firmware:release -w server -- <dir> --version 2.0.0 --env staging --publish` → `https://staging-api.elec-monitoring.homes/api/v1/firmware/manifest.json` shows 2.0.0.
- In Chrome on a computer, **Flash firmware** → Install → the board boots, and the serial log shows the boot line with `fw 2.0.0`, the staging server and the OTA key fingerprint (compare with `openssl pkey -pubin -in firmware/keys/ota-signing.pub.pem -outform DER | shasum -a 256`). Safari or a phone shows the unsupported message.
- Phone joins `ElecMonitor-XXXX` → the setup page opens by itself on iOS and Android, in the phone's language.
- A wrong Wi-Fi password → `WIFI_AUTH_FAILED` on the page; an expired code → `CODE_EXPIRED`; then correct values → `DONE`, reboot, and the device goes `ONLINE` in the app with the wizard moving on.
- Hold BOOT 5 s → setup mode. Submit only new Wi-Fi (empty code) → back online with the same device. Hold BOOT and submit nothing → after 10 min it returns to normal.
- Unplug for 10 s and replug → one `POWER_BLIP` (or a `POWER` outage if longer than the offline timeout), `reset_reason POWER_ON`. Unplug for 5 min → OFF alert, then a recovery with cause `POWER`.
- Restart the router → a `WIFI` diagnostic and, if long, a `NETWORK` outage. Turn off only the Wi-Fi (keep the board powered) → the same.
- Block the API (stop the staging API for 3 min) → an `API` diagnostic after it returns, and no more than 6 requests a minute in the serial log.
- Cause more than 16 Wi-Fi interruptions (toggle the AP 20 times) → `GET …/diagnostics` shows the newest 16 and `boot_wifi_evicted` 4, with no duplicates after resends.
- Rotate the token in the app → `PING -> 401, re-pair the device` and the `UNAUTHORIZED` LED pattern, with check-ins every 5 min.
- `heap free … min …` lines stay steady over an hour with reconnects. Record the minimum.
- Note which reset reason a USB-powered replug reports (`POWER_ON` vs `USB`) and update decision rows if it's `Unknown`.
