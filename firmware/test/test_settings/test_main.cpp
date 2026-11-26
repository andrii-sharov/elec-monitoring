#include <unity.h>

#include "settings.h"

namespace {
const char* kToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

std::string body(const std::string& token, const std::string& settings) {
  return R"({"device_id":"4c0f9a2e-1111-4222-8333-444455556666","device_token":")" + token +
         R"(","settings":)" + settings + "}";
}
}  // namespace

void test_parses_claim_response() {
  auto result = parseClaimResponse(body(kToken, R"({"version":1,"ping_interval_s":30})").c_str());
  TEST_ASSERT_TRUE(result.has_value());
  TEST_ASSERT_EQUAL_STRING("4c0f9a2e-1111-4222-8333-444455556666", result->deviceId.c_str());
  TEST_ASSERT_EQUAL_STRING(kToken, result->token.c_str());
  TEST_ASSERT_EQUAL_UINT32(1, result->settings.version);
  TEST_ASSERT_EQUAL_UINT32(30, result->settings.pingIntervalS);
}

void test_clamps_parsed_settings() {
  auto result = parseClaimResponse(body(kToken, R"({"version":2,"ping_interval_s":1})").c_str());
  TEST_ASSERT_TRUE(result.has_value());
  TEST_ASSERT_EQUAL_UINT32(20, result->settings.pingIntervalS);
}

void test_rejects_missing_token() {
  const char* json =
      R"({"device_id":"4c0f","settings":{"version":1,"ping_interval_s":30}})";
  TEST_ASSERT_FALSE(parseClaimResponse(json).has_value());
}

void test_rejects_bad_tokens() {
  const char* settings = R"({"version":1,"ping_interval_s":30})";
  std::string shortToken(kToken, 63);
  std::string upper(kToken);
  upper[10] = 'A';
  std::string notHex(kToken);
  notHex[0] = 'g';
  TEST_ASSERT_FALSE(parseClaimResponse(body(shortToken, settings).c_str()).has_value());
  TEST_ASSERT_FALSE(parseClaimResponse(body(shortToken + "00", settings).c_str()).has_value());
  TEST_ASSERT_FALSE(parseClaimResponse(body(upper, settings).c_str()).has_value());
  TEST_ASSERT_FALSE(parseClaimResponse(body(notHex, settings).c_str()).has_value());
}

void test_rejects_missing_device_id_or_settings() {
  std::string noId = std::string(R"({"device_token":")") + kToken +
                     R"(","settings":{"version":1,"ping_interval_s":30}})";
  std::string noSettings = std::string(R"({"device_id":"4c0f","device_token":")") + kToken + "\"}";
  TEST_ASSERT_FALSE(parseClaimResponse(noId.c_str()).has_value());
  TEST_ASSERT_FALSE(parseClaimResponse(noSettings.c_str()).has_value());
}

void test_rejects_invalid_json() {
  TEST_ASSERT_FALSE(parseClaimResponse("{not json").has_value());
  TEST_ASSERT_FALSE(parseClaimResponse("").has_value());
  TEST_ASSERT_FALSE(parseClaimResponse(nullptr).has_value());
}

void test_clamp_settings() {
  DeviceSettings low = clampSettings({3, 4});
  TEST_ASSERT_EQUAL_UINT32(3, low.version);
  TEST_ASSERT_EQUAL_UINT32(20, low.pingIntervalS);
  TEST_ASSERT_EQUAL_UINT32(5, clampSettings({3, 5}).pingIntervalS);
  TEST_ASSERT_EQUAL_UINT32(60, clampSettings({3, 60}).pingIntervalS);
  TEST_ASSERT_EQUAL_UINT32(600, clampSettings({3, 600}).pingIntervalS);
  TEST_ASSERT_EQUAL_UINT32(20, clampSettings({3, 601}).pingIntervalS);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_parses_claim_response);
  RUN_TEST(test_clamps_parsed_settings);
  RUN_TEST(test_rejects_missing_token);
  RUN_TEST(test_rejects_bad_tokens);
  RUN_TEST(test_rejects_missing_device_id_or_settings);
  RUN_TEST(test_rejects_invalid_json);
  RUN_TEST(test_clamp_settings);
  return UNITY_END();
}
