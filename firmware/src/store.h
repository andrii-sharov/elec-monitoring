#pragma once
#include <optional>
#include <string>

#include "settings.h"
#include "setup.h"

struct StoredConfig {
  std::string ssid;
  std::string password;
  std::string token;
  std::string deviceId;
  DeviceSettings settings;
};

namespace store {
StoredConfig load();
void saveSetup(const SetupForm& form, const std::optional<ClaimResult>& claim);
}  // namespace store
