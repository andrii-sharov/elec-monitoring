#pragma once
#include <cstdint>

enum class LedPattern { Idle, Setup, Connecting, Failed, Held };

struct DeviceLedState {
  bool setupMode;
  bool wifiUp;
  bool lastFailed;
};

LedPattern ledPatternFor(const DeviceLedState& state);
bool ledOn(LedPattern pattern, uint64_t nowMs);
