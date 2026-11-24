#include <Arduino.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

#include <optional>

#include "api.h"
#include "button.h"
#include "checkin_client.h"
#include "clock.h"
#include "led.h"
#include "net.h"
#include "portal.h"
#include "reset_reason.h"
#include "setup.h"
#include "store.h"
#include "uuid.h"

extern const char otaKeyPem[] asm("_binary_keys_ota_signing_pub_pem_start");

namespace {
constexpr uint32_t kWatchdogMs = 60000;
constexpr uint64_t kHeldLedMs = 1000;
constexpr uint64_t kHeapLogMs = 600000;
constexpr uint32_t kLoopDelayMs = 20;

struct EspRandom : Random {
  uint32_t next() override { return esp_random(); }
};

EspRandom espRandom;
StoredConfig config;
WifiLog wifiLog;
std::optional<BootSession> session;
std::optional<CheckInScheduler> scheduler;
std::optional<CheckInClient> client;
bool setupMode = false;
uint64_t lastHeapLogMs = 0;

String otaKeyFingerprint() {
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  String out = "invalid";
  if (mbedtls_pk_parse_public_key(&pk, reinterpret_cast<const unsigned char*>(otaKeyPem),
                                  strlen(otaKeyPem) + 1) == 0) {
    unsigned char der[200];
    int len = mbedtls_pk_write_pubkey_der(&pk, der, sizeof(der));
    if (len > 0) {
      unsigned char hash[32];
      mbedtls_sha256(der + sizeof(der) - len, len, hash, 0);
      char hex[17];
      for (int i = 0; i < 8; i++) snprintf(hex + i * 2, 3, "%02x", hash[i]);
      out = hex;
    }
  }
  mbedtls_pk_free(&pk);
  return out;
}

void startWatchdog() {
  esp_task_wdt_config_t wdt = {
      .timeout_ms = kWatchdogMs,
      .idle_core_mask = 0,
      .trigger_panic = true,
  };
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
  esp_task_wdt_add(nullptr);
}

void enterSetup(bool byButton, uint64_t nowMs) {
  setupMode = true;
  wifiLog.setPlanned(true);
  portal::begin(config, byButton, nowMs);
}

void logCheckIn(const PreparedCheckIn& sent, const api::Response& response,
                CheckInOutcome outcome) {
  const char* type = sent.type == CheckInType::Boot ? "BOOT" : "PING";
  if (outcome == CheckInOutcome::Accepted) {
    if (sent.type == CheckInType::Boot) {
      Serial.printf("%s -> %d\n", type, response.status);
    } else {
      Serial.printf("%s -> %d (seq %u, events %u)\n", type, response.status,
                    static_cast<unsigned>(sent.seq), static_cast<unsigned>(sent.eventIds.size()));
    }
  } else if (outcome == CheckInOutcome::Unauthorized) {
    Serial.printf("%s -> %d, re-pair the device\n", type, response.status);
  } else {
    uint64_t waitMs = scheduler->nextAtMs() - devclock::nowMs();
    Serial.printf("%s -> %d, retry in %u s\n", type, response.status,
                  static_cast<unsigned>((waitMs + 999) / 1000));
  }
}

void runCheckIns(uint64_t nowMs) {
  uint32_t uptimeS = static_cast<uint32_t>(nowMs / 1000);
  for (const net::Event& event : net::poll(nowMs)) {
    switch (event.kind) {
      case net::EventKind::GotIp:
        wifiLog.onGotIp(uptimeS);
        break;
      case net::EventKind::Disconnected:
        wifiLog.onDisconnected(uptimeS, event.reason);
        break;
      case net::EventKind::LinkReady:
        scheduler->onLinkReady(nowMs);
        break;
      case net::EventKind::LinkLost:
        scheduler->onLinkLost(nowMs);
        break;
    }
  }

  std::optional<PreparedCheckIn> prepared =
      client->prepare(nowMs, net::rssi(), config.settings.version);
  if (!prepared) return;
  api::Response response = api::postCheckIn(prepared->json, config.token);
  uint64_t doneMs = devclock::nowMs();
  CheckInOutcome outcome =
      client->complete(*prepared, response.status, response.retryAfterS, doneMs, net::wifiUp());
  logCheckIn(*prepared, response, outcome);
  if (outcome == CheckInOutcome::Accepted) led::flash(doneMs);
}

void logHeap(uint64_t nowMs) {
  if (nowMs - lastHeapLogMs < kHeapLogMs) return;
  lastHeapLogMs = nowMs;
  Serial.printf("heap free %u min %u\n", static_cast<unsigned>(ESP.getFreeHeap()),
                static_cast<unsigned>(ESP.getMinFreeHeap()));
}
}  // namespace

void setup() {
  Serial.begin(115200);
  led::begin();
  button::begin();
  startWatchdog();

  config = store::load();
  ResetReason reason = mapResetReason(esp_reset_reason());
  if (setupRequired(!config.ssid.empty(), !config.token.empty())) {
    Serial.printf("boot fw %s server %s reason %s ota key %s\n", FW_VERSION, SERVER_URL,
                  resetReasonName(reason), otaKeyFingerprint().c_str());
    enterSetup(false, devclock::nowMs());
    return;
  }

  net::beginStation(config.ssid, config.password);
  session.emplace(uuidV4(espRandom), reason, FW_VERSION);
  scheduler.emplace(config.settings.pingIntervalS, espRandom);
  client.emplace(*session, *scheduler, wifiLog);
  Serial.printf("boot fw %s server %s reason %s id %s ota key %s\n", FW_VERSION, SERVER_URL,
                resetReasonName(reason), session->bootId().c_str(), otaKeyFingerprint().c_str());
}

void loop() {
  esp_task_wdt_reset();
  uint64_t nowMs = devclock::nowMs();
  logHeap(nowMs);

  if (setupMode) {
    portal::loop(nowMs);
    delay(kLoopDelayMs);
    return;
  }

  if (button::heldLongEnough(nowMs)) {
    led::show(LedPattern::Held, nowMs);
    delay(kHeldLedMs);
    enterSetup(true, devclock::nowMs());
    return;
  }

  runCheckIns(nowMs);
  led::show(ledPatternFor({false, net::wifiUp(), scheduler->unauthorized(), scheduler->lastFailed()}),
            nowMs);
  delay(kLoopDelayMs);
}
