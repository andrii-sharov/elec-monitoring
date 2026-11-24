#include "setup.h"

#include <cctype>
#include <cstring>

namespace {
constexpr const char* kCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
constexpr size_t kCodeLength = 8;
constexpr uint64_t kWifiTimeoutMs = 30000;
constexpr uint64_t kIdleExitMs = 600000;
constexpr uint16_t kReasonAssocLeave = 8;
constexpr uint8_t kNotFoundAttempts = 2;
constexpr uint8_t kOtherAttempts = 3;

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

bool setupRequired(bool hasWifi, bool hasToken) { return !hasWifi || !hasToken; }

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

const char* setupErrorName(SetupError error) {
  switch (error) {
    case SetupError::SsidRequired:
      return "SSID_REQUIRED";
    case SetupError::PasswordTooLong:
      return "PASSWORD_TOO_LONG";
    case SetupError::CodeFormat:
      return "CODE_FORMAT";
    case SetupError::CodeRequired:
      return "CODE_REQUIRED";
    case SetupError::None:
      break;
  }
  return "NONE";
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
  wifiFailures_ = 0;
  lastWifiReason_ = 0;
  wifiRetry_ = false;
  deadlineMs_ = nowMs + kWifiTimeoutMs;
  lastActivityMs_ = nowMs;
  status_ = SetupStatus::Connecting;
  return true;
}

void SetupFlow::onWifiConnected() {
  if (status_ != SetupStatus::Connecting) return;
  status_ = form_.pairingCode.empty() ? SetupStatus::Done : SetupStatus::Claiming;
}

void SetupFlow::onWifiFailed(uint16_t reason) {
  if (reason == kReasonAssocLeave || status_ != SetupStatus::Connecting) return;
  lastWifiReason_ = reason;
  wifiFailures_++;
  SetupStatus failure = wifiFailure(reason);
  uint8_t attempts = failure == SetupStatus::WifiNotFound ? kNotFoundAttempts : kOtherAttempts;
  if (wifiFailures_ >= attempts) {
    status_ = failure;
    wifiRetry_ = false;
  } else {
    wifiRetry_ = true;
  }
}

void SetupFlow::tick(uint64_t nowMs) {
  if (status_ != SetupStatus::Connecting || nowMs < deadlineMs_) return;
  status_ = wifiFailures_ > 0 ? wifiFailure(lastWifiReason_) : SetupStatus::WifiFailed;
  wifiRetry_ = false;
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

bool SetupFlow::takeWifiRetry() {
  bool retry = wifiRetry_ && status_ == SetupStatus::Connecting;
  wifiRetry_ = false;
  return retry;
}

void SetupFlow::enableIdleExit(uint64_t nowMs) {
  idleExit_ = true;
  lastActivityMs_ = nowMs;
}

bool SetupFlow::shouldExit(uint64_t nowMs) const {
  if (!idleExit_) return false;
  if (status_ == SetupStatus::Connecting || status_ == SetupStatus::Claiming ||
      status_ == SetupStatus::Done) {
    return false;
  }
  return nowMs - lastActivityMs_ >= kIdleExitMs;
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

namespace {
std::optional<size_t> languageIndex(std::string tag) {
  for (char& c : tag) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  for (size_t i = 0; i < 3; i++) {
    if (tag == kPortalLanguageCodes[i]) return i;
  }
  return std::nullopt;
}
}  // namespace

size_t pickLanguage(const std::string& query, const std::string& acceptLanguage) {
  if (auto index = languageIndex(query)) return *index;
  size_t start = 0;
  while (start <= acceptLanguage.size()) {
    size_t end = acceptLanguage.find(',', start);
    if (end == std::string::npos) end = acceptLanguage.size();
    std::string item = acceptLanguage.substr(start, end - start);
    size_t first = item.find_first_not_of(' ');
    item = first == std::string::npos ? "" : item.substr(first);
    item = item.substr(0, item.find_first_of(";- "));
    if (auto index = languageIndex(item)) return *index;
    start = end + 1;
  }
  return 0;
}
