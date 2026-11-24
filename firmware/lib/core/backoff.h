#pragma once
#include <cstdint>
#include <optional>

#include "random.h"

class Backoff {
 public:
  Backoff(uint32_t baseMs, uint32_t capMs, Random& random);
  uint32_t nextDelayMs(std::optional<uint32_t> retryAfterS);
  void reset();

 private:
  uint32_t baseMs_;
  uint32_t capMs_;
  Random& random_;
  uint32_t attempt_ = 0;
};

std::optional<uint32_t> parseRetryAfter(const char* header);
