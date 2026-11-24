#include "led_pattern.h"

LedPattern ledPatternFor(const DeviceLedState& state) {
  if (state.setupMode) return LedPattern::Setup;
  if (!state.wifiUp) return LedPattern::Connecting;
  if (state.unauthorized) return LedPattern::Unauthorized;
  if (state.lastFailed) return LedPattern::Failed;
  return LedPattern::Idle;
}

bool ledOn(LedPattern pattern, uint64_t nowMs) {
  switch (pattern) {
    case LedPattern::Setup:
      return nowMs % 1000 < 500;
    case LedPattern::Connecting:
      return nowMs % 200 < 100;
    case LedPattern::Unauthorized: {
      uint64_t phase = nowMs % 2000;
      return phase < 100 || (phase >= 300 && phase < 400);
    }
    case LedPattern::Failed:
    case LedPattern::Held:
      return true;
    case LedPattern::Idle:
      break;
  }
  return false;
}
