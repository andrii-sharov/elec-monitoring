#pragma once
#include <cstdint>

#include "setup.h"
#include "store.h"

namespace portal {
void begin(const StoredConfig& config, SetupReason reason, uint64_t nowMs);
void loop(uint64_t nowMs);
}  // namespace portal
