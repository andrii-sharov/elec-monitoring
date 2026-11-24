#include "led.h"

#include <Arduino.h>

namespace led {
namespace {
constexpr uint8_t kPin = 8;
constexpr uint64_t kFlashMs = 100;
uint64_t flashUntilMs = 0;

void write(bool on) { digitalWrite(kPin, on ? LOW : HIGH); }
}  // namespace

void begin() {
  pinMode(kPin, OUTPUT);
  write(false);
}

void flash(uint64_t nowMs) { flashUntilMs = nowMs + kFlashMs; }

void show(LedPattern pattern, uint64_t nowMs) {
  write(ledOn(pattern, nowMs) || (pattern == LedPattern::Idle && nowMs < flashUntilMs));
}
}  // namespace led
