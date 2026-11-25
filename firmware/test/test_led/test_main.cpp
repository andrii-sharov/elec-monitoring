#include <unity.h>

#include "led_pattern.h"

namespace {
void assertPattern(LedPattern expected, LedPattern actual) {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(expected), static_cast<int>(actual));
}

DeviceLedState normal() { return {false, true, false}; }
}  // namespace

void test_pattern_priority() {
  assertPattern(LedPattern::Idle, ledPatternFor(normal()));
  assertPattern(LedPattern::Setup, ledPatternFor({true, false, true}));
  assertPattern(LedPattern::Connecting, ledPatternFor({false, false, true}));
  assertPattern(LedPattern::Failed, ledPatternFor({false, true, true}));
}

void test_setup_blinks_at_1_hz() {
  TEST_ASSERT_TRUE(ledOn(LedPattern::Setup, 0));
  TEST_ASSERT_TRUE(ledOn(LedPattern::Setup, 499));
  TEST_ASSERT_FALSE(ledOn(LedPattern::Setup, 500));
  TEST_ASSERT_TRUE(ledOn(LedPattern::Setup, 1000));
}

void test_connecting_blinks_at_5_hz() {
  TEST_ASSERT_TRUE(ledOn(LedPattern::Connecting, 0));
  TEST_ASSERT_FALSE(ledOn(LedPattern::Connecting, 100));
  TEST_ASSERT_TRUE(ledOn(LedPattern::Connecting, 200));
}

void test_failed_and_held_are_solid() {
  TEST_ASSERT_TRUE(ledOn(LedPattern::Failed, 0));
  TEST_ASSERT_TRUE(ledOn(LedPattern::Failed, 12345));
  TEST_ASSERT_TRUE(ledOn(LedPattern::Held, 777));
}

void test_idle_is_off() {
  TEST_ASSERT_FALSE(ledOn(LedPattern::Idle, 0));
  TEST_ASSERT_FALSE(ledOn(LedPattern::Idle, 500));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_pattern_priority);
  RUN_TEST(test_setup_blinks_at_1_hz);
  RUN_TEST(test_connecting_blinks_at_5_hz);
  RUN_TEST(test_failed_and_held_are_solid);
  RUN_TEST(test_idle_is_off);
  return UNITY_END();
}
