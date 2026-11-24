#include "scheduler.h"

#include <algorithm>

namespace {
constexpr uint32_t kBootBaseMs = 2000;
constexpr uint32_t kBootCapMs = 60000;
constexpr uint64_t kUnauthorizedMs = 300000;
constexpr uint32_t kMaxRetryAfterS = 600;
}  // namespace

CheckInScheduler::CheckInScheduler(uint32_t pingIntervalS, Random& random)
    : pingIntervalS_(pingIntervalS), backoff_(kBootBaseMs, kBootCapMs, random) {}

void CheckInScheduler::onLinkReady(uint64_t nowMs) {
  linkUp_ = true;
  nextAtMs_ = std::max(nowMs, holdUntilMs_);
}

void CheckInScheduler::onLinkLost(uint64_t) { linkUp_ = false; }

std::optional<Due> CheckInScheduler::due(uint64_t nowMs) const {
  if (!linkUp_ || nowMs < nextAtMs_) return std::nullopt;
  if (bootAcknowledged_) return Due{CheckInType::Ping, false};
  return Due{CheckInType::Boot, bootSent_};
}

void CheckInScheduler::onResult(CheckInType type, CheckInOutcome outcome,
                                std::optional<uint32_t> retryAfterS, uint64_t nowMs) {
  if (type == CheckInType::Boot) bootSent_ = true;
  holdUntilMs_ = nowMs;
  if (retryAfterS) holdUntilMs_ += uint64_t{std::min(*retryAfterS, kMaxRetryAfterS)} * 1000;

  switch (outcome) {
    case CheckInOutcome::Accepted:
    case CheckInOutcome::BadRequest:
      if (outcome == CheckInOutcome::Accepted) unauthorized_ = false;
      lastFailed_ = outcome == CheckInOutcome::BadRequest;
      if (type == CheckInType::Boot) bootAcknowledged_ = true;
      backoff_.reset();
      nextAtMs_ = nowMs + intervalMs();
      break;
    case CheckInOutcome::Unauthorized:
      unauthorized_ = true;
      lastFailed_ = true;
      holdUntilMs_ = std::max(holdUntilMs_, nowMs + kUnauthorizedMs);
      nextAtMs_ = holdUntilMs_;
      break;
    case CheckInOutcome::RateLimited:
    case CheckInOutcome::ServerError:
    case CheckInOutcome::NetworkError:
      lastFailed_ = true;
      if (bootAcknowledged_) {
        nextAtMs_ = std::max(nowMs + intervalMs(), holdUntilMs_);
      } else {
        nextAtMs_ = nowMs + backoff_.nextDelayMs(retryAfterS);
      }
      break;
  }
}

uint64_t CheckInScheduler::intervalMs() const { return uint64_t{pingIntervalS_} * 1000; }
