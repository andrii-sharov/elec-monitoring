#pragma once
#include <vector>

#include "random.h"

struct FixedRandom : Random {
  explicit FixedRandom(uint32_t value) : value(value) {}
  uint32_t next() override { return value; }
  uint32_t value;
};

struct SequenceRandom : Random {
  explicit SequenceRandom(std::vector<uint32_t> values) : values(std::move(values)) {}
  uint32_t next() override { return values[index++ % values.size()]; }
  std::vector<uint32_t> values;
  size_t index = 0;
};
