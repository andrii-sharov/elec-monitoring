#pragma once
#include <cstdint>
#include <optional>

#include "backoff.h"
#include "checkin.h"
#include "random.h"

enum class CheckInOutcome { Accepted, RateLimited, Unauthorized, BadRequest, ServerError, NetworkError };

CheckInOutcome outcomeForStatus(int httpStatus);

struct Due {
  CheckInType type;
  bool retry;
};

class CheckInScheduler {
 public:
  CheckInScheduler(uint32_t pingIntervalS, Random& random);
  void onLinkReady(uint64_t nowMs);
  void onLinkLost(uint64_t nowMs);
  std::optional<Due> due(uint64_t nowMs) const;
  void onResult(CheckInType type, CheckInOutcome outcome, std::optional<uint32_t> retryAfterS,
                uint64_t nowMs);
  bool bootAcknowledged() const { return bootAcknowledged_; }
  bool unauthorized() const { return unauthorized_; }
  bool lastFailed() const { return lastFailed_; }
  uint64_t nextAtMs() const { return nextAtMs_; }

 private:
  uint64_t intervalMs() const;

  uint32_t pingIntervalS_;
  Backoff backoff_;
  bool linkUp_ = false;
  bool bootSent_ = false;
  bool bootAcknowledged_ = false;
  bool unauthorized_ = false;
  bool lastFailed_ = false;
  uint64_t nextAtMs_ = 0;
  uint64_t holdUntilMs_ = 0;
};
