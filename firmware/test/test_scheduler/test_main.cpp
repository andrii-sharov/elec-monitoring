#include <unity.h>

#include <deque>

#include "../support/fake_random.h"
#include "scheduler.h"

namespace {
constexpr uint64_t kS = 1000;
constexpr uint32_t kMaxJitter = 0xffffffff;

void assertDue(const CheckInScheduler& s, uint64_t now, CheckInType type, bool retry) {
  auto due = s.due(now);
  TEST_ASSERT_TRUE_MESSAGE(due.has_value(), "expected a check-in to be due");
  TEST_ASSERT_EQUAL_INT(static_cast<int>(type), static_cast<int>(due->type));
  TEST_ASSERT_EQUAL(retry, due->retry);
}

void assertNotDue(const CheckInScheduler& s, uint64_t now) {
  TEST_ASSERT_FALSE_MESSAGE(s.due(now).has_value(), "expected nothing due");
}

void bootAccepted(CheckInScheduler& s, uint64_t now) {
  s.onLinkReady(now);
  s.onResult(CheckInType::Boot, CheckInOutcome::Accepted, std::nullopt, now);
}
}  // namespace

void test_nothing_due_before_link_ready() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  assertNotDue(s, 0);
  assertNotDue(s, 100 * kS);
}

void test_boot_due_at_once_on_link_ready() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(5 * kS);
  assertDue(s, 5 * kS, CheckInType::Boot, false);
}

void test_boot_network_error_backs_off() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  uint64_t now = 0;
  s.onLinkReady(now);
  uint64_t expected[] = {2, 4, 8, 16, 32, 60, 60};
  for (uint64_t delayS : expected) {
    s.onResult(CheckInType::Boot, CheckInOutcome::NetworkError, std::nullopt, now);
    assertNotDue(s, now + delayS * kS - 1);
    now += delayS * kS;
    assertDue(s, now, CheckInType::Boot, true);
  }
  TEST_ASSERT_TRUE(s.lastFailed());
}

void test_boot_server_error_backs_off() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::ServerError, std::nullopt, 0);
  assertNotDue(s, 2 * kS - 1);
  assertDue(s, 2 * kS, CheckInType::Boot, true);
}

void test_boot_rate_limited_waits_retry_after() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::RateLimited, 45, 0);
  assertNotDue(s, 45 * kS - 1);
  assertDue(s, 45 * kS, CheckInType::Boot, true);
}

void test_boot_accepted_moves_to_ping() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  TEST_ASSERT_TRUE(s.bootAcknowledged());
  TEST_ASSERT_FALSE(s.lastFailed());
  assertNotDue(s, 30 * kS - 1);
  assertDue(s, 30 * kS, CheckInType::Ping, false);
}

void test_ping_failure_waits_full_interval() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  s.onResult(CheckInType::Ping, CheckInOutcome::NetworkError, std::nullopt, 30 * kS);
  TEST_ASSERT_TRUE(s.lastFailed());
  assertNotDue(s, 60 * kS - 1);
  assertDue(s, 60 * kS, CheckInType::Ping, false);
  s.onResult(CheckInType::Ping, CheckInOutcome::ServerError, std::nullopt, 60 * kS);
  assertNotDue(s, 90 * kS - 1);
  assertDue(s, 90 * kS, CheckInType::Ping, false);
}

void test_ping_rate_limited_waits_longer_retry_after() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  s.onResult(CheckInType::Ping, CheckInOutcome::RateLimited, 90, 30 * kS);
  assertNotDue(s, 120 * kS - 1);
  assertDue(s, 120 * kS, CheckInType::Ping, false);
}

void test_ping_rate_limited_short_retry_after_keeps_interval() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  s.onResult(CheckInType::Ping, CheckInOutcome::RateLimited, 5, 30 * kS);
  assertNotDue(s, 60 * kS - 1);
  assertDue(s, 60 * kS, CheckInType::Ping, false);
}

void test_reconnect_sends_one_ping_at_once() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  s.onLinkLost(10 * kS);
  assertNotDue(s, 100 * kS);
  uint64_t back = 10 * kS + 300 * kS;
  s.onLinkReady(back);
  assertDue(s, back, CheckInType::Ping, false);
  s.onResult(CheckInType::Ping, CheckInOutcome::Accepted, std::nullopt, back);
  assertNotDue(s, back + 30 * kS - 1);
  assertDue(s, back + 30 * kS, CheckInType::Ping, false);
}

void test_link_lost_before_boot_ack_retries_boot() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::NetworkError, std::nullopt, 0);
  s.onLinkLost(1 * kS);
  s.onLinkReady(20 * kS);
  assertDue(s, 20 * kS, CheckInType::Boot, true);
}

void test_link_lost_before_first_boot_is_not_a_retry() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onLinkLost(1 * kS);
  s.onLinkReady(20 * kS);
  assertDue(s, 20 * kS, CheckInType::Boot, false);
}

void test_reconnect_respects_server_hold() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  s.onResult(CheckInType::Ping, CheckInOutcome::RateLimited, 300, 30 * kS);
  s.onLinkLost(40 * kS);
  s.onLinkReady(50 * kS);
  assertNotDue(s, 330 * kS - 1);
  assertDue(s, 330 * kS, CheckInType::Ping, false);
}

void test_unauthorized_waits_five_minutes_until_accepted() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  bootAccepted(s, 0);
  s.onResult(CheckInType::Ping, CheckInOutcome::Unauthorized, std::nullopt, 30 * kS);
  TEST_ASSERT_TRUE(s.unauthorized());
  TEST_ASSERT_TRUE(s.lastFailed());
  assertNotDue(s, 330 * kS - 1);
  assertDue(s, 330 * kS, CheckInType::Ping, false);
  s.onResult(CheckInType::Ping, CheckInOutcome::Accepted, std::nullopt, 330 * kS);
  TEST_ASSERT_FALSE(s.unauthorized());
  assertDue(s, 360 * kS, CheckInType::Ping, false);
}

void test_unauthorized_boot_retries_boot_after_five_minutes() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::Unauthorized, std::nullopt, 0);
  assertNotDue(s, 300 * kS - 1);
  assertDue(s, 300 * kS, CheckInType::Boot, true);
}

void test_bad_request_on_boot_moves_on() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::BadRequest, std::nullopt, 0);
  TEST_ASSERT_TRUE(s.bootAcknowledged());
  TEST_ASSERT_TRUE(s.lastFailed());
  assertNotDue(s, 30 * kS - 1);
  assertDue(s, 30 * kS, CheckInType::Ping, false);
}

void test_accepted_after_boot_backoff_resets_it() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::NetworkError, std::nullopt, 0);
  s.onResult(CheckInType::Boot, CheckInOutcome::NetworkError, std::nullopt, 2 * kS);
  s.onResult(CheckInType::Boot, CheckInOutcome::Accepted, std::nullopt, 6 * kS);
  assertDue(s, 36 * kS, CheckInType::Ping, false);
}

void test_large_now_does_not_wrap() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  uint64_t start = (uint64_t{1} << 32) + 5;
  bootAccepted(s, start);
  assertNotDue(s, start + 30 * kS - 1);
  assertDue(s, start + 30 * kS, CheckInType::Ping, false);
}

namespace {
uint64_t maxAttemptsPerMinute(CheckInOutcome outcome, std::optional<uint32_t> retryAfter,
                              uint32_t jitter, uint32_t pingS) {
  FixedRandom random(jitter);
  CheckInScheduler s(pingS, random);
  s.onLinkReady(0);
  std::deque<uint64_t> window;
  uint64_t worst = 0;
  for (uint64_t now = 0; now <= 600 * kS; now += 100) {
    auto due = s.due(now);
    if (!due) continue;
    window.push_back(now);
    while (window.front() + 60 * kS <= now) window.pop_front();
    if (window.size() > worst) worst = window.size();
    s.onResult(due->type, outcome, retryAfter, now);
  }
  return worst;
}
}  // namespace

void test_never_more_than_six_requests_a_minute() {
  CheckInOutcome outcomes[] = {CheckInOutcome::Accepted,     CheckInOutcome::RateLimited,
                               CheckInOutcome::Unauthorized, CheckInOutcome::BadRequest,
                               CheckInOutcome::ServerError,  CheckInOutcome::NetworkError};
  std::optional<uint32_t> retryAfters[] = {std::nullopt, 0, 1, 60};
  for (CheckInOutcome outcome : outcomes) {
    for (auto retryAfter : retryAfters) {
      for (uint32_t jitter : {0u, kMaxJitter}) {
        for (uint32_t pingS : {15u, 30u}) {
          TEST_ASSERT_LESS_OR_EQUAL_UINT64(6, maxAttemptsPerMinute(outcome, retryAfter, jitter,
                                                                   pingS));
        }
      }
    }
  }
}

void test_outcome_for_status() {
  struct Case {
    int status;
    CheckInOutcome outcome;
  } cases[] = {{204, CheckInOutcome::Accepted},     {200, CheckInOutcome::Accepted},
               {429, CheckInOutcome::RateLimited},  {401, CheckInOutcome::Unauthorized},
               {400, CheckInOutcome::BadRequest},   {404, CheckInOutcome::BadRequest},
               {500, CheckInOutcome::ServerError},  {503, CheckInOutcome::ServerError},
               {-1, CheckInOutcome::NetworkError},  {-11, CheckInOutcome::NetworkError},
               {0, CheckInOutcome::NetworkError},   {302, CheckInOutcome::ServerError}};
  for (const Case& c : cases) {
    TEST_ASSERT_EQUAL_INT(static_cast<int>(c.outcome), static_cast<int>(outcomeForStatus(c.status)));
  }
}

void test_next_at_reports_the_wait() {
  FixedRandom random(kMaxJitter);
  CheckInScheduler s(30, random);
  s.onLinkReady(0);
  s.onResult(CheckInType::Boot, CheckInOutcome::NetworkError, std::nullopt, 1 * kS);
  TEST_ASSERT_EQUAL_UINT64(3 * kS, s.nextAtMs());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_nothing_due_before_link_ready);
  RUN_TEST(test_boot_due_at_once_on_link_ready);
  RUN_TEST(test_boot_network_error_backs_off);
  RUN_TEST(test_boot_server_error_backs_off);
  RUN_TEST(test_boot_rate_limited_waits_retry_after);
  RUN_TEST(test_boot_accepted_moves_to_ping);
  RUN_TEST(test_ping_failure_waits_full_interval);
  RUN_TEST(test_ping_rate_limited_waits_longer_retry_after);
  RUN_TEST(test_ping_rate_limited_short_retry_after_keeps_interval);
  RUN_TEST(test_reconnect_sends_one_ping_at_once);
  RUN_TEST(test_link_lost_before_boot_ack_retries_boot);
  RUN_TEST(test_link_lost_before_first_boot_is_not_a_retry);
  RUN_TEST(test_reconnect_respects_server_hold);
  RUN_TEST(test_unauthorized_waits_five_minutes_until_accepted);
  RUN_TEST(test_unauthorized_boot_retries_boot_after_five_minutes);
  RUN_TEST(test_bad_request_on_boot_moves_on);
  RUN_TEST(test_accepted_after_boot_backoff_resets_it);
  RUN_TEST(test_large_now_does_not_wrap);
  RUN_TEST(test_never_more_than_six_requests_a_minute);
  RUN_TEST(test_outcome_for_status);
  RUN_TEST(test_next_at_reports_the_wait);
  return UNITY_END();
}
