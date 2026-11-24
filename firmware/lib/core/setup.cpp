#include "setup.h"

#include <cctype>
#include <cstring>

namespace {
constexpr const char* kCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
constexpr size_t kCodeLength = 8;
constexpr uint64_t kWifiTimeoutMs = 30000;

bool isCode(const std::string& code) {
  if (code.size() != kCodeLength) return false;
  for (char c : code) {
    if (c == '\0' || std::strchr(kCodeAlphabet, c) == nullptr) return false;
  }
  return true;
}

SetupStatus wifiFailure(uint16_t reason) {
  switch (reason) {
    case 201:
      return SetupStatus::WifiNotFound;
    case 15:
    case 202:
    case 204:
      return SetupStatus::WifiAuthFailed;
    default:
      return SetupStatus::WifiFailed;
  }
}
}  // namespace

std::string normalizePairingCode(const std::string& code) {
  std::string out;
  for (char c : code) {
    if (c == '-' || std::isspace(static_cast<unsigned char>(c))) continue;
    out.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
  }
  return out;
}

SetupError validateSetupForm(const SetupForm& form, bool hasToken) {
  if (form.ssid.empty() || form.ssid.size() > 32) return SetupError::SsidRequired;
  size_t password = form.password.size();
  if (password != 0 && (password < 8 || password > 63)) return SetupError::PasswordTooLong;
  std::string code = normalizePairingCode(form.pairingCode);
  if (code.empty()) return hasToken ? SetupError::None : SetupError::CodeRequired;
  return isCode(code) ? SetupError::None : SetupError::CodeFormat;
}

SetupFlow::SetupFlow(bool hasToken) : hasToken_(hasToken) {}

bool SetupFlow::submit(const SetupForm& form, uint64_t nowMs) {
  if (status_ == SetupStatus::Connecting || status_ == SetupStatus::Claiming ||
      status_ == SetupStatus::Done) {
    return false;
  }
  if (validateSetupForm(form, hasToken_) != SetupError::None) return false;
  form_ = {form.ssid, form.password, normalizePairingCode(form.pairingCode)};
  claim_.reset();
  deadlineMs_ = nowMs + kWifiTimeoutMs;
  status_ = SetupStatus::Connecting;
  return true;
}

void SetupFlow::onWifiConnected() {
  if (status_ != SetupStatus::Connecting) return;
  status_ = form_.pairingCode.empty() ? SetupStatus::Done : SetupStatus::Claiming;
}

void SetupFlow::onWifiFailed(uint16_t reason) {
  if (status_ == SetupStatus::Connecting) status_ = wifiFailure(reason);
}

void SetupFlow::tick(uint64_t nowMs) {
  if (status_ == SetupStatus::Connecting && nowMs >= deadlineMs_) status_ = SetupStatus::WifiFailed;
}

void SetupFlow::onClaimResult(int httpStatus, const std::optional<ClaimResult>& result) {
  if (status_ != SetupStatus::Claiming) return;
  if (httpStatus == 200 && result) {
    claim_ = result;
    status_ = SetupStatus::Done;
  } else if (httpStatus == 404) {
    status_ = SetupStatus::CodeInvalid;
  } else if (httpStatus == 410) {
    status_ = SetupStatus::CodeExpired;
  } else {
    status_ = SetupStatus::ServerUnreachable;
  }
}

const char* setupStatusName(SetupStatus status) {
  switch (status) {
    case SetupStatus::Idle:
      return "IDLE";
    case SetupStatus::Connecting:
      return "CONNECTING";
    case SetupStatus::WifiNotFound:
      return "WIFI_NOT_FOUND";
    case SetupStatus::WifiAuthFailed:
      return "WIFI_AUTH_FAILED";
    case SetupStatus::WifiFailed:
      return "WIFI_FAILED";
    case SetupStatus::Claiming:
      return "CLAIMING";
    case SetupStatus::CodeInvalid:
      return "CODE_INVALID";
    case SetupStatus::CodeExpired:
      return "CODE_EXPIRED";
    case SetupStatus::ServerUnreachable:
      return "SERVER_UNREACHABLE";
    case SetupStatus::Done:
      break;
  }
  return "DONE";
}
