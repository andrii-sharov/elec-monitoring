#pragma once
#include <cstdint>

#include "store.h"

namespace portal {
void begin(const StoredConfig& config, bool byButton, uint64_t nowMs);
void loop(uint64_t nowMs);
}  // namespace portal
