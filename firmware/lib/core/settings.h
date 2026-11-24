#pragma once
#include <cstdint>
#include <optional>
#include <string>

struct DeviceSettings {
  uint32_t version;
  uint32_t pingIntervalS;
};

struct ClaimResult {
  std::string deviceId;
  std::string token;
  DeviceSettings settings;
};

std::optional<ClaimResult> parseClaimResponse(const char* json);
DeviceSettings clampSettings(DeviceSettings settings);
