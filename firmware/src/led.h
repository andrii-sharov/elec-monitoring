#pragma once
#include <cstdint>

#include "led_pattern.h"

namespace led {
void begin();
void flash(uint64_t nowMs);
void show(LedPattern pattern, uint64_t nowMs);
}  // namespace led
