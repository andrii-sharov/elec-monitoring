#pragma once
#include <cstdint>
#include <optional>
#include <string>

#include "settings.h"

bool setupRequired(bool hasWifi, bool hasToken);

enum class SetupReason { NoConfig, Button, TokenRejected };

struct SetupMode {
  bool keepToken;
  bool idleExit;
};

SetupMode setupModeFor(SetupReason reason, bool hasStoredToken);
const char* setupReasonName(SetupReason reason);
std::string normalizePairingCode(const std::string& code);

enum class SetupError { None, SsidRequired, PasswordTooLong, CodeFormat, CodeRequired };

struct SetupForm {
  std::string ssid;
  std::string password;
  std::string pairingCode;
};

SetupError validateSetupForm(const SetupForm& form, bool hasToken);
const char* setupErrorName(SetupError error);

enum class SetupStatus {
  Idle,
  Connecting,
  WifiNotFound,
  WifiAuthFailed,
  WifiFailed,
  Claiming,
  CodeInvalid,
  CodeExpired,
  ServerUnreachable,
  Done
};

class SetupFlow {
 public:
  explicit SetupFlow(bool hasToken);
  bool submit(const SetupForm& form, uint64_t nowMs);
  void onWifiConnected();
  void onWifiFailed(uint16_t reason);
  void tick(uint64_t nowMs);
  void onClaimResult(int httpStatus, const std::optional<ClaimResult>& result);
  SetupStatus status() const { return status_; }
  bool shouldClaim() const { return status_ == SetupStatus::Claiming; }
  bool shouldSave() const { return status_ == SetupStatus::Done; }
  const SetupForm& form() const { return form_; }
  const std::optional<ClaimResult>& claim() const { return claim_; }
  bool takeWifiRetry();
  uint16_t lastWifiReason() const { return lastWifiReason_; }
  void enableIdleExit(uint64_t nowMs);
  bool shouldExit(uint64_t nowMs) const;

 private:
  bool hasToken_;
  SetupStatus status_ = SetupStatus::Idle;
  SetupForm form_;
  uint64_t deadlineMs_ = 0;
  std::optional<ClaimResult> claim_;
  uint8_t wifiFailures_ = 0;
  uint16_t lastWifiReason_ = 0;
  bool wifiRetry_ = false;
  bool idleExit_ = false;
  uint64_t lastActivityMs_ = 0;
};

const char* setupStatusName(SetupStatus status);

constexpr const char* kPortalLanguageCodes[3] = {"uk", "en", "ru"};
size_t pickLanguage(const std::string& query, const std::string& acceptLanguage);
