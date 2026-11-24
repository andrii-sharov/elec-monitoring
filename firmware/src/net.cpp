#include "net.h"

#include <WiFi.h>
#include <algorithm>
#include <esp_mac.h>
#include <freertos/queue.h>
#include <time.h>

namespace net {
namespace {
constexpr uint64_t kTimeSyncWaitMs = 30000;
constexpr uint64_t kForcedReconnectMs = 60000;
constexpr time_t kSyncedEpoch = 1700000000;
constexpr size_t kMaxScan = 20;

struct RawEvent {
  bool gotIp;
  uint16_t reason;
};

QueueHandle_t queue = nullptr;
bool up = false;
bool ready = false;
bool stationMode = false;
uint64_t ipAtMs = 0;
uint64_t downSinceMs = 0;

void onWifiEvent(arduino_event_id_t id, arduino_event_info_t info) {
  RawEvent raw{};
  if (id == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    raw.gotIp = true;
  } else if (id == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    raw.reason = info.wifi_sta_disconnected.reason;
  } else {
    return;
  }
  xQueueSend(queue, &raw, 0);
}

void init() {
  if (queue != nullptr) return;
  queue = xQueueCreate(16, sizeof(RawEvent));
  WiFi.onEvent(onWifiEvent);
}

void startSntp() {
  static bool started = false;
  if (started) return;
  started = true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}
}  // namespace

void beginStation(const std::string& ssid, const std::string& password) {
  init();
  stationMode = true;
  WiFi.mode(WIFI_STA);
  startSntp();
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), password.empty() ? nullptr : password.c_str());
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
}

void beginAccessPoint(const std::string& name) {
  init();
  stationMode = false;
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);
  WiFi.mode(WIFI_AP_STA);
  startSntp();
  WiFi.softAP(name.c_str());
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
}

void connectFromSetup(const std::string& ssid, const std::string& password) {
  WiFi.disconnect(false, false);
  WiFi.begin(ssid.c_str(), password.empty() ? nullptr : password.c_str());
}

void stopStation() { WiFi.disconnect(false, false); }

void discardEvents() {
  RawEvent raw;
  while (queue != nullptr && xQueueReceive(queue, &raw, 0) == pdTRUE) {
  }
  up = false;
  ready = false;
}

std::vector<Event> poll(uint64_t nowMs) {
  std::vector<Event> events;
  RawEvent raw;
  while (queue != nullptr && xQueueReceive(queue, &raw, 0) == pdTRUE) {
    if (raw.gotIp) {
      up = true;
      ready = false;
      ipAtMs = nowMs;
      Serial.printf("wifi connected ip %s rssi %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      events.push_back({EventKind::GotIp, 0});
      continue;
    }
    if (up) {
      Serial.printf("wifi lost reason %u\n", raw.reason);
      downSinceMs = nowMs;
    }
    bool wasReady = ready;
    up = false;
    ready = false;
    events.push_back({EventKind::Disconnected, raw.reason});
    if (wasReady) events.push_back({EventKind::LinkLost, 0});
  }

  if (up && !ready) {
    bool synced = time(nullptr) > kSyncedEpoch;
    if (synced || nowMs - ipAtMs >= kTimeSyncWaitMs) {
      ready = true;
      Serial.println(synced ? "time synced" : "time not synced");
      events.push_back({EventKind::LinkReady, 0});
    }
  }

  if (stationMode && !up && nowMs - downSinceMs >= kForcedReconnectMs) {
    downSinceMs = nowMs;
    Serial.println("wifi down for 60 s, reconnecting");
    WiFi.reconnect();
  }
  return events;
}

bool wifiUp() { return up; }
bool linkReady() { return ready; }
int8_t rssi() { return static_cast<int8_t>(WiFi.RSSI()); }

std::string apName() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char name[20];
  snprintf(name, sizeof(name), "ElecMonitor-%02X%02X", mac[4], mac[5]);
  return name;
}

std::vector<std::string> scan() {
  std::vector<std::string> ssids;
  int found = WiFi.scanNetworks();
  for (int i = 0; i < found && ssids.size() < kMaxScan; i++) {
    std::string ssid = WiFi.SSID(i).c_str();
    if (ssid.empty()) continue;
    if (std::find(ssids.begin(), ssids.end(), ssid) == ssids.end()) ssids.push_back(ssid);
  }
  WiFi.scanDelete();
  return ssids;
}
}  // namespace net
