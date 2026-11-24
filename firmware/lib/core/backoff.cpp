#include "backoff.h"

#include <algorithm>

namespace {
constexpr uint32_t kMaxRetryAfterS = 600;
}

Backoff::Backoff(uint32_t baseMs, uint32_t capMs, Random& random)
    : baseMs_(baseMs), capMs_(capMs), random_(random) {}

uint32_t Backoff::nextDelayMs(std::optional<uint32_t> retryAfterS) {
  uint64_t ceiling = static_cast<uint64_t>(baseMs_) << std::min<uint32_t>(attempt_, 31);
  uint32_t delay = static_cast<uint32_t>(std::min<uint64_t>(ceiling, capMs_));
  if (attempt_ < 32) attempt_++;

  uint32_t half = delay / 2;
  uint32_t span = delay - half;
  uint32_t jittered = half + static_cast<uint32_t>(
                                 (static_cast<uint64_t>(random_.next()) * span) / UINT32_MAX);

  if (!retryAfterS) return jittered;
  uint32_t serverMs = std::min(*retryAfterS, kMaxRetryAfterS) * 1000;
  return std::max(jittered, serverMs);
}

void Backoff::reset() { attempt_ = 0; }

std::optional<uint32_t> parseRetryAfter(const char* header) {
  if (header == nullptr) return std::nullopt;
  const char* p = header;
  while (*p == ' ') p++;
  if (*p < '0' || *p > '9') return std::nullopt;
  uint64_t value = 0;
  while (*p >= '0' && *p <= '9') {
    value = value * 10 + static_cast<uint64_t>(*p - '0');
    if (value > UINT32_MAX) return std::nullopt;
    p++;
  }
  while (*p == ' ') p++;
  if (*p != '\0') return std::nullopt;
  return static_cast<uint32_t>(value);
}
