#include "button.h"

#include <Arduino.h>

namespace button {
namespace {
constexpr uint8_t kPin = 9;
constexpr uint64_t kHoldMs = 5000;
uint64_t pressedAtMs = 0;
bool pressed = false;
bool fired = false;
}  // namespace

void begin() { pinMode(kPin, INPUT_PULLUP); }

bool heldLongEnough(uint64_t nowMs) {
  if (digitalRead(kPin) == HIGH) {
    pressed = false;
    fired = false;
    return false;
  }
  if (!pressed) {
    pressed = true;
    pressedAtMs = nowMs;
  }
  if (fired || nowMs - pressedAtMs < kHoldMs) return false;
  fired = true;
  return true;
}
}  // namespace button
