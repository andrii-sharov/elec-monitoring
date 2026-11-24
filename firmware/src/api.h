#pragma once
#include <optional>
#include <string>

#include "settings.h"

namespace api {
struct Response {
  int status;
  std::optional<uint32_t> retryAfterS;
};

struct ClaimResponse {
  int status;
  std::optional<ClaimResult> result;
};

Response postCheckIn(const std::string& json, const std::string& token);
ClaimResponse claim(const std::string& pairingCode);
}  // namespace api
