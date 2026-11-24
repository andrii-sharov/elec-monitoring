#pragma once
#include <cstdint>

namespace button {
void begin();
bool heldLongEnough(uint64_t nowMs);
}  // namespace button
