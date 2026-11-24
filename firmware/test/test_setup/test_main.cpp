#include <unity.h>

#include "setup.h"

namespace {
constexpr uint64_t kS = 1000;
const char* kToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

SetupForm form(const std::string& code = "K7Q2M9XD") { return {"Home", "password1", code}; }

void assertStatus(SetupStatus expected, const SetupFlow& flow) {
  TEST_ASSERT_EQUAL_STRING(setupStatusName(expected), setupStatusName(flow.status()));
}

void assertError(SetupError expected, SetupError actual) {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(expected), static_cast<int>(actual));
}

std::optional<ClaimResult> claimed() { return ClaimResult{"dev-1", kToken, {1, 30}}; }

SetupFlow claiming() {
  SetupFlow flow(false);
  flow.submit(form(), 0);
  flow.onWifiConnected();
  return flow;
}
}  // namespace

void test_normalizes_pairing_code() {
  TEST_ASSERT_EQUAL_STRING("K7Q2M9XD", normalizePairingCode(" k7q2-m9 xd ").c_str());
  TEST_ASSERT_EQUAL_STRING("", normalizePairingCode(" - ").c_str());
}

void test_valid_form() {
  assertError(SetupError::None, validateSetupForm(form(), false));
  assertError(SetupError::None, validateSetupForm(form("k7q2-m9xd"), false));
  assertError(SetupError::None, validateSetupForm({"Home", "", "K7Q2M9XD"}, false));
}

void test_ssid_length() {
  assertError(SetupError::SsidRequired, validateSetupForm({"", "password1", "K7Q2M9XD"}, false));
  assertError(SetupError::None,
              validateSetupForm({std::string(32, 'a'), "password1", "K7Q2M9XD"}, false));
  assertError(SetupError::SsidRequired,
              validateSetupForm({std::string(33, 'a'), "password1", "K7Q2M9XD"}, false));
}

void test_password_length() {
  assertError(SetupError::PasswordTooLong, validateSetupForm({"Home", "short", "K7Q2M9XD"}, false));
  assertError(SetupError::None, validateSetupForm({"Home", std::string(8, 'p'), "K7Q2M9XD"}, false));
  assertError(SetupError::None, validateSetupForm({"Home", std::string(63, 'p'), "K7Q2M9XD"}, false));
  assertError(SetupError::PasswordTooLong,
              validateSetupForm({"Home", std::string(64, 'p'), "K7Q2M9XD"}, false));
}

void test_code_alphabet() {
  for (const char* bad : {"K7Q2M9X0", "K7Q2M9XO", "K7Q2M9X1", "K7Q2M9XI", "K7Q2M9XL", "K7Q2M9X",
                          "K7Q2M9XDD", "K7Q2M9X!"}) {
    assertError(SetupError::CodeFormat, validateSetupForm(form(bad), false));
  }
}

void test_code_required_without_token() {
  assertError(SetupError::CodeRequired, validateSetupForm(form(""), false));
  assertError(SetupError::None, validateSetupForm(form(""), true));
  assertError(SetupError::CodeFormat, validateSetupForm(form("ABC"), true));
}

void test_starts_idle() {
  SetupFlow flow(false);
  assertStatus(SetupStatus::Idle, flow);
  TEST_ASSERT_FALSE(flow.shouldClaim());
  TEST_ASSERT_FALSE(flow.shouldSave());
}

void test_submit_connects_and_rejects_while_busy() {
  SetupFlow flow(false);
  TEST_ASSERT_TRUE(flow.submit(form(), 0));
  assertStatus(SetupStatus::Connecting, flow);
  TEST_ASSERT_FALSE(flow.submit(form(), 1));
  flow.onWifiConnected();
  assertStatus(SetupStatus::Claiming, flow);
  TEST_ASSERT_FALSE(flow.submit(form(), 2));
}

void test_submit_rejects_invalid_form() {
  SetupFlow flow(false);
  TEST_ASSERT_FALSE(flow.submit(form(""), 0));
  assertStatus(SetupStatus::Idle, flow);
}

void test_submit_keeps_normalized_code() {
  SetupFlow flow(false);
  flow.submit(form("k7q2-m9xd"), 0);
  TEST_ASSERT_EQUAL_STRING("K7Q2M9XD", flow.form().pairingCode.c_str());
}

void failTimes(SetupFlow& flow, uint16_t reason, int times) {
  for (int i = 0; i < times; i++) flow.onWifiFailed(reason);
}

void test_wifi_failure_reasons_after_retries() {
  struct Case {
    uint16_t reason;
    int attempts;
    SetupStatus status;
  } cases[] = {{201, 2, SetupStatus::WifiNotFound},  {202, 3, SetupStatus::WifiAuthFailed},
               {15, 3, SetupStatus::WifiAuthFailed}, {204, 3, SetupStatus::WifiAuthFailed},
               {2, 3, SetupStatus::WifiFailed},      {205, 3, SetupStatus::WifiFailed}};
  for (const Case& c : cases) {
    SetupFlow flow(false);
    flow.submit(form(), 0);
    failTimes(flow, c.reason, c.attempts - 1);
    assertStatus(SetupStatus::Connecting, flow);
    flow.onWifiFailed(c.reason);
    assertStatus(c.status, flow);
    TEST_ASSERT_EQUAL_UINT16(c.reason, flow.lastWifiReason());
    TEST_ASSERT_FALSE(flow.shouldSave());
  }
}

void test_one_handshake_timeout_retries_instead_of_failing() {
  SetupFlow flow(false);
  flow.submit(form(), 0);
  flow.onWifiFailed(15);
  assertStatus(SetupStatus::Connecting, flow);
  TEST_ASSERT_TRUE(flow.takeWifiRetry());
  TEST_ASSERT_FALSE(flow.takeWifiRetry());
  flow.onWifiConnected();
  assertStatus(SetupStatus::Claiming, flow);
}

void test_no_retry_after_the_final_failure() {
  SetupFlow flow(false);
  flow.submit(form(), 0);
  failTimes(flow, 202, 2);
  TEST_ASSERT_TRUE(flow.takeWifiRetry());
  flow.onWifiFailed(202);
  TEST_ASSERT_FALSE(flow.takeWifiRetry());
}

void test_timeout_reports_the_last_failure_reason() {
  SetupFlow flow(false);
  flow.submit(form(), 0);
  flow.onWifiFailed(15);
  flow.tick(30 * kS);
  assertStatus(SetupStatus::WifiAuthFailed, flow);
}

void test_resubmit_resets_failure_count() {
  SetupFlow flow(false);
  flow.submit(form(), 0);
  failTimes(flow, 202, 3);
  assertStatus(SetupStatus::WifiAuthFailed, flow);
  flow.submit(form(), 1 * kS);
  failTimes(flow, 202, 2);
  assertStatus(SetupStatus::Connecting, flow);
  TEST_ASSERT_EQUAL_UINT16(202, flow.lastWifiReason());
}

void test_wifi_timeout() {
  SetupFlow flow(false);
  flow.submit(form(), 10 * kS);
  flow.tick(40 * kS - 1);
  assertStatus(SetupStatus::Connecting, flow);
  flow.tick(40 * kS);
  assertStatus(SetupStatus::WifiFailed, flow);
}

void test_claim_success_saves() {
  SetupFlow flow = claiming();
  TEST_ASSERT_TRUE(flow.shouldClaim());
  TEST_ASSERT_FALSE(flow.shouldSave());
  flow.onClaimResult(200, claimed());
  assertStatus(SetupStatus::Done, flow);
  TEST_ASSERT_TRUE(flow.shouldSave());
  TEST_ASSERT_FALSE(flow.shouldClaim());
  TEST_ASSERT_EQUAL_STRING(kToken, flow.claim()->token.c_str());
}

void test_claim_failures_never_save() {
  struct Case {
    int http;
    bool body;
    SetupStatus status;
  } cases[] = {{404, false, SetupStatus::CodeInvalid},
               {410, false, SetupStatus::CodeExpired},
               {-1, false, SetupStatus::ServerUnreachable},
               {500, false, SetupStatus::ServerUnreachable},
               {429, false, SetupStatus::ServerUnreachable},
               {200, false, SetupStatus::ServerUnreachable},
               {400, false, SetupStatus::ServerUnreachable}};
  for (const Case& c : cases) {
    SetupFlow flow = claiming();
    flow.onClaimResult(c.http, c.body ? claimed() : std::nullopt);
    assertStatus(c.status, flow);
    TEST_ASSERT_FALSE(flow.shouldSave());
    TEST_ASSERT_FALSE(flow.shouldClaim());
    TEST_ASSERT_FALSE(flow.claim().has_value());
  }
}

void test_resubmit_after_failure_starts_over() {
  SetupFlow flow = claiming();
  flow.onClaimResult(410, std::nullopt);
  TEST_ASSERT_TRUE(flow.submit(form("23456789"), 100 * kS));
  assertStatus(SetupStatus::Connecting, flow);
  flow.tick(129 * kS);
  assertStatus(SetupStatus::Connecting, flow);
  flow.onWifiConnected();
  flow.onClaimResult(200, claimed());
  assertStatus(SetupStatus::Done, flow);
}

void test_wifi_only_change_skips_claim() {
  SetupFlow flow(true);
  TEST_ASSERT_TRUE(flow.submit(form(""), 0));
  flow.onWifiConnected();
  assertStatus(SetupStatus::Done, flow);
  TEST_ASSERT_TRUE(flow.shouldSave());
  TEST_ASSERT_FALSE(flow.claim().has_value());
}

void test_done_is_final() {
  SetupFlow flow = claiming();
  flow.onClaimResult(200, claimed());
  TEST_ASSERT_FALSE(flow.submit(form(), 1));
  flow.onWifiFailed(201);
  flow.tick(1000 * kS);
  assertStatus(SetupStatus::Done, flow);
}

void test_late_events_are_ignored() {
  SetupFlow flow(false);
  flow.onWifiConnected();
  flow.onWifiFailed(201);
  flow.onClaimResult(200, claimed());
  assertStatus(SetupStatus::Idle, flow);
}

void test_status_names() {
  TEST_ASSERT_EQUAL_STRING("IDLE", setupStatusName(SetupStatus::Idle));
  TEST_ASSERT_EQUAL_STRING("CONNECTING", setupStatusName(SetupStatus::Connecting));
  TEST_ASSERT_EQUAL_STRING("WIFI_NOT_FOUND", setupStatusName(SetupStatus::WifiNotFound));
  TEST_ASSERT_EQUAL_STRING("WIFI_AUTH_FAILED", setupStatusName(SetupStatus::WifiAuthFailed));
  TEST_ASSERT_EQUAL_STRING("WIFI_FAILED", setupStatusName(SetupStatus::WifiFailed));
  TEST_ASSERT_EQUAL_STRING("CLAIMING", setupStatusName(SetupStatus::Claiming));
  TEST_ASSERT_EQUAL_STRING("CODE_INVALID", setupStatusName(SetupStatus::CodeInvalid));
  TEST_ASSERT_EQUAL_STRING("CODE_EXPIRED", setupStatusName(SetupStatus::CodeExpired));
  TEST_ASSERT_EQUAL_STRING("SERVER_UNREACHABLE", setupStatusName(SetupStatus::ServerUnreachable));
  TEST_ASSERT_EQUAL_STRING("DONE", setupStatusName(SetupStatus::Done));
}

void test_setup_required() {
  TEST_ASSERT_TRUE(setupRequired(false, false));
  TEST_ASSERT_TRUE(setupRequired(true, false));
  TEST_ASSERT_TRUE(setupRequired(false, true));
  TEST_ASSERT_FALSE(setupRequired(true, true));
}

void test_first_boot_setup_never_exits() {
  SetupFlow flow(false);
  TEST_ASSERT_FALSE(flow.shouldExit(100000 * kS));
}

void test_button_setup_exits_after_ten_idle_minutes() {
  SetupFlow flow(true);
  flow.enableIdleExit(5 * kS);
  TEST_ASSERT_FALSE(flow.shouldExit(605 * kS - 1));
  TEST_ASSERT_TRUE(flow.shouldExit(605 * kS));
}

void test_submission_restarts_idle_timer() {
  SetupFlow flow(true);
  flow.enableIdleExit(0);
  flow.submit(form(), 500 * kS);
  failTimes(flow, 202, 3);
  TEST_ASSERT_FALSE(flow.shouldExit(1099 * kS));
  TEST_ASSERT_TRUE(flow.shouldExit(1100 * kS));
}

void test_no_idle_exit_while_busy_or_done() {
  SetupFlow flow(false);
  flow.enableIdleExit(0);
  flow.submit(form(), 0);
  TEST_ASSERT_FALSE(flow.shouldExit(700 * kS));
  flow.onWifiConnected();
  TEST_ASSERT_FALSE(flow.shouldExit(700 * kS));
  flow.onClaimResult(200, claimed());
  TEST_ASSERT_FALSE(flow.shouldExit(700 * kS));
}

void test_own_disconnect_is_not_a_failure() {
  SetupFlow flow(false);
  flow.submit(form(), 0);
  flow.onWifiFailed(8);
  assertStatus(SetupStatus::Connecting, flow);
  TEST_ASSERT_FALSE(flow.takeWifiRetry());
  TEST_ASSERT_EQUAL_UINT16(0, flow.lastWifiReason());
}

void test_language_from_query_wins() {
  TEST_ASSERT_EQUAL_size_t(2, pickLanguage("ru", "en-US,en;q=0.9"));
  TEST_ASSERT_EQUAL_size_t(1, pickLanguage("en", ""));
  TEST_ASSERT_EQUAL_size_t(1, pickLanguage("de", "en"));
}

void test_language_from_accept_language() {
  TEST_ASSERT_EQUAL_size_t(1, pickLanguage("", "en-US,en;q=0.9,uk;q=0.8"));
  TEST_ASSERT_EQUAL_size_t(2, pickLanguage("", "de-DE,ru;q=0.7,uk;q=0.5"));
  TEST_ASSERT_EQUAL_size_t(0, pickLanguage("", "uk-UA"));
  TEST_ASSERT_EQUAL_size_t(2, pickLanguage("", "RU"));
  TEST_ASSERT_EQUAL_size_t(0, pickLanguage("", "de, fr"));
  TEST_ASSERT_EQUAL_size_t(0, pickLanguage("", ""));
  TEST_ASSERT_EQUAL_size_t(0, pickLanguage("", "enx,rus"));
}

void test_setup_error_names() {
  TEST_ASSERT_EQUAL_STRING("SSID_REQUIRED", setupErrorName(SetupError::SsidRequired));
  TEST_ASSERT_EQUAL_STRING("PASSWORD_TOO_LONG", setupErrorName(SetupError::PasswordTooLong));
  TEST_ASSERT_EQUAL_STRING("CODE_FORMAT", setupErrorName(SetupError::CodeFormat));
  TEST_ASSERT_EQUAL_STRING("CODE_REQUIRED", setupErrorName(SetupError::CodeRequired));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_normalizes_pairing_code);
  RUN_TEST(test_valid_form);
  RUN_TEST(test_ssid_length);
  RUN_TEST(test_password_length);
  RUN_TEST(test_code_alphabet);
  RUN_TEST(test_code_required_without_token);
  RUN_TEST(test_starts_idle);
  RUN_TEST(test_submit_connects_and_rejects_while_busy);
  RUN_TEST(test_submit_rejects_invalid_form);
  RUN_TEST(test_submit_keeps_normalized_code);
  RUN_TEST(test_wifi_failure_reasons_after_retries);
  RUN_TEST(test_one_handshake_timeout_retries_instead_of_failing);
  RUN_TEST(test_no_retry_after_the_final_failure);
  RUN_TEST(test_timeout_reports_the_last_failure_reason);
  RUN_TEST(test_resubmit_resets_failure_count);
  RUN_TEST(test_wifi_timeout);
  RUN_TEST(test_claim_success_saves);
  RUN_TEST(test_claim_failures_never_save);
  RUN_TEST(test_resubmit_after_failure_starts_over);
  RUN_TEST(test_wifi_only_change_skips_claim);
  RUN_TEST(test_done_is_final);
  RUN_TEST(test_late_events_are_ignored);
  RUN_TEST(test_status_names);
  RUN_TEST(test_own_disconnect_is_not_a_failure);
  RUN_TEST(test_language_from_query_wins);
  RUN_TEST(test_language_from_accept_language);
  RUN_TEST(test_setup_error_names);
  RUN_TEST(test_setup_required);
  RUN_TEST(test_first_boot_setup_never_exits);
  RUN_TEST(test_button_setup_exits_after_ten_idle_minutes);
  RUN_TEST(test_submission_restarts_idle_timer);
  RUN_TEST(test_no_idle_exit_while_busy_or_done);
  return UNITY_END();
}
