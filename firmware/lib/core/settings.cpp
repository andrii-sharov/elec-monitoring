#include "settings.h"

#include <ArduinoJson.h>

namespace {
constexpr uint32_t kMinPingS = 5;
constexpr uint32_t kMaxPingS = 600;
constexpr uint32_t kDefaultPingS = 20;

bool isDeviceToken(const char* token) {
  if (token == nullptr) return false;
  size_t length = 0;
  for (const char* p = token; *p; p++, length++) {
    bool hex = (*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f');
    if (!hex) return false;
  }
  return length == 64;
}
}  // namespace

DeviceSettings clampSettings(DeviceSettings settings) {
  if (settings.pingIntervalS < kMinPingS || settings.pingIntervalS > kMaxPingS) {
    settings.pingIntervalS = kDefaultPingS;
  }
  return settings;
}

std::optional<ClaimResult> parseClaimResponse(const char* json) {
  if (json == nullptr) return std::nullopt;
  JsonDocument doc;
  if (deserializeJson(doc, json)) return std::nullopt;

  const char* deviceId = doc["device_id"];
  const char* token = doc["device_token"];
  JsonVariantConst settings = doc["settings"];
  if (deviceId == nullptr || *deviceId == '\0' || !isDeviceToken(token)) return std::nullopt;
  if (!settings["version"].is<uint32_t>() || !settings["ping_interval_s"].is<uint32_t>()) {
    return std::nullopt;
  }

  DeviceSettings parsed{settings["version"], settings["ping_interval_s"]};
  return ClaimResult{deviceId, token, clampSettings(parsed)};
}
