#include <unity.h>

#include <initializer_list>

#include "reset_reason.h"

namespace {
constexpr int kUnknown = 0, kPowerOn = 1, kExt = 2, kSw = 3, kPanic = 4, kIntWdt = 5,
              kTaskWdt = 6, kWdt = 7, kDeepSleep = 8, kBrownout = 9, kSdio = 10, kUsb = 11,
              kJtag = 12, kEfuse = 13, kPwrGlitch = 14, kCpuLockup = 15;

void assertReason(ResetReason expected, int raw) {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(expected), static_cast<int>(mapResetReason(raw)));
}
}  // namespace

void test_power_on() { assertReason(ResetReason::PowerOn, kPowerOn); }
void test_brownout() { assertReason(ResetReason::Brownout, kBrownout); }
void test_software() { assertReason(ResetReason::Software, kSw); }
void test_panic() { assertReason(ResetReason::Panic, kPanic); }

void test_watchdogs() {
  assertReason(ResetReason::Watchdog, kIntWdt);
  assertReason(ResetReason::Watchdog, kTaskWdt);
  assertReason(ResetReason::Watchdog, kWdt);
}

void test_everything_else_is_unknown() {
  for (int raw : {kExt, kDeepSleep, kSdio, kUsb, kJtag, kEfuse, kPwrGlitch, kCpuLockup, kUnknown,
                  999, -1}) {
    assertReason(ResetReason::Unknown, raw);
  }
}

void test_names_match_api() {
  TEST_ASSERT_EQUAL_STRING("POWER_ON", resetReasonName(ResetReason::PowerOn));
  TEST_ASSERT_EQUAL_STRING("BROWNOUT", resetReasonName(ResetReason::Brownout));
  TEST_ASSERT_EQUAL_STRING("SOFTWARE", resetReasonName(ResetReason::Software));
  TEST_ASSERT_EQUAL_STRING("WATCHDOG", resetReasonName(ResetReason::Watchdog));
  TEST_ASSERT_EQUAL_STRING("PANIC", resetReasonName(ResetReason::Panic));
  TEST_ASSERT_EQUAL_STRING("UNKNOWN", resetReasonName(ResetReason::Unknown));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_power_on);
  RUN_TEST(test_brownout);
  RUN_TEST(test_software);
  RUN_TEST(test_panic);
  RUN_TEST(test_watchdogs);
  RUN_TEST(test_everything_else_is_unknown);
  RUN_TEST(test_names_match_api);
  return UNITY_END();
}
