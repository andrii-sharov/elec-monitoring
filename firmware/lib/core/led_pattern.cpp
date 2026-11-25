#include "led_pattern.h"

LedPattern ledPatternFor(const DeviceLedState& state) {
  if (state.setupMode) return LedPattern::Setup;
  if (!state.wifiUp) return LedPattern::Connecting;
  if (state.lastFailed) return LedPattern::Failed;
  return LedPattern::Idle;
}

bool ledOn(LedPattern pattern, uint64_t nowMs) {
  switch (pattern) {
    case LedPattern::Setup:
      return nowMs % 1000 < 500;
    case LedPattern::Connecting:
      return nowMs % 200 < 100;
    case LedPattern::Failed:
    case LedPattern::Held:
      return true;
    case LedPattern::Idle:
      break;
  }
  return false;
}
