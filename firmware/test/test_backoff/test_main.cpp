#include <unity.h>

#include "../support/fake_random.h"
#include "backoff.h"

void test_doubles_to_cap_at_max_jitter() {
  FixedRandom random(0xffffffff);
  Backoff backoff(2000, 60000, random);
  uint32_t expected[] = {2000, 4000, 8000, 16000, 32000, 60000, 60000};
  for (uint32_t ms : expected) TEST_ASSERT_EQUAL_UINT32(ms, backoff.nextDelayMs(std::nullopt));
}

void test_min_jitter_is_half() {
  FixedRandom random(0);
  Backoff backoff(2000, 60000, random);
  uint32_t expected[] = {1000, 2000, 4000, 8000, 16000, 30000, 30000};
  for (uint32_t ms : expected) TEST_ASSERT_EQUAL_UINT32(ms, backoff.nextDelayMs(std::nullopt));
}

void test_reset_starts_again() {
  FixedRandom random(0xffffffff);
  Backoff backoff(2000, 60000, random);
  backoff.nextDelayMs(std::nullopt);
  backoff.nextDelayMs(std::nullopt);
  backoff.reset();
  TEST_ASSERT_EQUAL_UINT32(2000, backoff.nextDelayMs(std::nullopt));
}

void test_longer_retry_after_wins() {
  FixedRandom random(0xffffffff);
  Backoff backoff(2000, 60000, random);
  TEST_ASSERT_EQUAL_UINT32(30000, backoff.nextDelayMs(30));
}

void test_shorter_retry_after_loses() {
  FixedRandom random(0xffffffff);
  Backoff backoff(2000, 60000, random);
  backoff.nextDelayMs(std::nullopt);
  backoff.nextDelayMs(std::nullopt);
  TEST_ASSERT_EQUAL_UINT32(8000, backoff.nextDelayMs(1));
}

void test_retry_after_capped_at_600_s() {
  FixedRandom random(0xffffffff);
  Backoff backoff(2000, 60000, random);
  TEST_ASSERT_EQUAL_UINT32(600000, backoff.nextDelayMs(9999));
}

void test_parse_retry_after() {
  TEST_ASSERT_EQUAL_UINT32(30, parseRetryAfter("30").value());
  TEST_ASSERT_EQUAL_UINT32(5, parseRetryAfter(" 5 ").value());
  TEST_ASSERT_EQUAL_UINT32(0, parseRetryAfter("0").value());
}

void test_parse_retry_after_rejects() {
  TEST_ASSERT_FALSE(parseRetryAfter(nullptr).has_value());
  TEST_ASSERT_FALSE(parseRetryAfter("").has_value());
  TEST_ASSERT_FALSE(parseRetryAfter("abc").has_value());
  TEST_ASSERT_FALSE(parseRetryAfter("-1").has_value());
  TEST_ASSERT_FALSE(parseRetryAfter("5s").has_value());
  TEST_ASSERT_FALSE(parseRetryAfter("99999999999").has_value());
  TEST_ASSERT_FALSE(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT").has_value());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_doubles_to_cap_at_max_jitter);
  RUN_TEST(test_min_jitter_is_half);
  RUN_TEST(test_reset_starts_again);
  RUN_TEST(test_longer_retry_after_wins);
  RUN_TEST(test_shorter_retry_after_loses);
  RUN_TEST(test_retry_after_capped_at_600_s);
  RUN_TEST(test_parse_retry_after);
  RUN_TEST(test_parse_retry_after_rejects);
  return UNITY_END();
}
