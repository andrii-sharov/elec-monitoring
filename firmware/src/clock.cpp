#include "clock.h"

#include <esp_timer.h>

namespace devclock {
uint64_t nowMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }
}  // namespace devclock
