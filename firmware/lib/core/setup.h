#pragma once
#include <cstdint>
#include <optional>
#include <string>

#include "settings.h"

std::string normalizePairingCode(const std::string& code);

enum class SetupError { None, SsidRequired, PasswordTooLong, CodeFormat, CodeRequired };

struct SetupForm {
  std::string ssid;
  std::string password;
  std::string pairingCode;
};

SetupError validateSetupForm(const SetupForm& form, bool hasToken);

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

 private:
  bool hasToken_;
  SetupStatus status_ = SetupStatus::Idle;
  SetupForm form_;
  uint64_t deadlineMs_ = 0;
  std::optional<ClaimResult> claim_;
};

const char* setupStatusName(SetupStatus status);
