#include "store.h"

#include <Preferences.h>

namespace store {
namespace {
constexpr const char* kNamespace = "elec";
constexpr uint32_t kDefaultPingS = 30;
}  // namespace

StoredConfig load() {
  StoredConfig config{{}, {}, {}, {}, {0, kDefaultPingS}};
  Preferences prefs;
  if (!prefs.begin(kNamespace, true)) return config;
  config.ssid = prefs.getString("ssid", "").c_str();
  config.password = prefs.getString("pass", "").c_str();
  config.token = prefs.getString("token", "").c_str();
  config.deviceId = prefs.getString("dev_id", "").c_str();
  config.settings = clampSettings({prefs.getUInt("set_ver", 0), prefs.getUInt("ping_s", kDefaultPingS)});
  prefs.end();
  return config;
}

void saveSetup(const SetupForm& form, const std::optional<ClaimResult>& claim) {
  Preferences prefs;
  prefs.begin(kNamespace, false);
  prefs.putString("ssid", form.ssid.c_str());
  prefs.putString("pass", form.password.c_str());
  if (claim) {
    prefs.putString("token", claim->token.c_str());
    prefs.putString("dev_id", claim->deviceId.c_str());
    prefs.putUInt("set_ver", claim->settings.version);
    prefs.putUInt("ping_s", claim->settings.pingIntervalS);
  }
  prefs.end();
}
}  // namespace store
