#pragma once
#include <cstdint>

struct Random {
  virtual uint32_t next() = 0;
  virtual ~Random() = default;
};
